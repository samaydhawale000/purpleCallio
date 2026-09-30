import Foundation
import Foundation
import Testing
@testable import PurpleCallio

/// Ordered cross-channel log (socket emits, REST calls, media, peer), used to
/// assert protocol ordering across fakes.
@MainActor
final class EventLog {
    private(set) var entries: [String] = []
    func add(_ entry: String) { entries.append(entry) }
    func index(of entry: String, sourceLocation: SourceLocation = #_sourceLocation) -> Int {
        guard let index = entries.firstIndex(of: entry) else {
            Issue.record("'\(entry)' not in log: \(entries)", sourceLocation: sourceLocation)
            return -1
        }
        return index
    }
}

// MARK: - Signaling

@MainActor
final class FakeSignaling: SignalingChannel {
    enum AuthBehavior {
        case succeed
        case reject
        case timeout
        case malformed
        case manual
    }

    let log: EventLog
    var authBehavior: AuthBehavior = .succeed
    var role = "CALLER"
    var connectedPayload: SignalingPayload = [:]
    /// Server events delivered between `connected` and the ack (e.g. `incoming-call`).
    var eventsBeforeAck: [(String, SignalingPayload)] = []
    var autoConnect = true
    /// Ack body delivered for `join-call` (nil: the server never acks).
    var joinCallAck: SignalingPayload? = ["success": true, "participants": 2]
    /// When true, join-call acks are held until `releaseJoinAck()`.
    var holdJoinAck = false
    private var heldJoinAck: (() -> Void)?
    func releaseJoinAck() {
        heldJoinAck?()
        heldJoinAck = nil
    }

    private(set) var handlers: [String: [(SignalingPayload) -> Void]] = [:]
    private var lifecycle: ((SignalingLifecycleEvent) -> Void)?
    private(set) var emits: [(event: String, payload: SignalingPayload?)] = []
    private(set) var connectCount = 0
    private(set) var disconnectCount = 0
    private(set) var removeAllHandlersCount = 0
    private(set) var pendingAuth: [(SignalingAck) -> Void] = []
    var isConnected = false

    init(log: EventLog) { self.log = log }

    var handlerCount: Int { handlers.values.reduce(0) { $0 + $1.count } + (lifecycle == nil ? 0 : 1) }

    func setLifecycleHandler(_ handler: @escaping @MainActor (SignalingLifecycleEvent) -> Void) {
        lifecycle = handler
    }

    func on(_ event: String, _ handler: @escaping @MainActor (SignalingPayload) -> Void) {
        handlers[event, default: []].append(handler)
    }

    func connect() {
        connectCount += 1
        guard autoConnect else { return }
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated { self?.simulateConnect() }
        }
    }

    func simulateConnect() {
        isConnected = true
        lifecycle?(.connected)
    }

    func simulateDrop() {
        isConnected = false
        lifecycle?(.droppedWillReconnect(reason: "transport close"))
    }

    func simulateClosed() {
        isConnected = false
        lifecycle?(.closed(reason: "io server disconnect"))
    }

    func emit(_ event: String, _ payload: SignalingPayload?) {
        emits.append((event, payload))
        log.add("emit:\(event)")
    }

    func emitWithAck(
        _ event: String,
        _ payload: SignalingPayload,
        timeout: TimeInterval,
        completion: @escaping @MainActor (SignalingAck) -> Void
    ) {
        emits.append((event, payload))
        log.add("emit:\(event)")
        if event == WireEvent.joinCall, let body = joinCallAck {
            let deliver = { completion(.response([body])) }
            if holdJoinAck { heldJoinAck = deliver } else { deliver() }
            return
        }
        guard event == WireEvent.authenticate else { return }
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                switch self.authBehavior {
                case .succeed:
                    self.receive(WireEvent.connected, self.connectedPayload)
                    self.eventsBeforeAck.forEach { self.receive($0.0, $0.1) }
                    completion(.response([["success": true, "role": self.role]]))
                case .reject:
                    // The gateway can emit a terminal event (e.g. call.expired) before a failed ack.
                    self.eventsBeforeAck.forEach { self.receive($0.0, $0.1) }
                    completion(.response([["success": false]]))
                case .timeout:
                    completion(.timeout)
                case .malformed:
                    completion(.response(["nope"]))
                case .manual:
                    self.pendingAuth.append(completion)
                }
            }
        }
    }

    func removeAllHandlers() {
        removeAllHandlersCount += 1
        handlers.removeAll()
        lifecycle = nil
    }

    func disconnect() {
        disconnectCount += 1
        isConnected = false
    }

    /// Deliver a server event to the registered handlers.
    func receive(_ event: String, _ payload: SignalingPayload = [:]) {
        handlers[event]?.forEach { $0(payload) }
    }

    var emittedNames: [String] { emits.map(\.event) }

    func count(_ event: String) -> Int { emits.filter { $0.event == event }.count }

    func payloads(_ event: String) -> [SignalingPayload?] { emits.filter { $0.event == event }.map(\.payload) }
}

