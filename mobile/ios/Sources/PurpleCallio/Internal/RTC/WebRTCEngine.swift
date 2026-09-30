import AVFoundation
import Foundation
import WebRTC

/// `RTCEngine` backed by Google WebRTC (stasel/WebRTC binary).
///
/// WebRTC calls its delegates on its own signaling thread. Every callback is
/// marshalled onto the main queue (FIFO, so ordering is preserved) before it
/// touches SDK state.
@MainActor
final class WebRTCEngine: RTCEngine {
    private let logger: PurpleCallioLogger
    /// Internal integration-test mode: no capture at all; peers negotiate
    /// receive-only transceivers. Never used by the public API.
    private let receiveOnly: Bool

    init(logger: PurpleCallioLogger, receiveOnly: Bool = false) {
        self.logger = logger
        self.receiveOnly = receiveOnly
    }

    var capturesDevices: Bool { !receiveOnly }

    private static var sharedFactory: RTCPeerConnectionFactory?

    static var factory: RTCPeerConnectionFactory {
        if let factory = sharedFactory { return factory }
        RTCInitializeSSL()
        let factory = RTCPeerConnectionFactory(
            encoderFactory: RTCDefaultVideoEncoderFactory(),
            decoderFactory: RTCDefaultVideoDecoderFactory()
        )
        sharedFactory = factory
        return factory
    }

    func makePeer(iceServers: [PurpleCallioIceServer], callbacks: RTCPeerCallbacks) throws -> RTCPeer {
        let configuration = RTCConfiguration()
        configuration.iceServers = iceServers.map {
            RTCIceServer(urlStrings: $0.urls, username: $0.username, credential: $0.credential)
        }
        configuration.sdpSemantics = .unifiedPlan
        configuration.continualGatheringPolicy = .gatherContinually
        configuration.bundlePolicy = .maxBundle
        configuration.rtcpMuxPolicy = .require
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let delegate = PeerDelegate(callbacks: callbacks, logger: logger)
        guard let connection = Self.factory.peerConnection(with: configuration, constraints: constraints, delegate: delegate) else {
            throw PurpleCallioError.webrtcFailed(cause: PurpleCallioInternalError("RTCPeerConnection could not be created"))
        }
        logger.info("Peer connection created with \(iceServers.count) ICE server entries")
        return WebRTCPeer(connection: connection, delegate: delegate, receiveOnly: receiveOnly, logger: logger)
    }

    func makeLocalMedia(video: Bool) throws -> LocalMedia {
        if receiveOnly { return ReceiveOnlyLocalMedia(hasVideo: video) }
        return WebRTCLocalMedia(factory: Self.factory, video: video, logger: logger)
    }
}

// MARK: - Peer

private final class PeerDelegate: NSObject, RTCPeerConnectionDelegate {
    private let callbacks: RTCPeerCallbacks
    private let logger: PurpleCallioLogger
    /// Set on the main queue by `WebRTCPeer.close()`; checked on the main queue.
    var isClosed = false

    init(callbacks: RTCPeerCallbacks, logger: PurpleCallioLogger) {
        self.callbacks = callbacks
        self.logger = logger
    }

    private func onMain(_ block: @escaping @MainActor () -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.isClosed else { return }
            MainActor.assumeIsolated { block() }
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        let state = IceConnectionState(newState)
        let callback = callbacks.onIceConnectionState
        onMain { callback(state) }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        let value = IceCandidate(candidate: candidate.sdp, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex)
        let callback = callbacks.onIceCandidate
        onMain { callback(value) }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams mediaStreams: [RTCMediaStream]) {
        guard let track = rtpReceiver.track as? RTCVideoTrack else { return }
        let backend = WebRTCVideoTrackBackend(track: track)
        let callback = callbacks.onRemoteVideoTrack
        onMain { callback(backend) }
    }
}

