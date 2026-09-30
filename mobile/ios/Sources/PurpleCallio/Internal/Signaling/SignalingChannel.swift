import Foundation

/// Socket event payload: the first argument of the event as a JSON object
/// (empty when the event carries none, for example `call-ended`).
typealias SignalingPayload = [String: Any]

enum SignalingAck {
    case response([Any])
    case timeout
}

/// Transport-level socket lifecycle, reported on the main actor.
enum SignalingLifecycleEvent {
    /// Connected (first connect and every automatic reconnect).
    case connected
    /// The connection dropped and the transport is retrying on its own.
    case droppedWillReconnect(reason: String)
    /// The connection closed for good and will not be retried.
    case closed(reason: String)
    /// A transport error (connect error, reconnect error, ...).
    case error(String)
}

/// Socket.IO abstraction. The real implementation wraps socket.io-client-swift;
/// tests inject a fake. All handlers are invoked on the main actor, in arrival order.
@MainActor
protocol SignalingChannel: AnyObject {
    var isConnected: Bool { get }
    func setLifecycleHandler(_ handler: @escaping @MainActor (SignalingLifecycleEvent) -> Void)
    func on(_ event: String, _ handler: @escaping @MainActor (SignalingPayload) -> Void)
    func connect()
    func emit(_ event: String, _ payload: SignalingPayload?)
    func emitWithAck(
        _ event: String,
        _ payload: SignalingPayload,
        timeout: TimeInterval,
        completion: @escaping @MainActor (SignalingAck) -> Void
    )
    /// Removes every handler (including the lifecycle handler).
    func removeAllHandlers()
    /// Disconnects permanently. Automatic reconnection is disabled first.
    func disconnect()
}

/// Wire event names (PROTOCOL.md).
enum WireEvent {
    // client → server
    static let authenticate = "authenticate"
    static let joinCall = "join-call"
    static let offer = "offer"
    static let answer = "answer"
    static let iceCandidate = "ice-candidate"
    static let callStarted = "call.started"
    static let callEndedDot = "call.ended"
    static let callEndedDash = "call-ended"
    static let cameraEnabled = "camera.enabled"
    static let cameraDisabled = "camera.disabled"
    static let microphoneEnabled = "microphone.enabled"
    static let microphoneDisabled = "microphone.disabled"
    static let screenShareStarted = "screenShare.started"
    static let screenShareStopped = "screenShare.stopped"

    // server → client
    static let connected = "connected"
    static let incomingCall = "incoming-call"
    static let callAccepted = "call-accepted"
    static let callRejected = "call-rejected"
    static let callCancelled = "call-cancelled"
    static let callMissed = "call-missed"
    static let callBusy = "call-busy"
    static let sessionReplaced = "session-replaced"
    static let callExpired = "call.expired"
    static let authError = "auth-error"
    static let participantJoined = "participant.joined"
    static let participantLeft = "participant.left"
}
