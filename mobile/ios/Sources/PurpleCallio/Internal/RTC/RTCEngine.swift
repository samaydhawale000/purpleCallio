import Foundation

enum SDPType: String, Equatable {
    case offer, answer, pranswer, rollback
}

struct SessionDescription: Equatable {
    let type: SDPType
    let sdp: String

    /// `{ type, sdp }` as sent inside `offer` / `answer`.
    var wirePayload: [String: Any] { ["type": type.rawValue, "sdp": sdp] }

    init(type: SDPType, sdp: String) {
        self.type = type
        self.sdp = sdp
    }

    init?(wire: Any?) {
        guard let object = wire as? [String: Any],
              let typeString = object["type"] as? String,
              let type = SDPType(rawValue: typeString),
              let sdp = object["sdp"] as? String else { return nil }
        self.init(type: type, sdp: sdp)
    }
}

struct IceCandidate: Equatable {
    let candidate: String
    let sdpMid: String?
    let sdpMLineIndex: Int32

    /// `{ candidate, sdpMid, sdpMLineIndex }` as sent inside `ice-candidate`.
    var wirePayload: [String: Any] {
        var payload: [String: Any] = ["candidate": candidate, "sdpMLineIndex": Int(sdpMLineIndex)]
        payload["sdpMid"] = sdpMid ?? NSNull()
        return payload
    }

    init(candidate: String, sdpMid: String?, sdpMLineIndex: Int32) {
        self.candidate = candidate
        self.sdpMid = sdpMid
        self.sdpMLineIndex = sdpMLineIndex
    }

    init?(wire: Any?) {
        guard let object = wire as? [String: Any],
              let candidate = object["candidate"] as? String else { return nil }
        let mid = object["sdpMid"] as? String
        let index = (object["sdpMLineIndex"] as? NSNumber)?.int32Value ?? 0
        self.init(candidate: candidate, sdpMid: mid, sdpMLineIndex: index)
    }
}

enum IceConnectionState: String, Equatable {
    case new, checking, connected, completed, failed, disconnected, closed
}

/// Callbacks from a peer connection. Implementations must deliver them on the main actor.
struct RTCPeerCallbacks {
    var onIceCandidate: @MainActor (IceCandidate) -> Void
    var onIceConnectionState: @MainActor (IceConnectionState) -> Void
    var onRemoteVideoTrack: @MainActor (VideoTrackBackend) -> Void
}

/// Platform video track (local camera or remote). Renderers are platform views.
protocol VideoTrackBackend: AnyObject {
    var trackId: String { get }
    func addRenderer(_ renderer: AnyObject)
    func removeRenderer(_ renderer: AnyObject)
}

/// Local audio + (for video calls) camera.
@MainActor
protocol LocalMedia: AnyObject {
    var hasVideo: Bool { get }
    /// `track.isEnabled` of the microphone track.
    var isAudioEnabled: Bool { get set }
    /// `track.isEnabled` of the camera track.
    var isVideoEnabled: Bool { get set }
    /// Whether the camera capturer is running (camera hardware in use).
    var isCapturing: Bool { get }
    var videoTrack: VideoTrackBackend? { get }
    /// Starts (or restarts with a new position) camera capture.
    func startCapture(position: PurpleCallioCameraPosition) async throws
    /// Stops camera capture, releasing the camera.
    func stopCapture() async
    /// Stops capture and releases every track. Idempotent.
    func release()
}

@MainActor
protocol RTCPeer: AnyObject {
    /// Adds the local tracks (audio, and video when present) as senders.
    func addLocalMedia(_ media: LocalMedia) throws
    func createOffer(iceRestart: Bool) async throws -> SessionDescription
    func createAnswer() async throws -> SessionDescription
    func setLocalDescription(_ description: SessionDescription) async throws
    func setRemoteDescription(_ description: SessionDescription) async throws
    func addIceCandidate(_ candidate: IceCandidate) async throws
    /// Replaces the video sender's track without renegotiation (`nil` sends no video).
    func replaceVideoTrack(_ track: VideoTrackBackend?) throws
    /// `candidateType` of the selected local candidate (`host`, `srflx`, `relay`, ...), if known.
    func selectedLocalCandidateType() async -> String?
    /// Total `inbound-rtp` bytes received (all kinds), from real statistics.
    func inboundRTPBytes() async -> Int
    var iceConnectionStateName: String { get }
    var connectionStateName: String { get }
    /// Idempotent.
    func close()
}

@MainActor
protocol RTCEngine: AnyObject {
    func makePeer(iceServers: [PurpleCallioIceServer], callbacks: RTCPeerCallbacks) throws -> RTCPeer
    func makeLocalMedia(video: Bool) throws -> LocalMedia
    /// Whether local media actually captures devices (false only for the internal
    /// receive-only integration-test mode, where no permission is needed).
    var capturesDevices: Bool { get }
}
