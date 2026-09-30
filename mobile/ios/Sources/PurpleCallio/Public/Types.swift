import Foundation

/// SDK version. Nothing has been published yet.
public enum PurpleCallioSDK {
    public static let version = "0.1.0"
}

/// The participant's role in a 1:1 call.
public enum PurpleCallioRole: String, Equatable, Sendable {
    case caller
    case receiver

    init?(wire: String?) {
        switch wire?.uppercased() {
        case "CALLER": self = .caller
        case "RECEIVER": self = .receiver
        default: return nil
        }
    }
}

public enum PurpleCallioCallType: String, Equatable, Sendable {
    case audio
    case video

    init?(wire: String?) {
        switch wire?.uppercased() {
        case "AUDIO": self = .audio
        case "VIDEO": self = .video
        default: return nil
        }
    }
}

/// Unified client state model shared by every PurpleCallio native SDK.
///
/// `idle → connecting → ringing → joining → connected ⇄ reconnecting`, ending in
/// `disconnected` (see `PurpleCallioMeeting.disconnectReason`) or `failed`
/// (see `PurpleCallioMeeting.error`). Both terminal states are final.
public enum PurpleCallioConnectionState: String, Equatable, Sendable {
    case idle
    case connecting
    case ringing
    case joining
    case connected
    case reconnecting
    case disconnected
    case failed

    public var isTerminal: Bool { self == .disconnected || self == .failed }
}

public enum PurpleCallioDisconnectReason: String, Equatable, Sendable {
    /// This device left (`leave()`, `dispose()`).
    case left
    /// The other participant hung up, or the call was ended server-side.
    case remoteEnded
    /// The server expired the call (for example a time-limited playground call).
    case expired
    /// The receiver declined.
    case rejected
    /// The caller cancelled while ringing.
    case cancelled
    /// Nobody answered before the server's ring timeout.
    case missed
    /// The receiver was already on another call.
    case busy
    /// The same participant token authenticated from another device or socket.
    case sessionReplaced
}

public enum PurpleCallioCameraPosition: String, Equatable, Sendable {
    case front
    case back

    var opposite: PurpleCallioCameraPosition { self == .front ? .back : .front }
}

public enum PurpleCallioPermissionKind: String, Equatable, Sendable {
    case camera
    case microphone
    case screen
}

/// Options for `PurpleCallioClient.joinMeeting(token:options:)`.
public struct PurpleCallioJoinOptions: Equatable, Sendable {
    public var microphoneEnabled: Bool
    /// Ignored for AUDIO calls.
    public var cameraEnabled: Bool
    public var cameraPosition: PurpleCallioCameraPosition

    public init(
        microphoneEnabled: Bool = true,
        cameraEnabled: Bool = true,
        cameraPosition: PurpleCallioCameraPosition = .front
    ) {
        self.microphoneEnabled = microphoneEnabled
        self.cameraEnabled = cameraEnabled
        self.cameraPosition = cameraPosition
    }
}

/// A STUN/TURN server.
public struct PurpleCallioIceServer: Equatable, Sendable {
    public var urls: [String]
    public var username: String?
    public var credential: String?

    public init(urls: [String], username: String? = nil, credential: String? = nil) {
        self.urls = urls
        self.username = username
        self.credential = credential
    }

    public init(url: String, username: String? = nil, credential: String? = nil) {
        self.init(urls: [url], username: username, credential: credential)
    }

    static let fallbackStun = PurpleCallioIceServer(url: "stun:stun.l.google.com:19302")
}

/// The incoming call a RECEIVER is being offered (from the server's `incoming-call`).
public struct PurpleCallioIncomingCall: Equatable, Sendable {
    public let callId: String
    public let callerId: String
    public let callerName: String?
    public let callerAvatarUrl: String?
    public let callType: PurpleCallioCallType
}

/// A participant in the call. Value type: read the latest copy from the meeting.
public struct PurpleCallioParticipant: Identifiable, Equatable {
    public var id: String { participantId }
    public let participantId: String
    /// From `/calls/:id/details` (`callerName` / `receiverName`). Never invented.
    public internal(set) var displayName: String?
    /// From `/calls/:id/details` (`callerAvatar` / `receiverAvatar`).
    public internal(set) var avatarUrl: String?
    public let role: PurpleCallioRole
    public let isLocal: Bool
    public internal(set) var isMicrophoneEnabled: Bool
    public internal(set) var isCameraEnabled: Bool
    public internal(set) var isScreenSharing: Bool
    /// Video track to render with `PurpleCallioVideoView`. `nil` for audio calls,
    /// before the remote track arrives, and after cleanup.
    public internal(set) var videoTrack: PurpleCallioVideoTrack?

    public static func == (lhs: PurpleCallioParticipant, rhs: PurpleCallioParticipant) -> Bool {
        lhs.participantId == rhs.participantId
            && lhs.displayName == rhs.displayName
            && lhs.avatarUrl == rhs.avatarUrl
            && lhs.role == rhs.role
            && lhs.isLocal == rhs.isLocal
            && lhs.isMicrophoneEnabled == rhs.isMicrophoneEnabled
            && lhs.isCameraEnabled == rhs.isCameraEnabled
            && lhs.isScreenSharing == rhs.isScreenSharing
            && lhs.videoTrack === rhs.videoTrack
    }
}

/// Handle to a local or remote video track. Attach it to a `PurpleCallioVideoView`.
///
/// When the meeting is cleaned up the track is invalidated: every attached renderer
/// is removed and later attaches are ignored.
public final class PurpleCallioVideoTrack {
    let backend: VideoTrackBackend
    public let isLocal: Bool
    public var trackId: String { backend.trackId }
    public private(set) var isInvalidated = false
    private var renderers: [ObjectIdentifier: AnyObject] = [:]

    init(backend: VideoTrackBackend, isLocal: Bool) {
        self.backend = backend
        self.isLocal = isLocal
    }

    /// Number of renderers currently attached (diagnostics).
    public var rendererCount: Int { renderers.count }

    func addRenderer(_ renderer: AnyObject) {
        guard !isInvalidated else { return }
        let key = ObjectIdentifier(renderer)
        guard renderers[key] == nil else { return }
        renderers[key] = renderer
        backend.addRenderer(renderer)
    }

    func removeRenderer(_ renderer: AnyObject) {
        let key = ObjectIdentifier(renderer)
        guard renderers.removeValue(forKey: key) != nil else { return }
        backend.removeRenderer(renderer)
    }

    func invalidate() {
        guard !isInvalidated else { return }
        for renderer in renderers.values { backend.removeRenderer(renderer) }
        renderers.removeAll()
        isInvalidated = true
    }
}
