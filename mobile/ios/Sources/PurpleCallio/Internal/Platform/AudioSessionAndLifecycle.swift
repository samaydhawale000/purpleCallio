import AVFoundation
import Foundation

// MARK: - Audio session

enum AudioSessionEvent {
    case interruptionBegan
    case interruptionEnded(shouldResume: Bool)
    case routeChanged(reason: String)
}

/// Audio session configuration and notifications. Real implementation on iOS only;
/// macOS has no AVAudioSession, so a no-op is used there.
@MainActor
protocol AudioSessionControlling: AnyObject {
    func activate(video: Bool, handler: @escaping @MainActor (AudioSessionEvent) -> Void) throws
    /// Re-activates after an interruption ended.
    func reactivate()
    /// Idempotent. Removes observers and deactivates.
    func deactivate()
}

@MainActor
final class NoopAudioSession: AudioSessionControlling {
    func activate(video: Bool, handler: @escaping @MainActor (AudioSessionEvent) -> Void) throws {}
    func reactivate() {}
    func deactivate() {}
}

// MARK: - App lifecycle

enum AppLifecycleEvent {
    case didEnterBackground
    case willEnterForeground
    case willTerminate
}

@MainActor
protocol AppLifecycleObserving: AnyObject {
    func start(handler: @escaping @MainActor (AppLifecycleEvent) -> Void)
    /// Idempotent.
    func stop()
}

@MainActor
final class NoopAppLifecycle: AppLifecycleObserving {
    func start(handler: @escaping @MainActor (AppLifecycleEvent) -> Void) {}
    func stop() {}
}

enum PlatformDefaults {
    @MainActor static func makeAudioSession(logger: PurpleCallioLogger) -> AudioSessionControlling {
        #if os(iOS)
        return IOSAudioSessionController(logger: logger)
        #else
        return NoopAudioSession()
        #endif
    }

    @MainActor static func makeLifecycle() -> AppLifecycleObserving {
        #if os(iOS)
        return IOSAppLifecycle()
        #else
        return NoopAppLifecycle()
        #endif
    }
}
