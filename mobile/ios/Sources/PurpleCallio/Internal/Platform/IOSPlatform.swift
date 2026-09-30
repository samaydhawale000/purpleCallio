// iOS-only platform integration: AVAudioSession (through RTCAudioSession) and
// UIApplication lifecycle notifications.
//
// NOT COMPILED FOR iOS IN THE DEVELOPMENT ENVIRONMENT (no iOS SDK). See STATUS.md.
#if os(iOS)
import AVFoundation
import Foundation
import UIKit
import WebRTC

@MainActor
final class IOSAudioSessionController: AudioSessionControlling {
    private let logger: PurpleCallioLogger
    private var observers: [NSObjectProtocol] = []
    private var active = false

    init(logger: PurpleCallioLogger) { self.logger = logger }

    func activate(video: Bool, handler: @escaping @MainActor (AudioSessionEvent) -> Void) throws {
        let session = RTCAudioSession.sharedInstance()
        let configuration = RTCAudioSessionConfiguration.webRTC()
        configuration.category = AVAudioSession.Category.playAndRecord.rawValue
        configuration.mode = (video ? AVAudioSession.Mode.videoChat : AVAudioSession.Mode.voiceChat).rawValue
        var options: AVAudioSession.CategoryOptions = [.allowBluetooth, .allowBluetoothA2DP]
        if video { options.insert(.defaultToSpeaker) }
        configuration.categoryOptions = options

        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        do {
            try session.setConfiguration(configuration, active: true)
        } catch {
            throw PurpleCallioError.mediaInitializationFailed(cause: error)
        }
        active = true
        logger.info("Audio session active (\(video ? "videoChat" : "voiceChat"))")
        installObservers(handler)
    }

    private func installObservers(_ handler: @escaping @MainActor (AudioSessionEvent) -> Void) {
        removeObservers()
        let center = NotificationCenter.default
        let avSession = AVAudioSession.sharedInstance()
        observers.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification, object: avSession, queue: .main
        ) { note in
            let rawType = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            let rawOptions = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            MainActor.assumeIsolated {
                guard let rawType, let type = AVAudioSession.InterruptionType(rawValue: rawType) else { return }
                switch type {
                case .began:
                    handler(.interruptionBegan)
                case .ended:
                    let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
                    handler(.interruptionEnded(shouldResume: options.contains(.shouldResume)))
                @unknown default:
                    break
                }
            }
        })
        observers.append(center.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: avSession, queue: .main
        ) { note in
            let rawReason = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
            MainActor.assumeIsolated {
                let reason = AVAudioSession.RouteChangeReason(rawValue: rawReason)
                handler(.routeChanged(reason: Self.describe(reason)))
            }
        })
    }

    private static func describe(_ reason: AVAudioSession.RouteChangeReason?) -> String {
        switch reason {
        case .newDeviceAvailable: return "newDeviceAvailable"
        case .oldDeviceUnavailable: return "oldDeviceUnavailable"
        case .categoryChange: return "categoryChange"
        case .override: return "override"
        case .wakeFromSleep: return "wakeFromSleep"
        case .noSuitableRouteForCategory: return "noSuitableRouteForCategory"
        case .routeConfigurationChange: return "routeConfigurationChange"
        default: return "unknown"
        }
    }

    func reactivate() {
        guard active else { return }
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        do {
            try session.setActive(true)
        } catch {
            logger.warning("Audio session reactivation failed: \(error.localizedDescription)")
        }
    }

    private func removeObservers() {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers.removeAll()
    }

    func deactivate() {
        removeObservers()
        guard active else { return }
        active = false
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        do {
            try session.setActive(false)
        } catch {
            logger.warning("Audio session deactivation failed: \(error.localizedDescription)")
        }
    }
}

@MainActor
final class IOSAppLifecycle: AppLifecycleObserving {
    private var observers: [NSObjectProtocol] = []

    func start(handler: @escaping @MainActor (AppLifecycleEvent) -> Void) {
        stop()
        let center = NotificationCenter.default
        let pairs: [(Notification.Name, AppLifecycleEvent)] = [
            (UIApplication.didEnterBackgroundNotification, .didEnterBackground),
            (UIApplication.willEnterForegroundNotification, .willEnterForeground),
            (UIApplication.willTerminateNotification, .willTerminate),
        ]
        for (name, event) in pairs {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { handler(event) }
            })
        }
    }

    func stop() {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers.removeAll()
    }
}
#endif