private extension IceConnectionState {
    init(_ state: RTCIceConnectionState) {
        switch state {
        case .new: self = .new
        case .checking: self = .checking
        case .connected: self = .connected
        case .completed: self = .completed
        case .failed: self = .failed
        case .disconnected: self = .disconnected
        case .closed: self = .closed
        case .count: self = .closed
        @unknown default: self = .new
        }
    }
}

@MainActor
private final class WebRTCPeer: RTCPeer {
    private let connection: RTCPeerConnection
    private let delegate: PeerDelegate // strong: RTCPeerConnection holds its delegate weakly
    private let receiveOnly: Bool
    private let logger: PurpleCallioLogger
    private var videoSender: RTCRtpSender?
    private var closed = false

    init(connection: RTCPeerConnection, delegate: PeerDelegate, receiveOnly: Bool, logger: PurpleCallioLogger) {
        self.connection = connection
        self.delegate = delegate
        self.receiveOnly = receiveOnly
        self.logger = logger
    }

    func addLocalMedia(_ media: LocalMedia) throws {
        if receiveOnly || !(media is WebRTCLocalMedia) {
            let initAudio = RTCRtpTransceiverInit()
            initAudio.direction = .recvOnly
            connection.addTransceiver(of: .audio, init: initAudio)
            if media.hasVideo {
                let initVideo = RTCRtpTransceiverInit()
                initVideo.direction = .recvOnly
                connection.addTransceiver(of: .video, init: initVideo)
            }
            return
        }
        guard let media = media as? WebRTCLocalMedia else { return }
        let streamId = "purplecallio-local"
        guard connection.add(media.audioTrack, streamIds: [streamId]) != nil else {
            throw PurpleCallioError.webrtcFailed(cause: PurpleCallioInternalError("Could not add the audio track"))
        }
        if let videoTrack = media.rtcVideoTrack {
            videoSender = connection.add(videoTrack, streamIds: [streamId])
            if videoSender == nil {
                throw PurpleCallioError.webrtcFailed(cause: PurpleCallioInternalError("Could not add the video track"))
            }
        }
    }

    func createOffer(iceRestart: Bool) async throws -> SessionDescription {
        var mandatory: [String: String] = [:]
        if iceRestart { mandatory[kRTCMediaConstraintsIceRestart] = kRTCMediaConstraintsValueTrue }
        let constraints = RTCMediaConstraints(mandatoryConstraints: mandatory, optionalConstraints: nil)
        return try await withCheckedThrowingContinuation { continuation in
            connection.offer(for: constraints) { sdp, error in
                if let sdp { continuation.resume(returning: SessionDescription(sdp)) }
                else { continuation.resume(throwing: PurpleCallioError.webrtcFailed(cause: error)) }
            }
        }
    }

    func createAnswer() async throws -> SessionDescription {
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        return try await withCheckedThrowingContinuation { continuation in
            connection.answer(for: constraints) { sdp, error in
                if let sdp { continuation.resume(returning: SessionDescription(sdp)) }
                else { continuation.resume(throwing: PurpleCallioError.webrtcFailed(cause: error)) }
            }
        }
    }