// MARK: - REST

@MainActor
final class FakeAPI: PurpleCallioAPI {
    let log: EventLog
    var detailsProvider: () throws -> CallDetails
    var turnResult: Result<[PurpleCallioIceServer], Error> = .success([PurpleCallioIceServer(url: "stun:stun.l.google.com:19302")])
    var failures: [String: Error] = [:]
    private(set) var calls: [String] = []
    private(set) var detailsCallIds: [String] = []
    private(set) var iceReports: [IceOutcome] = []
    private(set) var detachedEnds = 0

    init(log: EventLog, details: CallDetails) {
        self.log = log
        detailsProvider = { details }
    }

    /// Called when a POST is recorded (e.g. to deliver a server event mid-request).
    var onRecord: ((String) -> Void)?
    /// Awaited before a POST returns (simulates latency).
    var holds: [String: () async -> Void] = [:]

    private func record(_ name: String) async throws {
        calls.append(name)
        log.add("POST \(name)")
        onRecord?(name)
        if let hold = holds[name] { await hold() }
        await Task.yield()
        if let error = failures[name] { throw error }
    }

    func count(_ name: String) -> Int { calls.filter { $0 == name }.count }

    func turnCredentials() async throws -> [PurpleCallioIceServer] {
        log.add("GET turn")
        return try turnResult.get()
    }

    func details(callId: String) async throws -> CallDetails {
        detailsCallIds.append(callId)
        log.add("GET details")
        return try detailsProvider()
    }

    func accept(callId: String) async throws { try await record("accept") }
    func reject(callId: String) async throws { try await record("reject") }
    func cancel(callId: String) async throws { try await record("cancel") }
    func join(callId: String) async throws { try await record("join") }
    func leave(callId: String) async throws { try await record("leave") }
    func end(callId: String) async throws { try await record("end") }

    func reportTransport(callId: String, transport: TransportKind, candidateType: String) async throws {
        calls.append("webrtc-transport")
    }

    func reportIce(callId: String, outcome: IceOutcome, iceConnectionState: String, connectionState: String) async throws {
        iceReports.append(outcome)
    }

    func endDetached(callId: String) {
        detachedEnds += 1
        log.add("POST end (detached)")
    }
}

// MARK: - RTC

final class FakeVideoBackend: VideoTrackBackend {
    let trackId: String
    private(set) var renderers: [ObjectIdentifier] = []
    init(trackId: String) { self.trackId = trackId }
    func addRenderer(_ renderer: AnyObject) { renderers.append(ObjectIdentifier(renderer)) }
    func removeRenderer(_ renderer: AnyObject) { renderers.removeAll { $0 == ObjectIdentifier(renderer) } }
}

@MainActor
final class FakeLocalMedia: LocalMedia {
    let hasVideo: Bool
    let log: EventLog
    var isAudioEnabled = true
    var isVideoEnabled = false
    private(set) var isCapturing = false
    private(set) var startPositions: [PurpleCallioCameraPosition] = []
    private(set) var stopCount = 0
    private(set) var released = false
    var startError: Error?
    let backend: FakeVideoBackend?

    init(video: Bool, log: EventLog) {
        hasVideo = video
        self.log = log
        backend = video ? FakeVideoBackend(trackId: "local-video") : nil
    }

    var videoTrack: VideoTrackBackend? { backend }

    func startCapture(position: PurpleCallioCameraPosition) async throws {
        log.add("startCapture:\(position.rawValue)")
        if let startError { throw startError }
        startPositions.append(position)
        isCapturing = true
    }

    func stopCapture() async {
        guard isCapturing else { return }
        stopCount += 1
        isCapturing = false
        log.add("stopCapture")
    }

