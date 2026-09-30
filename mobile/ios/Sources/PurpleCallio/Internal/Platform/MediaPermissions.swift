import AVFoundation
import Foundation

/// Camera / microphone authorization. Denied or restricted access throws
/// `PurpleCallioError.permissionDenied(kind)`; it never fails silently.
@MainActor
protocol MediaPermissionChecking: AnyObject {
    func ensureAuthorized(_ kind: PurpleCallioPermissionKind) async throws
}

/// `AVCaptureDevice` authorization. Requests access when `.notDetermined`.
///
/// iOS apps must declare `NSCameraUsageDescription` and `NSMicrophoneUsageDescription`
/// in Info.plist, or iOS terminates the app on the first request.
@MainActor
final class AVCaptureMediaPermissions: MediaPermissionChecking {
    private let logger: PurpleCallioLogger

    init(logger: PurpleCallioLogger) { self.logger = logger }

    func ensureAuthorized(_ kind: PurpleCallioPermissionKind) async throws {
        let mediaType: AVMediaType
        switch kind {
        case .camera: mediaType = .video
        case .microphone: mediaType = .audio
        case .screen:
            throw PurpleCallioError.screenShareUnavailable(reason: "Screen capture is not supported by this SDK version")
        }
        switch AVCaptureDevice.authorizationStatus(for: mediaType) {
        case .authorized:
            return
        case .notDetermined:
            logger.info("Requesting \(kind.rawValue) permission")
            let granted = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
                AVCaptureDevice.requestAccess(for: mediaType) { continuation.resume(returning: $0) }
            }
            if !granted { throw PurpleCallioError.permissionDenied(kind) }
        case .denied, .restricted:
            logger.warning("\(kind.rawValue) permission denied or restricted")
            throw PurpleCallioError.permissionDenied(kind)
        @unknown default:
            throw PurpleCallioError.permissionDenied(kind)
        }
    }
}

/// Internal: used only by the receive-only integration-test mode, which captures nothing.
@MainActor
final class NoCapturePermissions: MediaPermissionChecking {
    func ensureAuthorized(_ kind: PurpleCallioPermissionKind) async throws {}
}