    func setLocalDescription(_ description: SessionDescription) async throws {
        let rtc = description.rtc
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.setLocalDescription(rtc) { error in
                if let error { continuation.resume(throwing: PurpleCallioError.webrtcFailed(cause: error)) }
                else { continuation.resume() }
            }
        }
    }

    func setRemoteDescription(_ description: SessionDescription) async throws {
        let rtc = description.rtc
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.setRemoteDescription(rtc) { error in
                if let error { continuation.resume(throwing: PurpleCallioError.webrtcFailed(cause: error)) }
                else { continuation.resume() }
            }
        }
    }

    func addIceCandidate(_ candidate: IceCandidate) async throws {
        let rtc = RTCIceCandidate(sdp: candidate.candidate, sdpMLineIndex: candidate.sdpMLineIndex, sdpMid: candidate.sdpMid)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.add(rtc) { error in
                if let error { continuation.resume(throwing: PurpleCallioError.webrtcFailed(cause: error)) }
                else { continuation.resume() }
            }
        }
    }

    func replaceVideoTrack(_ track: VideoTrackBackend?) throws {
        guard let sender = videoSender else {
            throw PurpleCallioError.invalidState("There is no video sender to replace")
        }
        sender.track = (track as? WebRTCVideoTrackBackend)?.track
    }

    func selectedLocalCandidateType() async -> String? {
        let report: RTCStatisticsReport = await withCheckedContinuation { continuation in
            connection.statistics { continuation.resume(returning: $0) }
        }
        let stats = report.statistics
        var pairId: String?
        for stat in stats.values where stat.type == "transport" {
            if let id = stat.values["selectedCandidatePairId"] as? String { pairId = id }
        }
        if pairId == nil {
            pairId = stats.values.first {
                $0.type == "candidate-pair"
                    && ($0.values["state"] as? String) == "succeeded"
                    && (($0.values["nominated"] as? NSNumber)?.boolValue ?? false)
            }?.id
        }
        guard let pairId,
              let localId = stats[pairId]?.values["localCandidateId"] as? String else { return nil }
        return stats[localId]?.values["candidateType"] as? String
    }

    func inboundRTPBytes() async -> Int {
        let report: RTCStatisticsReport = await withCheckedContinuation { continuation in
            connection.statistics { continuation.resume(returning: $0) }
        }
        return report.statistics.values
            .filter { $0.type == "inbound-rtp" }
            .reduce(0) { $0 + ((($1.values["bytesReceived"] as? NSNumber)?.intValue) ?? 0) }
    }

    var iceConnectionStateName: String { IceConnectionState(connection.iceConnectionState).rawValue }

    var connectionStateName: String {
        switch connection.connectionState {
        case .new: return "new"
        case .connecting: return "connecting"
        case .connected: return "connected"
        case .disconnected: return "disconnected"
        case .failed: return "failed"
        case .closed: return "closed"
        @unknown default: return "unknown"
        }
    }

    func close() {
        guard !closed else { return }
        closed = true
        delegate.isClosed = true
        videoSender = nil
        connection.close()
        logger.info("Peer connection closed")
    }
}

private extension SessionDescription {
    init(_ rtc: RTCSessionDescription) {
        let type: SDPType
        switch rtc.type {
        case .offer: type = .offer
        case .answer: type = .answer
        case .prAnswer: type = .pranswer
        case .rollback: type = .rollback
        @unknown default: type = .offer
        }
        self.init(type: type, sdp: rtc.sdp)
    }

    var rtc: RTCSessionDescription {
        let rtcType: RTCSdpType
        switch type {
        case .offer: rtcType = .offer
        case .answer: rtcType = .answer
        case .pranswer: rtcType = .prAnswer
        case .rollback: rtcType = .rollback
        }
        return RTCSessionDescription(type: rtcType, sdp: sdp)
    }
}

// MARK: - Tracks

final class WebRTCVideoTrackBackend: VideoTrackBackend {
    let track: RTCVideoTrack
    init(track: RTCVideoTrack) { self.track = track }
    var trackId: String { track.trackId }

    func addRenderer(_ renderer: AnyObject) {
        guard let renderer = renderer as? RTCVideoRenderer else { return }
        track.add(renderer)
    }

    func removeRenderer(_ renderer: AnyObject) {
        guard let renderer = renderer as? RTCVideoRenderer else { return }
        track.remove(renderer)
    }
}

/// Microphone track plus, for video calls, a camera track fed by `RTCCameraVideoCapturer`.
@MainActor
final class WebRTCLocalMedia: LocalMedia {
    let audioTrack: RTCAudioTrack
    let rtcVideoTrack: RTCVideoTrack?
    private let videoBackend: WebRTCVideoTrackBackend?
    private let capturer: RTCCameraVideoCapturer?
    private let logger: PurpleCallioLogger
    private(set) var isCapturing = false
    private var released = false

