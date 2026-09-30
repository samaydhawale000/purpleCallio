import Combine
import Foundation

/// A 1:1 PurpleCallio call. Create one with `PurpleCallioClient.joinMeeting(token:options:)`.
///
/// Observe it with SwiftUI (`ObservableObject`, `@Published` state) or a
/// `PurpleCallioMeetingDelegate`. All state lives on the main actor; WebRTC and
/// socket callbacks are marshalled onto it before they touch anything.
@MainActor
public final class PurpleCallioMeeting: ObservableObject {
    // MARK: Public state

    @Published public private(set) var callId: String = ""
    @Published public private(set) var role: PurpleCallioRole = .caller
    @Published public private(set) var callType: PurpleCallioCallType = .audio
    @Published public private(set) var connectionState: PurpleCallioConnectionState = .idle
    /// Set when `connectionState == .disconnected`.
    @Published public private(set) var disconnectReason: PurpleCallioDisconnectReason?
    /// Set when `connectionState == .failed`.
    @Published public private(set) var error: PurpleCallioError?
    @Published public private(set) var localParticipant: PurpleCallioParticipant
    /// Present once the call is accepted; `nil` after the remote participant leaves.
    @Published public private(set) var remoteParticipant: PurpleCallioParticipant?
    /// RECEIVER: the call being offered, until accepted, rejected or ended.
    @Published public private(set) var incomingCall: PurpleCallioIncomingCall?
    @Published public private(set) var isMicrophoneEnabled: Bool
    @Published public private(set) var isCameraEnabled: Bool = false
    /// Always `false` in SDK 0.1.0 (screen sharing is not supported on iOS yet).
    @Published public private(set) var isScreenSharing: Bool = false
    @Published public private(set) var cameraPosition: PurpleCallioCameraPosition

    public weak var delegate: PurpleCallioMeetingDelegate?

    /// `[local] + [remote?]`.
    public var participants: [PurpleCallioParticipant] {
        [localParticipant] + (remoteParticipant.map { [$0] } ?? [])
    }

    // MARK: Dependencies

    private let token: String
    private let options: PurpleCallioJoinOptions
    private let logger: PurpleCallioLogger
    private let signaling: SignalingChannel
    private let api: PurpleCallioAPI
    private let rtc: RTCEngine
    private let permissions: MediaPermissionChecking
    private let scheduler: Scheduler
    private let audioSession: AudioSessionControlling
    private let lifecycle: AppLifecycleObserving
    private let timeouts: MeetingTimeouts
    private let customIceServers: [PurpleCallioIceServer]
    private let overrideIceServers: Bool

    // MARK: Internal state

    private enum Phase { case starting, ringing, accepting, inCall, ended }
    private var phase: Phase = .starting

    private var selfParticipantId: String?
    private var details: CallDetails?
    private var iceServers: [PurpleCallioIceServer] = [.fallbackStun]

    private var startContinuation: CheckedContinuation<Void, Error>?
    private var connectTimer: CancellableTimer?
    private var lastTransportError: String?
    private var hasAuthenticated = false
    /// Terminal event received before `joinMeeting` finished.
    private var pendingTerminalReason: PurpleCallioDisconnectReason?
    /// CALLER: `call-accepted` arrived before `joinMeeting` finished.
    private var acceptedWhileStarting = false

    private var socketConnected = false
    /// `join-call` has been emitted on the current socket connection.
    private var joinedRoom = false
    /// offer/answer/ice-candidate held until this socket has emitted `join-call`:
    /// the gateway silently drops signaling from sockets not in the room
    /// (PROTOCOL.md). A receiver's answer can be ready before its `join-call`.
    private var pendingSignals: [(event: String, payload: SignalingPayload)] = []

    private var peer: RTCPeer?
    private var media: LocalMedia?
    private var localVideoTrack: PurpleCallioVideoTrack?
    private var remoteVideoTrack: PurpleCallioVideoTrack?
    private var remoteMedia = (camera: false, microphone: true, screenShare: false)

    private let signalingQueue = SerialTaskQueue()
    private let mediaQueue = SerialTaskQueue()
    private var pendingCandidates: [IceCandidate] = []
    private var remoteDescriptionSet = false
    private var negotiating = false

    private var iceState: IceConnectionState = .new
    private var iceConnected = false
    private var iceWatchdog: CancellableTimer?
    private var iceRestartTimer: CancellableTimer?
    private var iceRestartDoneInWindow = false
    private var reportedIceSuccess = false
    private var reportedIceFailure = false
    private var reportedTransport = false

    private var audioInterrupted = false
    private var cameraStoppedForBackground = false

    private var ending = false
    private var cleanedUp = false
    private var leaveTask: Task<Void, Never>?
    /// Set by the client; called once when cleanup runs.
    var onCleanup: (() -> Void)?

    // MARK: Init

    init(
        token: String,
        options: PurpleCallioJoinOptions,
        baseURL: URL,
        customIceServers: [PurpleCallioIceServer],
        overrideIceServers: Bool,
        logger: PurpleCallioLogger,
        environment: MeetingEnvironment
    ) {
        self.token = token
        self.options = options
        self.logger = logger
        self.customIceServers = customIceServers
        self.overrideIceServers = overrideIceServers
        signaling = environment.makeSignaling(baseURL, logger)
        api = environment.makeAPI(baseURL, token, logger)
        rtc = environment.makeRTCEngine(logger)
        permissions = environment.makePermissions(logger)
        scheduler = environment.makeScheduler()
        audioSession = environment.makeAudioSession(logger)
        lifecycle = environment.makeLifecycle()
        timeouts = environment.timeouts
        isMicrophoneEnabled = options.microphoneEnabled
        cameraPosition = options.cameraPosition
        localParticipant = PurpleCallioParticipant(
            participantId: "", displayName: nil, avatarUrl: nil, role: .caller, isLocal: true,
            isMicrophoneEnabled: options.microphoneEnabled, isCameraEnabled: false,
            isScreenSharing: false, videoTrack: nil
        )
    }

