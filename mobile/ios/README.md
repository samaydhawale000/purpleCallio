# PurpleCallio iOS SDK

Native Swift SDK for 1:1 audio/video calls. It uses the PurpleCallio REST and
Socket.IO protocol and a native WebRTC peer connection.

> **Preview status:** source and XCTest coverage are present, but this package
> has not passed a full Xcode build or physical-device call test in this
> environment. It is not yet published or recommended for production. See
> [STATUS.md](STATUS.md).

## Requirements and permissions

- iOS 13 or later.
- Xcode with a supported iOS SDK (required to build the iOS target).
- Add `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` to the
  host app's `Info.plist`. Explain the call feature in user-facing language.
- Ask for camera/microphone access through the SDK call flow. Handle
  `PurpleCallioError.permissionDenied` and `mediaInitializationFailed`.

Screen sharing is not implemented in this release. A ReplayKit Broadcast
Upload Extension and app-group transport are required; `startScreenShare()`
throws `screenShareUnavailable`.

## Add the package

The package is not yet published. For local development, add the repository as
a Swift Package in Xcode, or use a local package path to `mobile/ios`. When a
release tag is available, pin that tag in the app's Swift Package dependency.
The package product is `PurpleCallio`.

## Join a call

Call creation belongs on your backend. Your backend uses its project API key
to create the call and returns each participant's own token to the app. Never
embed the API key in an iOS binary.

```swift
import PurpleCallio

@MainActor
final class CallModel: ObservableObject {
    @Published private(set) var meeting: PurpleCallioMeeting?
    @Published private(set) var message = ""

    // Your PurpleCallio REST API base (Socket.IO uses the same host without /api).
    private let client = PurpleCallioClient(baseURL: URL(string: "https://<your-purplecallio-host>/api")!)

    func join(participantToken: String) async {
        do {
            meeting = try await client.joinMeeting(token: participantToken)
            message = meeting?.connectionState.rawValue ?? ""
        } catch {
            // Map PurpleCallioError to the app's user-facing call UI.
            message = error.localizedDescription
        }
    }

    func accept() async throws { try await meeting?.accept() }
    func toggleMicrophone() throws { try meeting?.toggleMicrophone() }
    func toggleCamera() async throws { try await meeting?.toggleCamera() }
    func switchCamera() async throws { try await meeting?.switchCamera() }

    func leave() async {
        await meeting?.leave()
        meeting = nil
    }
}
```

For a receiver, observe `meeting.incomingCall` or implement
`PurpleCallioMeetingDelegate`, then call `accept()` or `reject()`. Observe
`connectionState`, `participants`, media flags, and delegate events to update
your interface. `PurpleCallioVideoView` is a `UIView`; attach a participant's
`videoTrack` and call `detach()` when the view is removed.

## Media, state, and cleanup

The meeting exposes microphone/camera enable, disable, and true toggle
operations, front/back camera switching, participant state, and typed
connection/disconnect states. `toggleCamera()` flips the current camera
state. Audio calls reject camera operations with `invalidState`.

Call `leave()` for a graceful end. `dispose()` releases local resources without
signaling. `PurpleCallioClient.dispose()` disposes all meetings created by that
client. The SDK observes app foreground/background changes and audio-session
interruptions; the host app still owns its UI and app-specific lifecycle policy.

Participant tokens should be kept in memory only, sent only to the SDK, and
excluded from logs and analytics. SDK logging defaults to `.none` and redacts
tokens, TURN credentials, and ICE password material.

## Current support boundary

The source includes WebRTC, signaling, camera/microphone, remote video
rendering, reconnection, participant events, and cleanup. Screen sharing is
unsupported. Package build, consumer install, Xcode test suite, and real-device
audio/video/lifecycle calls still need validation before this SDK is released.