    init(factory: RTCPeerConnectionFactory, video: Bool, logger: PurpleCallioLogger) {
        self.logger = logger
        let audioConstraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let audioSource = factory.audioSource(with: audioConstraints)
        audioTrack = factory.audioTrack(with: audioSource, trackId: "purplecallio-audio-\(UUID().uuidString)")
        if video {
            let videoSource = factory.videoSource()
            let track = factory.videoTrack(with: videoSource, trackId: "purplecallio-video-\(UUID().uuidString)")
            track.isEnabled = false // enabled once capture is running
            rtcVideoTrack = track
            videoBackend = WebRTCVideoTrackBackend(track: track)
            capturer = RTCCameraVideoCapturer(delegate: videoSource)
        } else {
            rtcVideoTrack = nil
            videoBackend = nil
            capturer = nil
        }
    }

    var hasVideo: Bool { rtcVideoTrack != nil }

    var isAudioEnabled: Bool {
        get { audioTrack.isEnabled }
        set { audioTrack.isEnabled = newValue }
    }

    var isVideoEnabled: Bool {
        get { rtcVideoTrack?.isEnabled ?? false }
        set { rtcVideoTrack?.isEnabled = newValue }
    }

    var videoTrack: VideoTrackBackend? { videoBackend }

    func startCapture(position: PurpleCallioCameraPosition) async throws {
        guard !released, let capturer else {
            throw PurpleCallioError.mediaInitializationFailed(cause: PurpleCallioInternalError("No video track"))
        }
        let devices = RTCCameraVideoCapturer.captureDevices()
        let wanted: AVCaptureDevice.Position = position == .front ? .front : .back
        guard let device = devices.first(where: { $0.position == wanted }) ?? devices.first else {
            throw PurpleCallioError.mediaInitializationFailed(cause: PurpleCallioInternalError("No camera available"))
        }
        guard let format = Self.bestFormat(for: device) else {
            throw PurpleCallioError.mediaInitializationFailed(cause: PurpleCallioInternalError("No usable camera format"))
        }
        let maxFps = format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 30
        let fps = Int(min(maxFps, 30))
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            capturer.startCapture(with: device, format: format, fps: fps) { error in
                if let error { continuation.resume(throwing: PurpleCallioError.mediaInitializationFailed(cause: error)) }
                else { continuation.resume() }
            }
        }
        if released {
            // Released while starting: make sure the camera is not left running.
            await stopCapture()
            return
        }
        isCapturing = true
        logger.info("Camera capture started (\(position.rawValue), \(fps) fps)")
    }

    func stopCapture() async {
        guard let capturer, isCapturing || released else { return }
        isCapturing = false
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            capturer.stopCapture { continuation.resume() }
        }
        logger.info("Camera capture stopped")
    }

    func release() {
        guard !released else { return }
        released = true
        audioTrack.isEnabled = false
        rtcVideoTrack?.isEnabled = false
        if let capturer {
            // Fire-and-forget: release() must be synchronous for deterministic cleanup.
            // stopCapture stops the AVCaptureSession (camera LED off) asynchronously.
            capturer.stopCapture()
        }
        isCapturing = false
    }

    /// Picks the format closest to 1280x720.
    private static func bestFormat(for device: AVCaptureDevice) -> AVCaptureDevice.Format? {
        let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
        let target: Int32 = 1280 * 720
        return formats.min { a, b in
            let da = CMVideoFormatDescriptionGetDimensions(a.formatDescription)
            let db = CMVideoFormatDescriptionGetDimensions(b.formatDescription)
            return abs(da.width * da.height - target) < abs(db.width * db.height - target)
        }
    }
}

/// Internal integration-test media: captures nothing.
@MainActor
final class ReceiveOnlyLocalMedia: LocalMedia {
    let hasVideo: Bool
    var isAudioEnabled = true
    var isVideoEnabled = false
    var isCapturing: Bool { false }
    var videoTrack: VideoTrackBackend? { nil }
    init(hasVideo: Bool) { self.hasVideo = hasVideo }
    func startCapture(position: PurpleCallioCameraPosition) async throws {
        throw PurpleCallioError.mediaInitializationFailed(cause: PurpleCallioInternalError("Receive-only mode"))
    }
    func stopCapture() async {}
    func release() {}
}
