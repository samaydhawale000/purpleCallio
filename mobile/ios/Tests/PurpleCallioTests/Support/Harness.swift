import Foundation
import Foundation
import Testing
@testable import PurpleCallio

enum TestIDs {
    static let callId = "call-1"
    static let callerId = "caller-1"
    static let receiverId = "receiver-1"
    static let token = "tok_SUPERSECRET_12345"
}

/// Builds a `PurpleCallioClient` wired entirely to fakes.
@MainActor
final class Harness {
    let log = EventLog()
    let rtc: FakeRTCEngine
    let permissions = FakePermissions()
    let scheduler = FakeScheduler()
    let audioSession = FakeAudioSession()
    let lifecycle = FakeLifecycle()
    private(set) var signalings: [FakeSignaling] = []
    private(set) var apis: [FakeAPI] = []
    private(set) var logs: [(PurpleCallioLogLevel, String)] = []

    var role: PurpleCallioRole = .caller
    var callType: PurpleCallioCallType = .video
    var status = "RINGING"
    var authBehavior: FakeSignaling.AuthBehavior = .succeed
    var eventsBeforeAck: [(String, SignalingPayload)]?
    var autoConnect = true
    var turnResult: Result<[PurpleCallioIceServer], Error> = .success([PurpleCallioIceServer(url: "stun:stun.l.google.com:19302")])
    var customIceServers: [PurpleCallioIceServer] = []
    var overrideIceServers = false

    init() {
        rtc = FakeRTCEngine(log: log)
    }

    var signaling: FakeSignaling { signalings.last! }
    var api: FakeAPI { apis.last! }
    var peer: FakePeer { rtc.peers.last! }
    var media: FakeLocalMedia { rtc.medias.last! }

    var selfId: String { role == .caller ? TestIDs.callerId : TestIDs.receiverId }
    var remoteId: String { role == .caller ? TestIDs.receiverId : TestIDs.callerId }

    func details(status: String? = nil) -> CallDetails {
        CallDetails(
            callId: TestIDs.callId, type: callType, status: status ?? self.status,
            callerId: TestIDs.callerId, receiverId: TestIDs.receiverId,
            callerName: "Alice", callerAvatar: "https://example.com/a.png",
            receiverName: "Bob", receiverAvatar: nil,
            participantId: selfId
        )
    }

