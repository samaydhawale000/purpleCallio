import Foundation

/// Every error the SDK surfaces. Raw platform errors are only ever attached as `cause`.
public enum PurpleCallioError: Error {
    /// The participant token was rejected (socket `authenticate` ack `{ success: false }`,
    /// or HTTP 401/403 from the REST API). Tokens are single-call and expire.
    case invalidToken
    /// The server never acknowledged `authenticate` (timeout or malformed ack).
    case authenticationFailed
    /// The socket or REST API could not be reached.
    case connectionFailed(cause: Error?)
    /// A signaling or REST step failed after authentication.
    case signalingFailed(cause: Error?)
    /// Peer connection / ICE failure (including the 15 s ICE-recovery watchdog).
    case webrtcFailed(cause: Error?)
    /// The user denied (or a policy restricts) camera / microphone / screen access.
    case permissionDenied(PurpleCallioPermissionKind)
    /// Capturing local media failed for a reason other than permission.
    case mediaInitializationFailed(cause: Error?)
    /// Screen sharing is not available. In SDK 0.1.0 it is never available on iOS.
    case screenShareUnavailable(reason: String)
    /// The call is already over (for example missed, cancelled or ended).
    case meetingEnded(PurpleCallioDisconnectReason)
    /// The operation is not valid in the current state (wrong role, wrong phase, audio call, ...).
    case invalidState(String)
}

extension PurpleCallioError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .invalidToken: return "The participant token is invalid or expired."
        case .authenticationFailed: return "The server did not acknowledge authentication."
        case .connectionFailed(let cause): return "Could not connect to PurpleCallio." + Self.describe(cause)
        case .signalingFailed(let cause): return "A signaling step failed." + Self.describe(cause)
        case .webrtcFailed(let cause): return "The media connection failed." + Self.describe(cause)
        case .permissionDenied(let kind): return "Permission to use the \(kind.rawValue) was denied."
        case .mediaInitializationFailed(let cause): return "Could not start local media." + Self.describe(cause)
        case .screenShareUnavailable(let reason): return "Screen sharing is unavailable: \(reason)"
        case .meetingEnded(let reason): return "The call has already ended (\(reason.rawValue))."
        case .invalidState(let message): return "Invalid state: \(message)"
        }
    }

    private static func describe(_ cause: Error?) -> String {
        guard let cause else { return "" }
        return " (" + PurpleCallioLogRedactor.redact(String(describing: cause)) + ")"
    }
}

/// Internal error detail attached as `cause`.
struct PurpleCallioInternalError: Error, CustomStringConvertible, Equatable {
    let description: String
    init(_ description: String) { self.description = description }
}

/// Non-2xx response from the PurpleCallio REST API. Never contains the token.
struct HTTPStatusError: Error, CustomStringConvertible, Equatable {
    let method: String
    let path: String
    let statusCode: Int
    let serverMessage: String?

    var description: String {
        "\(method) \(path) failed with HTTP \(statusCode)" + (serverMessage.map { ": \($0)" } ?? "")
    }
}