    func release() {
        guard !released else { return }
        released = true
        isCapturing = false
        isAudioEnabled = false
        isVideoEnabled = false
    }
}

@MainActor
final class FakePeer: RTCPeer {
    let callbacks: RTCPeerCallbacks
    let log: EventLog
    let iceServers: [PurpleCallioIceServer]
    private(set) var addedMedia: LocalMedia?
    private(set) var offers: [Bool] = [] // iceRestart flags
    private(set) var answersCreated = 0
    private(set) var localDescriptions: [SessionDescription] = []
    private(set) var remoteDescriptions: [SessionDescription] = []
    private(set) var addedCandidates: [IceCandidate] = []
    private(set) var closed = false
    private(set) var replacedTracks = 0

    init(iceServers: [PurpleCallioIceServer], callbacks: RTCPeerCallbacks, log: EventLog) {
        self.iceServers = iceServers
        self.callbacks = callbacks
        self.log = log
    }

    func addLocalMedia(_ media: LocalMedia) throws {
        addedMedia = media
        log.add("peer:addLocalMedia")
    }

    func createOffer(iceRestart: Bool) async throws -> SessionDescription {
        offers.append(iceRestart)
        log.add(iceRestart ? "createOffer:restart" : "createOffer")
        return SessionDescription(type: .offer, sdp: "v=0 fake-offer-\(offers.count)")
    }

    func createAnswer() async throws -> SessionDescription {
        answersCreated += 1
        log.add("createAnswer")
        return SessionDescription(type: .answer, sdp: "v=0 fake-answer-\(answersCreated)")
    }

    func setLocalDescription(_ description: SessionDescription) async throws {
        localDescriptions.append(description)
        log.add("setLocal:\(description.type.rawValue)")
    }

    func setRemoteDescription(_ description: SessionDescription) async throws {
        await Task.yield()
        remoteDescriptions.append(description)
        log.add("setRemote:\(description.type.rawValue)")
    }

    func addIceCandidate(_ candidate: IceCandidate) async throws {
        addedCandidates.append(candidate)
        log.add("addCandidate:\(candidate.candidate)")
    }

    func replaceVideoTrack(_ track: VideoTrackBackend?) throws { replacedTracks += 1 }
    func selectedLocalCandidateType() async -> String? { "host" }
    func inboundRTPBytes() async -> Int { 0 }
    var iceConnectionStateName: String { "connected" }
    var connectionStateName: String { "connected" }

    func close() {
        guard !closed else { return }
        closed = true
        log.add("peer:close")
    }

    // Drive callbacks as WebRTC would (already marshalled to the main actor).
    func ice(_ state: IceConnectionState) { callbacks.onIceConnectionState(state) }
    func localCandidate(_ candidate: IceCandidate) { callbacks.onIceCandidate(candidate) }
    @discardableResult
    func remoteVideo(_ id: String = "remote-video") -> FakeVideoBackend {
        let backend = FakeVideoBackend(trackId: id)
        callbacks.onRemoteVideoTrack(backend)
        return backend
    }
}

@MainActor
final class FakeRTCEngine: RTCEngine {
    let log: EventLog
    private(set) var peers: [FakePeer] = []
    private(set) var medias: [FakeLocalMedia] = []
    var makeMediaError: Error?
    var cameraStartError: Error?
    var capturesDevices = true

    init(log: EventLog) { self.log = log }

    func makePeer(iceServers: [PurpleCallioIceServer], callbacks: RTCPeerCallbacks) throws -> RTCPeer {
        let peer = FakePeer(iceServers: iceServers, callbacks: callbacks, log: log)
        peers.append(peer)
        log.add("peer:create")
        return peer
    }

    func makeLocalMedia(video: Bool) throws -> LocalMedia {
        if let makeMediaError { throw makeMediaError }
        let media = FakeLocalMedia(video: video, log: log)
        media.startError = cameraStartError
        medias.append(media)
        log.add("media:acquired")
        return media
    }

    var livePeers: Int { peers.filter { !$0.closed }.count }
    var liveMedia: Int { medias.filter { !$0.released }.count }
    var capturingMedia: Int { medias.filter { $0.isCapturing }.count }
}

// MARK: - Platform