    func makeClient(logLevel: PurpleCallioLogLevel = .debug) -> PurpleCallioClient {
        var environment = MeetingEnvironment.live
        environment.makeSignaling = { [unowned self] _, _ in
            let signaling = FakeSignaling(log: self.log)
            signaling.authBehavior = self.authBehavior
            signaling.autoConnect = self.autoConnect
            signaling.role = self.role == .caller ? "CALLER" : "RECEIVER"
            signaling.connectedPayload = [
                "callId": TestIDs.callId,
                "participantId": self.selfId,
                "role": signaling.role,
            ]
            signaling.eventsBeforeAck = self.eventsBeforeAck ?? (self.role == .receiver ? [(WireEvent.incomingCall, [
                "callId": TestIDs.callId, "callerId": TestIDs.callerId, "callerName": "Alice",
                "callerAvatar": "https://example.com/a.png", "type": self.callType == .video ? "VIDEO" : "AUDIO",
            ])] : [])
            self.signalings.append(signaling)
            return signaling
        }
        environment.makeAPI = { [unowned self] _, _, _ in
            let api = FakeAPI(log: self.log, details: self.details())
            api.detailsProvider = { [unowned self] in self.details() }
            api.turnResult = self.turnResult
            self.apis.append(api)
            return api
        }
        environment.makeRTCEngine = { [unowned self] _ in self.rtc }
        environment.makePermissions = { [unowned self] _ in self.permissions }
        environment.makeScheduler = { [unowned self] in self.scheduler }
        environment.makeAudioSession = { [unowned self] _ in self.audioSession }
        environment.makeLifecycle = { [unowned self] in self.lifecycle }
        let sink: PurpleCallioLogHandler = { [weak self] level, message in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.logs.append((level, message)) }
            }
        }
        return PurpleCallioClient(
            baseURL: URL(string: "https://api.example.test")!,
            logLevel: logLevel,
            logHandler: sink,
            iceServers: customIceServers,
            overrideIceServers: overrideIceServers,
            environment: environment
        )
    }

    /// Joins and returns a ringing meeting with a recording delegate attached.
    func join(
        options: PurpleCallioJoinOptions = PurpleCallioJoinOptions(),
        client: PurpleCallioClient? = nil
    ) async throws -> (PurpleCallioMeeting, RecordingDelegate) {
        let client = client ?? makeClient()
        let meeting = try await client.joinMeeting(token: TestIDs.token, options: options)
        let delegate = RecordingDelegate()
        meeting.delegate = delegate
        retained.append((client, delegate))
        return (meeting, delegate)
    }

    private var retained: [(PurpleCallioClient, RecordingDelegate)] = []

    /// CALLER: join, receive `call-accepted`, wait for `call.started`.
    func joinCallerInCall(options: PurpleCallioJoinOptions = PurpleCallioJoinOptions()) async throws -> (PurpleCallioMeeting, RecordingDelegate) {
        role = .caller
        let (meeting, delegate) = try await join(options: options)
        signaling.receive(WireEvent.callAccepted, ["callId": TestIDs.callId])
        await waitUntil { self.signaling.count(WireEvent.callStarted) == 1 }
        return (meeting, delegate)
    }

    /// RECEIVER: join and accept.
    func joinReceiverInCall(options: PurpleCallioJoinOptions = PurpleCallioJoinOptions()) async throws -> (PurpleCallioMeeting, RecordingDelegate) {
        role = .receiver
        let (meeting, delegate) = try await join(options: options)
        try await meeting.accept()
        return (meeting, delegate)
    }

    /// Everything a meeting may hold is released.
    func assertNoResidue(sourceLocation: SourceLocation = #_sourceLocation) {
        #expect(rtc.livePeers == 0, "open peer connections", sourceLocation: sourceLocation)
        #expect(rtc.liveMedia == 0, "unreleased local media", sourceLocation: sourceLocation)
        #expect(rtc.capturingMedia == 0, "camera still capturing", sourceLocation: sourceLocation)
        #expect(scheduler.activeTimers == 0, "pending timers", sourceLocation: sourceLocation)
        #expect(!(audioSession.isActive), "audio session still active", sourceLocation: sourceLocation)
        #expect(!(lifecycle.isObserving), "lifecycle observers installed", sourceLocation: sourceLocation)
        for signaling in signalings {
            #expect(signaling.handlerCount == 0, "socket listeners left", sourceLocation: sourceLocation)
            #expect(signaling.disconnectCount >= 1, "socket not disconnected", sourceLocation: sourceLocation)
        }
    }
}

@MainActor
func waitUntil(
    timeout: TimeInterval = 2,
    sourceLocation: SourceLocation = #_sourceLocation,
    _ condition: () -> Bool
) async {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() {
        if Date() > deadline {
            Issue.record("Timed out waiting for condition", sourceLocation: sourceLocation)
            return
        }
        try? await Task.sleep(nanoseconds: 2_000_000)
    }
}

/// Lets queued main-queue work and tasks run.
@MainActor
func settle(_ iterations: Int = 20) async {
    for _ in 0..<iterations {
        try? await Task.sleep(nanoseconds: 1_000_000)
    }
}

func assertError(
    _ error: Error?,
    sourceLocation: SourceLocation = #_sourceLocation,
    _ matches: (PurpleCallioError) -> Bool
) {
    guard let error = error as? PurpleCallioError else {
        Issue.record("Expected PurpleCallioError, got \(String(describing: error))", sourceLocation: sourceLocation)
        return
    }
    #expect(matches(error), "Unexpected error: \(error)", sourceLocation: sourceLocation)
}