    // MARK: - Join (called by PurpleCallioClient)

    func start() async throws {
        setState(.connecting)
        installSignalingHandlers()
        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                startContinuation = continuation
                connectTimer = scheduler.schedule(after: timeouts.connect) { [weak self] in
                    guard let self else { return }
                    let cause = PurpleCallioInternalError(
                        "Timed out connecting to the signaling server" + (self.lastTransportError.map { ": \($0)" } ?? "")
                    )
                    self.resumeStart(.failure(PurpleCallioError.connectionFailed(cause: cause)))
                }
                signaling.connect()
            }
            if let reason = pendingTerminalReason { throw PurpleCallioError.meetingEnded(reason) }
            guard !callId.isEmpty else {
                throw PurpleCallioError.signalingFailed(cause: PurpleCallioInternalError("No callId received in `connected`"))
            }

            async let detailsResult = api.details(callId: callId)
            async let iceResult = IceServerResolver.resolve(
                api: api, custom: customIceServers, override: overrideIceServers, logger: logger
            )
            let details = try await detailsResult
            iceServers = await iceResult
            try Task.checkCancellation()
            if let reason = pendingTerminalReason ?? details.terminalReason {
                throw PurpleCallioError.meetingEnded(reason)
            }
            if ending { throw PurpleCallioError.meetingEnded(.left) }
            apply(details: details)

            if role == .caller {
                // PROTOCOL.md caller step 2: acquire local media while ringing.
                try await acquireLocalMedia()
            }
            if let reason = pendingTerminalReason { throw PurpleCallioError.meetingEnded(reason) }
            if ending { throw PurpleCallioError.meetingEnded(.left) }

            phase = .ringing
            recomputeState()
            logger.info("Joined as \(role.rawValue) of a \(callType.rawValue) call; ringing")