@MainActor
final class FakePermissions: MediaPermissionChecking {
    var denied: Set<PurpleCallioPermissionKind> = []
    private(set) var checked: [PurpleCallioPermissionKind] = []
    func ensureAuthorized(_ kind: PurpleCallioPermissionKind) async throws {
        checked.append(kind)
        if denied.contains(kind) { throw PurpleCallioError.permissionDenied(kind) }
    }
}

@MainActor
final class FakeScheduler: Scheduler {
    final class Timer: CancellableTimer {
        let fireAt: TimeInterval
        let block: @MainActor () -> Void
        var cancelled = false
        var fired = false
        init(fireAt: TimeInterval, block: @escaping @MainActor () -> Void) {
            self.fireAt = fireAt
            self.block = block
        }
        func cancel() { cancelled = true }
    }

    private(set) var now: TimeInterval = 0
    private(set) var timers: [Timer] = []

    func schedule(after seconds: TimeInterval, _ block: @escaping @MainActor () -> Void) -> CancellableTimer {
        let timer = Timer(fireAt: now + seconds, block: block)
        timers.append(timer)
        return timer
    }

    var activeTimers: Int { timers.filter { !$0.cancelled && !$0.fired }.count }

    func advance(by seconds: TimeInterval) {
        let target = now + seconds
        while let next = timers
            .filter({ !$0.cancelled && !$0.fired && $0.fireAt <= target })
            .min(by: { $0.fireAt < $1.fireAt }) {
            now = next.fireAt
            next.fired = true
            next.block()
        }
        now = target
    }
}

@MainActor
final class FakeAudioSession: AudioSessionControlling {
    private(set) var activations: [Bool] = [] // video flag
    private(set) var reactivations = 0
    private(set) var deactivations = 0
    private(set) var isActive = false
    private var handler: ((AudioSessionEvent) -> Void)?

    func activate(video: Bool, handler: @escaping @MainActor (AudioSessionEvent) -> Void) throws {
        activations.append(video)
        isActive = true
        self.handler = handler
    }

    func reactivate() { reactivations += 1 }

    func deactivate() {
        if isActive { deactivations += 1 }
        isActive = false
        handler = nil
    }

    func send(_ event: AudioSessionEvent) { handler?(event) }
}

@MainActor
final class FakeLifecycle: AppLifecycleObserving {
    private(set) var isObserving = false
    private var handler: ((AppLifecycleEvent) -> Void)?

    func start(handler: @escaping @MainActor (AppLifecycleEvent) -> Void) {
        isObserving = true
        self.handler = handler
    }

    func stop() {
        isObserving = false
        handler = nil
    }

    func send(_ event: AppLifecycleEvent) { handler?(event) }
}

// MARK: - Delegate recorder

@MainActor
final class RecordingDelegate: PurpleCallioMeetingDelegate {
    var states: [PurpleCallioConnectionState] = []
    var incoming: [PurpleCallioIncomingCall] = []
    var joined: [String] = []
    var left: [String] = []
    var updated: [PurpleCallioParticipant] = []
    var remoteTracks: [PurpleCallioVideoTrack] = []
    var errors: [PurpleCallioError] = []
    var ended: [PurpleCallioDisconnectReason] = []

    func meeting(_ meeting: PurpleCallioMeeting, didChangeConnectionState state: PurpleCallioConnectionState) { states.append(state) }
    func meeting(_ meeting: PurpleCallioMeeting, didReceiveIncomingCall call: PurpleCallioIncomingCall) { incoming.append(call) }
    func meeting(_ meeting: PurpleCallioMeeting, participantJoined participant: PurpleCallioParticipant) { joined.append(participant.participantId) }
    func meeting(_ meeting: PurpleCallioMeeting, participantLeft participant: PurpleCallioParticipant) { left.append(participant.participantId) }
    func meeting(_ meeting: PurpleCallioMeeting, participantUpdated participant: PurpleCallioParticipant) { updated.append(participant) }
    func meeting(_ meeting: PurpleCallioMeeting, remoteVideoTrackAdded track: PurpleCallioVideoTrack, for participant: PurpleCallioParticipant) { remoteTracks.append(track) }
    func meeting(_ meeting: PurpleCallioMeeting, didReceiveError error: PurpleCallioError) { errors.append(error) }
    func meeting(_ meeting: PurpleCallioMeeting, didEndWith reason: PurpleCallioDisconnectReason) { ended.append(reason) }
}
