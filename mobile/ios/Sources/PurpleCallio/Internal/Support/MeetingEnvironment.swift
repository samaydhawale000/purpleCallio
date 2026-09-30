import Foundation

struct MeetingTimeouts {
    /// Socket must connect and authenticate within this time on join.
    var connect: TimeInterval = 15
    /// `authenticate` ack timeout.
    var authAck: TimeInterval = 10
    /// PROTOCOL.md: wait 3 s after ICE `disconnected` before the caller restarts ICE.
    var iceRestartDelay: TimeInterval = 3
    /// PROTOCOL.md: 15 s watchdog from the first ICE disconnect / failure.
    var iceWatchdog: TimeInterval = 15
}

/// Dependency factories. `live` is the production wiring; tests substitute fakes.
@MainActor
struct MeetingEnvironment {
    var makeSignaling: @MainActor (URL, PurpleCallioLogger) -> SignalingChannel
    var makeAPI: @MainActor (URL, String, PurpleCallioLogger) -> PurpleCallioAPI
    var makeRTCEngine: @MainActor (PurpleCallioLogger) -> RTCEngine
    var makePermissions: @MainActor (PurpleCallioLogger) -> MediaPermissionChecking
    var makeScheduler: @MainActor () -> Scheduler
    var makeAudioSession: @MainActor (PurpleCallioLogger) -> AudioSessionControlling
    var makeLifecycle: @MainActor () -> AppLifecycleObserving
    var timeouts = MeetingTimeouts()

    static var live: MeetingEnvironment { live(receiveOnlyMedia: false) }

    /// `receiveOnlyMedia` is an internal integration-test hook: no device capture,
    /// receive-only transceivers, no permission prompts. Never exposed publicly.
    static func live(receiveOnlyMedia: Bool) -> MeetingEnvironment {
        MeetingEnvironment(
            makeSignaling: { url, logger in SocketIOSignalingChannel(baseURL: url, logger: logger) },
            makeAPI: { url, token, logger in URLSessionPurpleCallioAPI(baseURL: url, token: token, logger: logger) },
            makeRTCEngine: { logger in WebRTCEngine(logger: logger, receiveOnly: receiveOnlyMedia) },
            makePermissions: { logger in
                receiveOnlyMedia ? NoCapturePermissions() as MediaPermissionChecking : AVCaptureMediaPermissions(logger: logger)
            },
            makeScheduler: { MainQueueScheduler() },
            makeAudioSession: { logger in
                receiveOnlyMedia ? NoopAudioSession() as AudioSessionControlling : PlatformDefaults.makeAudioSession(logger: logger)
            },
            makeLifecycle: { PlatformDefaults.makeLifecycle() }
        )
    }
}