            if role == .caller, details.isAccepted || acceptedWhileStarting {
                // Caller reconnecting into a live call: continue straight away.
                DispatchQueue.main.async { [weak self] in
                    MainActor.assumeIsolated { self?.beginCallerCall() }
                }
            }
            if role == .receiver, let call = incomingCall {
                DispatchQueue.main.async { [weak self] in
                    MainActor.assumeIsolated {
                        guard let self, self.phase == .ringing, self.incomingCall == call else { return }
                        self.delegate?.meeting(self, didReceiveIncomingCall: call)
                    }
                }
            }
        } catch {
            logger.warning("Join failed: \(error.localizedDescription)")
            ending = true
            cleanup()
            phase = .ended
            throw Self.normalize(error)
        }
    }

    private func resumeStart(_ result: Result<Void, Error>) {
        connectTimer?.cancel()
        connectTimer = nil
        guard let continuation = startContinuation else { return }
        startContinuation = nil
        continuation.resume(with: result)
    }

    private func apply(details: CallDetails) {
        self.details = details
        callType = details.type
        let isCaller = role == .caller
        if selfParticipantId == nil { selfParticipantId = details.participantId ?? (isCaller ? details.callerId : details.receiverId) }
        remoteMedia = (camera: details.type == .video, microphone: true, screenShare: false)
        localParticipant = PurpleCallioParticipant(
            participantId: selfParticipantId ?? "",
            displayName: isCaller ? details.callerName : details.receiverName,
            avatarUrl: isCaller ? details.callerAvatar : details.receiverAvatar,
            role: role, isLocal: true,
            isMicrophoneEnabled: isMicrophoneEnabled, isCameraEnabled: isCameraEnabled,
            isScreenSharing: false, videoTrack: localVideoTrack
        )
    }

    // MARK: - Signaling handlers

    private func installSignalingHandlers() {
        signaling.setLifecycleHandler { [weak self] event in self?.handleLifecycle(event) }

        signaling.on(WireEvent.connected) { [weak self] payload in
            guard let self else { return }
            if let callId = payload["callId"] as? String, !callId.isEmpty { self.callId = callId }
            if let participantId = payload["participantId"] as? String { self.selfParticipantId = participantId }
            if let role = PurpleCallioRole(wire: payload["role"] as? String) { self.role = role }
        }
        signaling.on(WireEvent.incomingCall) { [weak self] payload in self?.handleIncomingCall(payload) }
        signaling.on(WireEvent.callAccepted) { [weak self] _ in self?.handleCallAccepted() }
        signaling.on(WireEvent.callRejected) { [weak self] _ in self?.handleTerminal(.rejected) }
        signaling.on(WireEvent.callCancelled) { [weak self] _ in self?.handleTerminal(.cancelled) }
        signaling.on(WireEvent.callMissed) { [weak self] _ in self?.handleTerminal(.missed) }
        signaling.on(WireEvent.callBusy) { [weak self] _ in self?.handleTerminal(.busy) }
        signaling.on(WireEvent.callEndedDash) { [weak self] _ in self?.handleTerminal(.remoteEnded) }
        signaling.on(WireEvent.callEndedDot) { [weak self] _ in self?.handleTerminal(.remoteEnded) }
        signaling.on(WireEvent.sessionReplaced) { [weak self] _ in self?.handleTerminal(.sessionReplaced) }
        signaling.on(WireEvent.callExpired) { [weak self] _ in self?.handleTerminal(.expired) }
        signaling.on(WireEvent.authError) { [weak self] payload in self?.handleAuthError(payload) }

        signaling.on(WireEvent.offer) { [weak self] payload in self?.handleOffer(payload) }
        signaling.on(WireEvent.answer) { [weak self] payload in self?.handleAnswer(payload) }
        signaling.on(WireEvent.iceCandidate) { [weak self] payload in self?.handleRemoteCandidate(payload) }

        signaling.on(WireEvent.participantJoined) { [weak self] payload in self?.handleParticipantJoined(payload) }
        signaling.on(WireEvent.participantLeft) { [weak self] payload in self?.handleParticipantLeft(payload) }

        let mediaEvents: [(String, (inout (camera: Bool, microphone: Bool, screenShare: Bool)) -> Void)] = [
            (WireEvent.cameraEnabled, { $0.camera = true }),
            (WireEvent.cameraDisabled, { $0.camera = false }),
            (WireEvent.microphoneEnabled, { $0.microphone = true }),
            (WireEvent.microphoneDisabled, { $0.microphone = false }),
            (WireEvent.screenShareStarted, { $0.screenShare = true }),
            (WireEvent.screenShareStopped, { $0.screenShare = false }),
        ]
        for (event, mutate) in mediaEvents {
            signaling.on(event) { [weak self] payload in self?.handleRemoteMedia(payload, mutate) }
        }
    }

    private func handleLifecycle(_ event: SignalingLifecycleEvent) {
        guard phase != .ended else { return }
        switch event {
        case .connected:
            socketConnected = true
            joinedRoom = false
            logger.info(hasAuthenticated ? "Socket reconnected; re-authenticating" : "Socket connected; authenticating")
            authenticate()
        case .droppedWillReconnect(let reason):
            socketConnected = false
            joinedRoom = false
            logger.warning("Socket dropped (\(reason)); reconnecting")
            recomputeState()
        case .closed(let reason):
            socketConnected = false
            joinedRoom = false
            lastTransportError = reason
            if phase == .starting {
                resumeStart(.failure(PurpleCallioError.connectionFailed(cause: PurpleCallioInternalError("Socket closed: \(reason)"))))
            } else if !ending {
                fail(.connectionFailed(cause: PurpleCallioInternalError("Socket closed: \(reason)")))
            }
        case .error(let message):
            lastTransportError = message
            logger.warning("Socket error: \(message)")
        }
    }

    /// PROTOCOL.md: on every connect, `authenticate` with `{ token }` and an ack.
    private func authenticate() {
        signaling.emitWithAck(WireEvent.authenticate, ["token": token], timeout: timeouts.authAck) { [weak self] ack in
            self?.handleAuthAck(ack)
        }
    }

    private func handleAuthAck(_ ack: SignalingAck) {
        guard phase != .ended else { return }
        let isFirst = !hasAuthenticated
        switch ack {
        case .timeout:
            logger.warning("authenticate ack timed out")
            if isFirst { resumeStart(.failure(PurpleCallioError.authenticationFailed)) } else { fail(.authenticationFailed) }
        case .response(let items):
            let body = items.first as? [String: Any]
            guard let body, let success = body["success"] as? Bool else {
                if isFirst { resumeStart(.failure(PurpleCallioError.authenticationFailed)) } else { fail(.authenticationFailed) }
                return
            }
            guard success else {
                logger.warning("authenticate rejected")
                if isFirst { resumeStart(.failure(PurpleCallioError.invalidToken)) } else { fail(.invalidToken) }
                return
            }
            if let role = PurpleCallioRole(wire: body["role"] as? String) { self.role = role }
            hasAuthenticated = true
            logger.info("Authenticated as \(role.rawValue)")
            if isFirst {
                resumeStart(.success(()))
            } else {
                afterReauthentication()
            }
        }
    }

    /// PROTOCOL.md: `auth-error` precedes a server-side disconnect. It is terminal:
    /// stop reconnecting (retries count against the per-IP connection limit).
    private func handleAuthError(_ payload: SignalingPayload) {
        guard phase != .ended else { return }
        let code = payload["code"] as? String ?? "UNKNOWN"
        logger.warning("Server rejected the socket: \(code)")
        let error: PurpleCallioError = (code == "INVALID_TOKEN" || code == "TOKEN_EXPIRED")
            ? .invalidToken
            : .connectionFailed(cause: PurpleCallioInternalError("Server rejected the connection: \(code)"))
        signaling.disconnect()
        if phase == .starting { resumeStart(.failure(error)) } else if !ending { fail(error) }
    }

    /// Socket came back: re-join the room if in a call and re-check the call status
    /// (events emitted while we were offline, e.g. `call-accepted`, are lost).
    private func afterReauthentication() {
        if phase == .inCall {
            emitJoinCall()
            if role == .caller, !remoteDescriptionSet {
                // The offer may have been lost while offline: offer again (only the caller offers).
                sendOffer(iceRestart: false, thenCallStarted: false)
            }
        }
        recomputeState()
        guard phase == .ringing || phase == .inCall || phase == .accepting else { return }
        Task { [weak self] in
            guard let self else { return }
            guard let details = try? await self.api.details(callId: self.callId), self.phase != .ended, !self.ending else { return }
            if let reason = details.terminalReason {
                self.handleTerminal(reason)
            } else if self.role == .caller, self.phase == .ringing, details.isAccepted {
                self.beginCallerCall()
            }
        }
    }

    private func handleIncomingCall(_ payload: SignalingPayload) {
        guard role == .receiver, phase == .starting || phase == .ringing, incomingCall == nil else { return }
        let call = PurpleCallioIncomingCall(
            callId: (payload["callId"] as? String) ?? callId,
            callerId: (payload["callerId"] as? String) ?? "",
            callerName: payload["callerName"] as? String,
            callerAvatarUrl: payload["callerAvatar"] as? String,
            callType: PurpleCallioCallType(wire: payload["type"] as? String) ?? callType
        )
        incomingCall = call
        if phase == .ringing { delegate?.meeting(self, didReceiveIncomingCall: call) }
    }

    private func handleCallAccepted() {
        guard role == .caller else { return }
        switch phase {
        case .starting: acceptedWhileStarting = true
        case .ringing: beginCallerCall()
        default: break
        }
    }

    private func handleTerminal(_ reason: PurpleCallioDisconnectReason) {
        if phase == .starting {
            pendingTerminalReason = pendingTerminalReason ?? reason
            // `call.expired` arrives just before a `{ success: false }` ack: report the
            // real reason instead of an invalid token.
            if reason == .sessionReplaced || reason == .expired || hasAuthenticated {
                resumeStart(.failure(PurpleCallioError.meetingEnded(reason)))
            }
            return
        }
        guard phase != .ended, !ending else { return }
        logger.info("Call ended remotely: \(reason.rawValue)")
        ending = true
        finish(reason)
    }

    // MARK: - Call setup

    /// CALLER, after `call-accepted` (or details.status == ACCEPTED):
    /// `join-call` → offer → `call.started`.
    private func beginCallerCall() {
        guard role == .caller, phase == .ringing, !ending else { return }
        phase = .inCall
        addRemoteParticipantIfNeeded()
        recomputeState()
        do {
            try ensurePeer()
        } catch {
            fail(Self.normalize(error, as: { .webrtcFailed(cause: $0) }))
            return
        }
        emitJoinCall()
        sendOffer(iceRestart: false, thenCallStarted: true)
    }

    /// CALLER: create an offer, set it locally, emit `offer` (then `call.started` for the first one).
    private func sendOffer(iceRestart: Bool, thenCallStarted: Bool) {
        signalingQueue.enqueue { [weak self] in
            guard let self, let peer = self.peer, !self.ending, !self.negotiating else { return }
            self.negotiating = true
            defer { self.negotiating = false }
            do {
                let offer = try await peer.createOffer(iceRestart: iceRestart)
                try await peer.setLocalDescription(offer)
                guard !self.ending else { return }
                self.emitSignal(WireEvent.offer, ["offer": offer.wirePayload])
                if thenCallStarted { self.signaling.emit(WireEvent.callStarted, ["callId": self.callId]) }
                self.logger.info(iceRestart ? "ICE restart offer sent" : "Offer sent")
            } catch {
                if iceRestart {
                    self.logger.warning("ICE restart failed: \(error.localizedDescription)")
                } else {
                    self.fail(Self.normalize(error, as: { .webrtcFailed(cause: $0) }))
                }
            }
        }
    }

    /// RECEIVER: accept the ringing call. Media and the peer connection are ready
    /// before `POST accept` (the offer can arrive right after it).
    public func accept() async throws {
        guard role == .receiver else { throw PurpleCallioError.invalidState("Only the receiver can accept a call") }
        guard phase == .ringing, !ending else { throw PurpleCallioError.invalidState("There is no ringing call to accept") }
        phase = .accepting
        recomputeState()
        do {
            try await acquireLocalMedia()
            try ensurePeer()
        } catch {
            guard phase == .accepting, !ending else { throw Self.normalize(error) }
            // Media failed before anything was sent: back to ringing so the app can retry or reject.
            releaseMedia()
            peer?.close()
            peer = nil
            phase = .ringing
            recomputeState()
            throw Self.normalize(error)
        }
        guard phase == .accepting, !ending else { throw PurpleCallioError.meetingEnded(disconnectReason ?? .left) }
        do {
            try await api.accept(callId: callId)
        } catch {
            let normalized = Self.normalize(error, as: { .signalingFailed(cause: $0) })
            if phase != .ended { fail(normalized) }
            throw normalized
        }
        guard phase == .accepting, !ending else { throw PurpleCallioError.meetingEnded(disconnectReason ?? .left) }
        incomingCall = nil
        addRemoteParticipantIfNeeded()
        do {
            try await api.join(callId: callId)
        } catch {
            logger.warning("POST join failed (continuing): \(error.localizedDescription)")
        }
        guard phase == .accepting, !ending else { throw PurpleCallioError.meetingEnded(disconnectReason ?? .left) }
        phase = .inCall
        emitJoinCall()
        signaling.emit(WireEvent.callStarted, ["callId": callId])
        recomputeState()
        logger.info("Accepted; call.started")
    }

    /// RECEIVER: decline the ringing call. Ends in `disconnected(.rejected)`.
    public func reject() async throws {
        guard role == .receiver else { throw PurpleCallioError.invalidState("Only the receiver can reject a call") }
        guard phase == .ringing, !ending else { throw PurpleCallioError.invalidState("There is no ringing call to reject") }
        ending = true
        do {
            try await api.reject(callId: callId)
        } catch {
            logger.warning("POST reject failed: \(error.localizedDescription)")
        }
        finish(.rejected)
    }

    private func ensurePeer() throws {
        guard peer == nil else { return }
        let callbacks = RTCPeerCallbacks(
            onIceCandidate: { [weak self] candidate in
                guard let self, !self.ending, self.phase != .ended else { return }
                self.emitSignal(WireEvent.iceCandidate, ["candidate": candidate.wirePayload])
            },
            onIceConnectionState: { [weak self] state in self?.handleIceState(state) },
            onRemoteVideoTrack: { [weak self] backend in self?.handleRemoteVideoTrack(backend) }
        )
        let peer = try rtc.makePeer(iceServers: iceServers, callbacks: callbacks)
        self.peer = peer
        if let media {
            try peer.addLocalMedia(media)
        }
    }

    private func emitSignal(_ event: String, _ payload: SignalingPayload) {
        if joinedRoom, socketConnected { signaling.emit(event, payload) } else { pendingSignals.append((event, payload)) }
    }

    private func flushPendingSignals() {
        guard !pendingSignals.isEmpty else { return }
        let queued = pendingSignals
        pendingSignals.removeAll()
        logger.debug("Sending \(queued.count) signaling message(s) held until join-call")
        queued.forEach { signaling.emit($0.event, $0.payload) }
    }

    /// `join-call`, then (only on this edge) the `*.disabled` events for media that is off.
    private func emitJoinCall() {
        // If the socket is down, afterReauthentication() emits join-call on reconnect.
        guard socketConnected else { return }
        signaling.emitWithAck(WireEvent.joinCall, ["callId": callId], timeout: timeouts.authAck) { [weak self] ack in
            // The gateway acks `{ success: false, error }` when the join is refused
            // (e.g. PLAYGROUND_PARTICIPANT_LIMIT). A missing ack is not treated as failure.
            guard let self, case .response(let items) = ack,
                  let body = items.first as? [String: Any], body["success"] as? Bool == false,
                  self.phase != .ended, !self.ending else { return }
            let reason = body["error"] as? String ?? "join-call refused"
            self.fail(.signalingFailed(cause: PurpleCallioInternalError(reason)))
        }
        joinedRoom = true
        flushPendingSignals()
        // PROTOCOL.md: the server assumes call-type defaults at PARTICIPANT_JOINED
        // (VIDEO = camera on, mic on). Emit only the corrections, never `*.enabled`.
        if callType == .video, !isCameraEnabled {
            signaling.emit(WireEvent.cameraDisabled, ["callId": callId])
        }
        if !isMicrophoneEnabled {
            signaling.emit(WireEvent.microphoneDisabled, ["callId": callId])
        }
    }

    private func handleOffer(_ payload: SignalingPayload) {
        guard let offer = SessionDescription(wire: payload["offer"]) else {
            logger.warning("Ignoring malformed offer")
            return
        }
        signalingQueue.enqueue { [weak self] in
            guard let self, !self.ending, self.phase != .ended else { return }
            guard let peer = self.peer else {
                self.logger.warning("Offer received before accept; ignored")
                return
            }
            do {
                try await peer.setRemoteDescription(offer)
                self.remoteDescriptionSet = true
                await self.flushPendingCandidates()
                let answer = try await peer.createAnswer()
                try await peer.setLocalDescription(answer)
                guard !self.ending else { return }
                self.emitSignal(WireEvent.answer, ["answer": answer.wirePayload])
                self.logger.info("Answer sent")
            } catch {
                self.fail(Self.normalize(error, as: { .webrtcFailed(cause: $0) }))
            }
        }
    }

    private func handleAnswer(_ payload: SignalingPayload) {
        guard let answer = SessionDescription(wire: payload["answer"]) else {
            logger.warning("Ignoring malformed answer")
            return
        }
        signalingQueue.enqueue { [weak self] in
            guard let self, !self.ending, let peer = self.peer else { return }
            do {
                try await peer.setRemoteDescription(answer)
                self.remoteDescriptionSet = true
                await self.flushPendingCandidates()
                self.logger.info("Answer applied")
            } catch {
                self.fail(Self.normalize(error, as: { .webrtcFailed(cause: $0) }))
            }
        }
    }

    private func handleRemoteCandidate(_ payload: SignalingPayload) {
        guard let candidate = IceCandidate(wire: payload["candidate"]) else { return }
        guard remoteDescriptionSet, peer != nil else {
            pendingCandidates.append(candidate)
            return
        }
        signalingQueue.enqueue { [weak self] in
            guard let self, !self.ending, let peer = self.peer else { return }
            do {
                try await peer.addIceCandidate(candidate)
            } catch {
                self.logger.warning("addIceCandidate failed: \(error.localizedDescription)")
            }
        }
    }

    private func flushPendingCandidates() async {
        guard let peer else { return }
        let queued = pendingCandidates
        pendingCandidates = []
        for candidate in queued {
            do {
                try await peer.addIceCandidate(candidate)
            } catch {
                logger.warning("addIceCandidate (flushed) failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - ICE recovery

    private func handleIceState(_ state: IceConnectionState) {
        guard phase != .ended, !ending else { return }
        iceState = state
        logger.info("ICE \(state.rawValue)")
        switch state {
        case .connected, .completed:
            iceConnected = true
            iceWatchdog?.cancel()
            iceWatchdog = nil
            iceRestartTimer?.cancel()
            iceRestartTimer = nil
            iceRestartDoneInWindow = false
            recomputeState()
            reportIceSuccessOnce()
        case .disconnected, .failed:
            iceConnected = false
            if state == .failed { reportIceFailureOnce() }
            if iceWatchdog == nil {
                iceRestartDoneInWindow = false
                let delay = state == .failed ? 0 : timeouts.iceRestartDelay
                iceRestartTimer = scheduler.schedule(after: delay) { [weak self] in
                    self?.iceRestartTimer = nil
                    self?.restartIce()
                }
                iceWatchdog = scheduler.schedule(after: timeouts.iceWatchdog) { [weak self] in
                    guard let self else { return }
                    self.iceWatchdog = nil
                    if !self.iceConnected {
                        self.fail(.webrtcFailed(cause: PurpleCallioInternalError(
                            "ICE did not recover within \(Int(self.timeouts.iceWatchdog)) s"
                        )))
                    }
                }
            } else if state == .failed, !iceRestartDoneInWindow {
                // Hard failure inside the window: restart immediately.
                iceRestartTimer?.cancel()
                iceRestartTimer = nil
                restartIce()
            }
            recomputeState()
        case .new, .checking, .closed:
            break
        }
    }

    /// CALLER only (only one side restarts, to avoid glare).
    private func restartIce() {
        guard role == .caller, phase == .inCall, !ending, !iceConnected else { return }
        iceRestartDoneInWindow = true
        sendOffer(iceRestart: true, thenCallStarted: false)
    }

    private func reportIceSuccessOnce() {
        guard let peer else { return }
        let iceName = peer.iceConnectionStateName, pcName = peer.connectionStateName, callId = callId
        if !reportedIceSuccess {
            reportedIceSuccess = true
            Task { try? await api.reportIce(callId: callId, outcome: .success, iceConnectionState: iceName, connectionState: pcName) }
        }
        if !reportedTransport {
            reportedTransport = true
            Task { [weak self] in
                guard let self, let peer = self.peer, let type = await peer.selectedLocalCandidateType() else { return }
                try? await self.api.reportTransport(callId: callId, transport: type == "relay" ? .turn : .p2p, candidateType: type)
            }
        }
    }

    private func reportIceFailureOnce() {
        guard let peer, !reportedIceFailure else { return }
        reportedIceFailure = true
        let iceName = peer.iceConnectionStateName, pcName = peer.connectionStateName, callId = callId
        Task { try? await api.reportIce(callId: callId, outcome: .failed, iceConnectionState: iceName, connectionState: pcName) }
    }

    // MARK: - Participants and remote media

    private var remoteParticipantId: String? {
        guard let details else { return nil }
        return role == .caller ? details.receiverId : details.callerId
    }

    private func makeRemoteParticipant() -> PurpleCallioParticipant? {
        guard let details, let id = remoteParticipantId else { return nil }
        let remoteIsCaller = role == .receiver
        return PurpleCallioParticipant(
            participantId: id,
            displayName: remoteIsCaller ? details.callerName : details.receiverName,
            avatarUrl: remoteIsCaller ? details.callerAvatar : details.receiverAvatar,
            role: remoteIsCaller ? .caller : .receiver,
            isLocal: false,
            isMicrophoneEnabled: remoteMedia.microphone,
            isCameraEnabled: remoteMedia.camera,
            isScreenSharing: remoteMedia.screenShare,
            videoTrack: remoteVideoTrack
        )
    }

    private func addRemoteParticipantIfNeeded() {
        guard remoteParticipant == nil, let participant = makeRemoteParticipant() else { return }
        remoteParticipant = participant
        delegate?.meeting(self, participantJoined: participant)
    }

    private func handleParticipantJoined(_ payload: SignalingPayload) {
        guard phase == .inCall || phase == .accepting else { return }
        guard let id = payload["participantId"] as? String, id != selfParticipantId else { return }
        addRemoteParticipantIfNeeded()
    }

    private func handleParticipantLeft(_ payload: SignalingPayload) {
        guard phase != .ended else { return }
        guard let id = payload["participantId"] as? String, id != selfParticipantId else { return }
        // PROTOCOL.md: marks the remote side as gone; does not end the call.
        guard let participant = remoteParticipant, participant.participantId == id else { return }
        remoteParticipant = nil
        delegate?.meeting(self, participantLeft: participant)
    }

    private func handleRemoteMedia(
        _ payload: SignalingPayload,
        _ mutate: (inout (camera: Bool, microphone: Bool, screenShare: Bool)) -> Void
    ) {
        guard phase != .ended else { return }
        // The server broadcasts to the whole room including the sender.
        guard let id = payload["participantId"] as? String, id != selfParticipantId else { return }
        mutate(&remoteMedia)
        guard var participant = remoteParticipant else { return }
        participant.isCameraEnabled = remoteMedia.camera
        participant.isMicrophoneEnabled = remoteMedia.microphone
        participant.isScreenSharing = remoteMedia.screenShare
        guard participant != remoteParticipant else { return }
        remoteParticipant = participant
        delegate?.meeting(self, participantUpdated: participant)
    }

    private func handleRemoteVideoTrack(_ backend: VideoTrackBackend) {
        guard phase != .ended, !ending else { return }
        let track = PurpleCallioVideoTrack(backend: backend, isLocal: false)
        remoteVideoTrack?.invalidate()
        remoteVideoTrack = track
        addRemoteParticipantIfNeeded()
        guard var participant = remoteParticipant else { return }
        participant.videoTrack = track
        remoteParticipant = participant
        delegate?.meeting(self, remoteVideoTrackAdded: track, for: participant)
        delegate?.meeting(self, participantUpdated: participant)
    }

    // MARK: - Local media

    private func acquireLocalMedia() async throws {
        guard media == nil else { return }
        if rtc.capturesDevices {
            try await permissions.ensureAuthorized(.microphone)
        }
        let wantsVideo = callType == .video
        let media: LocalMedia
        do {
            media = try rtc.makeLocalMedia(video: wantsVideo)
        } catch {
            throw Self.normalize(error, as: { .mediaInitializationFailed(cause: $0) })
        }
        guard !ending else {
            media.release()
            throw PurpleCallioError.meetingEnded(disconnectReason ?? .left)
        }
        self.media = media
        media.isAudioEnabled = options.microphoneEnabled
        isMicrophoneEnabled = options.microphoneEnabled
        if let backend = media.videoTrack {
            localVideoTrack = PurpleCallioVideoTrack(backend: backend, isLocal: true)
        }
        media.isVideoEnabled = false
        isCameraEnabled = false
        if wantsVideo, options.cameraEnabled, rtc.capturesDevices {
            do {
                try await permissions.ensureAuthorized(.camera)
                try await media.startCapture(position: cameraPosition)
                if !ending {
                    media.isVideoEnabled = true
                    isCameraEnabled = true
                }
            } catch {
                // PROTOCOL.md: if video capture fails, continue audio-only. Not silent:
                // reported through the delegate and `isCameraEnabled == false`.
                let normalized = Self.normalize(error, as: { .mediaInitializationFailed(cause: $0) })
                logger.warning("Camera unavailable, continuing audio-only: \(normalized.localizedDescription)")
                pendingNonFatalErrors.append(normalized)
            }
        }
        do {
            try audioSession.activate(video: wantsVideo) { [weak self] event in self?.handleAudioSession(event) }
        } catch {
            logger.warning("Audio session configuration failed: \(error.localizedDescription)")
            pendingNonFatalErrors.append(Self.normalize(error, as: { .mediaInitializationFailed(cause: $0) }))
        }
        lifecycle.start { [weak self] event in self?.handleAppLifecycle(event) }
        updateLocalParticipant()
        flushNonFatalErrors()
    }

    private var pendingNonFatalErrors: [PurpleCallioError] = []

    private func flushNonFatalErrors() {
        guard !pendingNonFatalErrors.isEmpty else { return }
        let errors = pendingNonFatalErrors
        pendingNonFatalErrors = []
        // Deliver after joinMeeting returns so a delegate set right afterwards sees them.
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.phase != .ended else { return }
                errors.forEach { self.delegate?.meeting(self, didReceiveError: $0) }
            }
        }
    }

    private func updateLocalParticipant() {
        var participant = localParticipant
        participant.isMicrophoneEnabled = isMicrophoneEnabled
        participant.isCameraEnabled = isCameraEnabled
        participant.isScreenSharing = isScreenSharing
        participant.videoTrack = localVideoTrack
        guard participant != localParticipant else { return }
        localParticipant = participant
        delegate?.meeting(self, participantUpdated: participant)
    }

    /// Emits a media-state event only on a real change and only once in the call room.
    private func emitMediaChange(_ event: String) {
        guard joinedRoom, socketConnected, !ending else { return }
        signaling.emit(event, ["callId": callId])
    }

    private func requireLocalMedia() throws -> LocalMedia {
        guard phase != .ended, !ending else { throw PurpleCallioError.invalidState("The meeting has ended") }
        guard let media else { throw PurpleCallioError.invalidState("Local media is not started yet (accept the call first)") }
        return media
    }

    public func enableMicrophone() throws { try setMicrophone(true) }
    public func disableMicrophone() throws { try setMicrophone(false) }
    /// Flips the current microphone state.
    public func toggleMicrophone() throws { try setMicrophone(!isMicrophoneEnabled) }

    private func setMicrophone(_ enabled: Bool) throws {
        let media = try requireLocalMedia()
        guard enabled != isMicrophoneEnabled else { return }
        media.isAudioEnabled = enabled && !audioInterrupted
        isMicrophoneEnabled = enabled
        updateLocalParticipant()
        emitMediaChange(enabled ? WireEvent.microphoneEnabled : WireEvent.microphoneDisabled)
    }

    /// Starts the camera (and capture). Throws `invalidState` on AUDIO calls.
    public func enableCamera() async throws {
        try await mediaQueue.run { [weak self] in try await self?.setCamera(true) }
    }

    /// Stops sending video and stops capture, releasing the camera.
    public func disableCamera() async throws {
        try await mediaQueue.run { [weak self] in try await self?.setCamera(false) }
    }

    /// Flips the current camera state.
    public func toggleCamera() async throws {
        try await mediaQueue.run { [weak self] in
            guard let self else { return }
            try await self.setCamera(!self.isCameraEnabled)
        }
    }

    private func setCamera(_ enabled: Bool) async throws {
        guard callType == .video else { throw PurpleCallioError.invalidState("Camera is not available in an audio call") }
        let media = try requireLocalMedia()
        guard enabled != isCameraEnabled else { return }
        if enabled {
            if rtc.capturesDevices { try await permissions.ensureAuthorized(.camera) }
            do {
                try await media.startCapture(position: cameraPosition)
            } catch {
                throw Self.normalize(error, as: { .mediaInitializationFailed(cause: $0) })
            }
            guard !ending, phase != .ended else { await media.stopCapture(); return }
            media.isVideoEnabled = true
            isCameraEnabled = true
            updateLocalParticipant()
            emitMediaChange(WireEvent.cameraEnabled)
        } else {
            media.isVideoEnabled = false
            isCameraEnabled = false
            cameraStoppedForBackground = false
            updateLocalParticipant()
            emitMediaChange(WireEvent.cameraDisabled)
            await media.stopCapture()
        }
    }

    /// Front ↔ back. No signaling event. If the camera is off, only the position changes.
    public func switchCamera() async throws {
        try await mediaQueue.run { [weak self] in
            guard let self else { return }
            guard self.callType == .video else { throw PurpleCallioError.invalidState("Camera is not available in an audio call") }
            let media = try self.requireLocalMedia()
            guard media.hasVideo else { throw PurpleCallioError.invalidState("There is no camera track") }
            let next = self.cameraPosition.opposite
            if media.isCapturing {
                do {
                    try await media.startCapture(position: next)
                } catch {
                    throw Self.normalize(error, as: { .mediaInitializationFailed(cause: $0) })
                }
            }
            self.cameraPosition = next
        }
    }

    /// Not supported in SDK 0.1.0: iOS screen sharing needs a ReplayKit Broadcast Upload
    /// Extension and App Group IPC, which this package does not ship yet.
    public func startScreenShare() async throws {
        throw PurpleCallioError.screenShareUnavailable(
            reason: "Screen sharing on iOS requires a ReplayKit Broadcast Upload Extension, which PurpleCallio iOS SDK 0.1.0 does not provide"
        )
    }

    /// No-op in SDK 0.1.0 (screen sharing can never be active).
    public func stopScreenShare() async throws {
        guard isScreenSharing else { return }
    }

    // MARK: - Platform events

    private func handleAudioSession(_ event: AudioSessionEvent) {
        guard phase != .ended, let media else { return }
        switch event {
        case .interruptionBegan:
            // e.g. a phone call. Pause sending audio; not a user mute, so no signaling.
            audioInterrupted = true
            media.isAudioEnabled = false
            logger.info("Audio interrupted")
        case .interruptionEnded(let shouldResume):
            audioInterrupted = false
            audioSession.reactivate()
            media.isAudioEnabled = isMicrophoneEnabled
            logger.info("Audio interruption ended (shouldResume: \(shouldResume))")
        case .routeChanged(let reason):
            logger.info("Audio route changed: \(reason)")
        }
    }

    private func handleAppLifecycle(_ event: AppLifecycleEvent) {
        guard phase != .ended else { return }
        switch event {
        case .didEnterBackground:
            // iOS does not allow camera capture in the background: stop it, keep audio.
            guard let media, media.isCapturing else { return }
            cameraStoppedForBackground = true
            media.isVideoEnabled = false
            logger.info("App backgrounded: camera capture stopped")
            mediaQueue.enqueue { await media.stopCapture() }
        case .willEnterForeground:
            guard cameraStoppedForBackground, isCameraEnabled, let media else { return }
            cameraStoppedForBackground = false
            let position = cameraPosition
            mediaQueue.enqueue { [weak self] in
                do {
                    try await media.startCapture(position: position)
                    guard let self, !self.ending, self.isCameraEnabled else { await media.stopCapture(); return }
                    media.isVideoEnabled = true
                    self.logger.info("App foregrounded: camera capture restored")
                } catch {
                    guard let self else { return }
                    self.logger.warning("Camera restore failed: \(error.localizedDescription)")
                    self.delegate?.meeting(self, didReceiveError: Self.normalize(error, as: { .mediaInitializationFailed(cause: $0) }))
                }
            }
        case .willTerminate:
            // Best effort, synchronous: the process is about to exit.
            if phase == .inCall || phase == .accepting {
                signaling.emit(WireEvent.callEndedDot, ["callId": callId])
                signaling.emit(WireEvent.callEndedDash, nil)
                api.endDetached(callId: callId)
            }
            dispose()
        }
    }

    // MARK: - Ending

    /// Always valid and idempotent. Ringing caller → cancel; ringing receiver → reject;
    /// in a call → hang up. Then full cleanup. Ends in `disconnected(.left)`.
    public func leave() async {
        if let leaveTask {
            await leaveTask.value
            return
        }
        guard phase != .ended, !ending else { return }
        let task = Task { [weak self] () -> Void in
            guard let self else { return }
            await self.performLeave()
        }
        leaveTask = task
        await task.value
    }

    private func performLeave() async {
        ending = true
        switch phase {
        case .ringing where role == .caller:
            do {
                try await api.cancel(callId: callId)
            } catch {
                // Most likely accepted in the meantime: end it instead.
                logger.warning("POST cancel failed (\(error.localizedDescription)); ending the call instead")
                try? await api.end(callId: callId)
            }
        case .ringing:
            do { try await api.reject(callId: callId) } catch {
                logger.warning("POST reject failed: \(error.localizedDescription)")
            }
        case .accepting, .inCall:
            signaling.emit(WireEvent.callEndedDot, ["callId": callId])
            signaling.emit(WireEvent.callEndedDash, nil)
            do { try await api.leave(callId: callId) } catch { logger.warning("POST leave failed: \(error.localizedDescription)") }
            do { try await api.end(callId: callId) } catch { logger.warning("POST end failed: \(error.localizedDescription)") }
        case .starting, .ended:
            break
        }
        finish(.left)
    }

    /// Releases everything without signaling (use `leave()` for a graceful end). Idempotent.
    /// Diagnostics for interop tests (internal): ICE state and inbound RTP bytes.
    func diagnostics() async -> (ice: String, inboundBytes: Int)? {
        guard let peer else { return nil }
        return (peer.iceConnectionStateName, await peer.inboundRTPBytes())
    }

    public func dispose() {
        guard !cleanedUp else { return }
        ending = true
        let wasTerminal = connectionState.isTerminal
        cleanup()
        phase = .ended
        if !wasTerminal {
            disconnectReason = .left
            setState(.disconnected)
            delegate?.meeting(self, didEndWith: .left)
        }
    }

    private func finish(_ reason: PurpleCallioDisconnectReason) {
        guard phase != .ended || !cleanedUp else { return }
        cleanup()
        phase = .ended
        guard !connectionState.isTerminal else { return }
        disconnectReason = reason
        setState(.disconnected)
        delegate?.meeting(self, didEndWith: reason)
    }

    private func fail(_ error: PurpleCallioError) {
        guard phase != .ended else { return }
        logger.error("Meeting failed: \(error.localizedDescription)")
        ending = true
        cleanup()
        phase = .ended
        self.error = error
        setState(.failed)
        delegate?.meeting(self, didReceiveError: error)
    }

    /// Deterministic cleanup. Idempotent.
    private func cleanup() {
        guard !cleanedUp else { return }
        cleanedUp = true
        resumeStart(.failure(PurpleCallioError.meetingEnded(pendingTerminalReason ?? .left)))
        connectTimer?.cancel(); connectTimer = nil
        iceWatchdog?.cancel(); iceWatchdog = nil
        iceRestartTimer?.cancel(); iceRestartTimer = nil
        signalingQueue.cancelAll()
        mediaQueue.cancelAll()
        signaling.removeAllHandlers()
        signaling.disconnect()
        socketConnected = false
        joinedRoom = false
        pendingSignals.removeAll()
        peer?.close()
        peer = nil
        releaseMedia()
        remoteVideoTrack?.invalidate()
        remoteVideoTrack = nil
        if var remote = remoteParticipant {
            remote.videoTrack = nil
            remoteParticipant = remote
        }
        pendingCandidates = []
        remoteDescriptionSet = false
        incomingCall = nil
        lifecycle.stop()
        audioSession.deactivate()
        logger.info("Cleaned up")
        let onCleanup = self.onCleanup
        self.onCleanup = nil
        onCleanup?()
    }

    private func releaseMedia() {
        media?.release()
        media = nil
        localVideoTrack?.invalidate()
        localVideoTrack = nil
        isCameraEnabled = false
        var local = localParticipant
        local.videoTrack = nil
        local.isCameraEnabled = false
        localParticipant = local
    }

    // MARK: - State

    private func recomputeState() {
        let next: PurpleCallioConnectionState
        switch phase {
        case .starting: next = .connecting
        case .ringing: next = socketConnected ? .ringing : .reconnecting
        case .accepting: next = socketConnected ? .joining : .reconnecting
        case .inCall:
            if !socketConnected || iceWatchdog != nil { next = .reconnecting }
            else if iceConnected { next = .connected }
            else { next = .joining }
        case .ended: return
        }
        setState(next)
    }

    private func setState(_ state: PurpleCallioConnectionState) {
        guard state != connectionState, !connectionState.isTerminal else { return }
        connectionState = state
        delegate?.meeting(self, didChangeConnectionState: state)
    }

    static func normalize(
        _ error: Error,
        as wrap: (Error) -> PurpleCallioError = { .signalingFailed(cause: $0) }
    ) -> PurpleCallioError {
        if let error = error as? PurpleCallioError { return error }
        if error is CancellationError { return .meetingEnded(.left) }
        return wrap(error)
    }
}
