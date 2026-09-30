# purplecallio_flutter

PurpleCallio SDK for Flutter: 1:1 voice and video calls on **Android and iOS**,
built on WebRTC ([`flutter_webrtc`](https://pub.dev/packages/flutter_webrtc))
and Socket.IO signaling.

It has a headless core (`PurpleCallioClient`, `PurpleCallioMeeting`) that you
can drive from any UI, plus a few optional, unbranded widgets.

> **Status: 0.1.0, not yet validated on a physical device.** The engine is
> unit-tested with fakes, and its signaling and REST layers pass an
> end-to-end test against a real PurpleCallio server. Real camera,
> microphone, audio routing and NAT traversal have not been exercised on
> Android or iOS hardware yet. See [Known limitations](#known-limitations).

## Contents

- [How it fits together](#how-it-fits-together)
- [Install](#install)
- [Platform setup](#platform-setup)
- [Quick start](#quick-start)
- [Receiving a call](#receiving-a-call)
- [Video](#video)
- [Participants](#participants)
- [Microphone, camera and switching cameras](#microphone-camera-and-switching-cameras)
- [Screen sharing](#screen-sharing)
- [Connection state](#connection-state)
- [Events](#events)
- [Errors](#errors)
- [App lifecycle](#app-lifecycle)
- [Cleanup](#cleanup)
- [ICE servers](#ice-servers)
- [Logging](#logging)
- [Security](#security)
- [Supported platforms](#supported-platforms)
- [Known limitations](#known-limitations)

## How it fits together

```
Your backend ──(API key, server-side only)──► POST /calls
     │                                          │
     │◄──────── participants[].token ───────────┘
     │
     ▼ (participant token only)
Your Flutter app ──► PurpleCallioClient.joinMeeting(token)
```

Calls are **1:1**: one caller and one receiver. Your backend creates the call
with your project API key and gives each device **its own participant
token**. The app never sees the API key.

## Install

```yaml
dependencies:
  purplecallio_flutter: ^0.1.0
```

Requirements:

| | Minimum |
|---|---|
| Dart | 3.5 |
| Flutter | 3.24 |
| Android | `minSdkVersion 23` (Android 6.0), compile SDK 34+ |
| iOS | 13.0 |

## Platform setup

The SDK does not request permissions itself. When it captures media,
`flutter_webrtc` triggers the operating system's permission prompt. If the
user says no, you get a `PermissionDeniedError`. To explain the permission
before the OS asks, request it in your app first (for example with
`permission_handler`), before `joinMeeting` (caller) or `accept()`
(receiver).

### Android

`android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
```

`android/app/build.gradle(.kts)`: set `minSdk = 23` or higher. Use Java 17
`compileOptions`, which is the Flutter default.

For screen sharing (experimental), you also need the permissions and service
described under [Screen sharing](#screen-sharing).

### iOS

`ios/Runner/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Your camera is used for video calls.</string>
<key>NSMicrophoneUsageDescription</key>
<string>Your microphone is used for calls.</string>
<!-- Optional: keep call audio running when the app is in the background -->
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
  <string>voip</string>
</array>
```

`ios/Podfile`: `platform :ios, '13.0'` (or higher).

## Quick start

```dart
import 'package:purplecallio_flutter/purplecallio_flutter.dart';

final client = PurpleCallioClient(
  baseUrl: 'https://api.purplecallio.com', // the default
);

// 1. Get a participant token from YOUR backend. Never embed an API key.
final token = await myBackend.fetchPurpleCallioToken(callId);

// 2. Join. This resolves once the token is authenticated and the call
//    details are loaded, normally in `ringing`.
final meeting = await client.joinMeeting(
  token,
  options: const PurpleCallioJoinOptions(
    microphoneEnabled: true,
    cameraEnabled: true, // ignored for audio calls
  ),
);

// 3. Caller: wait. The call starts by itself when the receiver accepts.
meeting.connectionStateListenable.addListener(() {
  print(meeting.connectionState); // ringing → joining → connected
});

// 4. Hang up (cancels if still ringing), then release everything.
await meeting.leave();
await client.dispose();
```

On the caller side, `joinMeeting` also captures the microphone (and the
camera for video calls), so the OS permission prompt appears at that point.

### Your backend

Your server creates the call and returns only a token to each device:

```http
POST https://api.purplecallio.com/calls
x-api-key: <YOUR PROJECT API KEY>        ← server-side only
Content-Type: application/json

{ "callerId": "u1", "receiverId": "u2", "type": "VIDEO",
  "callerName": "Alice", "receiverName": "Bob" }
```

The response contains `participants[].token` (also `callerToken` and
`receiverToken`). Send the caller's token to the caller's device and the
receiver's token to the receiver's device, for example in a push
notification.

## Receiving a call

```dart
final meeting = await client.joinMeeting(receiverToken);
// meeting.connectionState == ringing
final incoming = meeting.incomingCall!; // callerName, callerAvatar, callType

// Accept: captures media, then accepts. The OS permission prompt appears here.
await meeting.accept();

// ...or decline:
await meeting.reject();
```

If the call already ended, was missed, or was cancelled before you joined,
`joinMeeting` throws `MeetingEndedError(reason)`.

## Video

`PurpleCallioVideoView` owns its `RTCVideoRenderer`. It creates the renderer,
switches it when the participant's track changes, and disposes it with the
widget. When there is no video, or the camera is off, it shows a placeholder.

```dart
ListenableBuilder(
  listenable: meeting,
  builder: (context, _) => Stack(children: [
    Positioned.fill(
      child: PurpleCallioVideoView(participant: meeting.remoteParticipant),
    ),
    Positioned(
      right: 16, top: 16, width: 120, height: 160,
      child: PurpleCallioVideoView(
        participant: meeting.localParticipant,
        // Local video is mirrored by default. Pass false for the back camera.
        mirror: meeting.cameraPosition == PurpleCallioCameraPosition.front,
      ),
    ),
  ]),
);
```

Options: `fit` (`cover` or `contain`) and `placeholder` (a `WidgetBuilder`).
For a custom renderer, use `participant.videoTrack?.native`, which is a
`flutter_webrtc` `MediaStream`. The meeting owns it, so do not stop or
dispose it.

## Participants

- `meeting.localParticipant` is always present.
- `meeting.remoteParticipant` is present once the call is accepted, and is
  `null` after the remote participant leaves. They may reconnect.
- `meeting.participants` is `[local, remote?]`.

Each `PurpleCallioParticipant` has `participantId`, `displayName`,
`avatarUrl` (both from the call details your backend supplied), `role`,
`isLocal`, `isMicrophoneEnabled`, `isCameraEnabled`, `isScreenSharing` and
`videoTrack`.

`PurpleCallioParticipantList(meeting: meeting)` is a minimal list widget.
`PurpleCallioParticipantsBuilder` gives you the list so you can build your own.

## Microphone, camera and switching cameras

```dart
await meeting.toggleMicrophone();     // flips the current state
await meeting.enableMicrophone();     // does nothing if already on
await meeting.disableCamera();
await meeting.switchCamera();         // front ↔ back
meeting.isMicrophoneEnabled; meeting.isCameraEnabled; meeting.cameraPosition;
await meeting.setSpeakerphoneOn(false); // earpiece. Video calls default to the speaker.
```

- Camera methods throw `InvalidStateError` in audio calls.
- A toggle flips `track.enabled` on the existing track. There is no
  renegotiation.
- Media-state events are **billing inputs** on the server. The SDK emits them
  only on real changes, never as an "initial state" announcement. If you join
  with the mic or camera off, the SDK emits exactly one `*.disabled` right
  after joining the room. The same happens if the camera cannot be captured
  and the call falls back to audio only.
- If you join with the camera off, the camera is not opened at all. The
  first `enableCamera()` captures it and attaches it to the existing video
  sender.
- **Camera indicator:** after you open the camera, `disableCamera()` stops
  sending frames but does not release the camera hardware. On some devices
  the camera-in-use indicator stays on until the call ends.

## Screen sharing

| Platform | Status |
|---|---|
| Android | **Experimental, not device-validated.** Needs an app-side foreground service (see below). |
| iOS | Not supported. `startScreenShare()` throws `ScreenShareUnavailableError`. iOS screen capture needs a Broadcast Upload Extension, which this SDK does not provide. |
| Web / desktop | Not supported. |

There is no `toggleScreenShare`. Use the explicit calls:

```dart
if (meeting.isScreenShareSupported) {
  await meeting.startScreenShare(
    beforeCapture: () => myForegroundService.start(), // Android 10+
    afterStop: () => myForegroundService.stop(),
  );
}
await meeting.stopScreenShare();
```

The SDK replaces the outgoing camera track with the screen track (no
renegotiation) and emits `screenShare.started`. `stopScreenShare()` puts the
camera back. If the user stops capture from the system UI, the SDK treats it
as a stop.

On Android 10 and later, MediaProjection requires your app to run a
**foreground service of type `mediaProjection`** while capturing. The SDK
does not ship one. Start and stop it in `beforeCapture` and `afterStop`
(for example with a foreground-service plugin), and declare it:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
<service android:name="<your service>" android:foregroundServiceType="mediaProjection" android:exported="false" />
```

Android 14 enforces stricter rules on when that service can start relative
to user consent. Test on your target devices.

## Connection state

```
idle → connecting → ringing → joining → connected ⇄ reconnecting
                                        ↘ disconnected(reason)   (terminal)
                                        ↘ failed(error)          (terminal)
```

- `ringing`: the caller is waiting for an answer, or the receiver has an
  incoming call.
- `joining`: the call was accepted, and offer/answer and ICE are in progress.
- `reconnecting`: the signaling socket dropped, or media connectivity was
  lost after it was established. The SDK reconnects, re-authenticates and
  rejoins the room by itself. The caller restarts ICE 3 s after
  `disconnected` and immediately on `failed`. If media is not back within
  15 s, the meeting moves to `failed(WebrtcFailedError)`.
- `disconnected` has a `meeting.disconnectReason`: `left`, `remoteEnded`,
  `rejected`, `cancelled`, `missed`, `busy` or `sessionReplaced`. The last
  one means the same token joined from another device.

Observe the state with `meeting.connectionStateListenable` (a
`ValueListenable`), with `meeting` itself (a `Listenable` that notifies on
any change), or with `meeting.events`.

## Events

`meeting.events` is a broadcast `Stream<PurpleCallioEvent>` of a sealed
class:

```dart
meeting.events.listen((event) {
  switch (event) {
    case ConnectionStateChangedEvent(:final state): ...
    case IncomingCallEvent(:final call): ...
    case ParticipantJoinedEvent(:final participant): ...
    case ParticipantLeftEvent(:final participant): ...
    case ParticipantUpdatedEvent(:final participant): ...
    case RemoteTrackAddedEvent(:final participant, :final kind): ...
    case ErrorEvent(:final error, :final fatal): ...
    case MeetingEndedEvent(:final reason): ...
  }
});
```

The stream closes after the meeting ends. A receiver's `IncomingCallEvent`
can fire before `joinMeeting` resolves, so read `meeting.incomingCall` after
joining.

## Errors

Every error the SDK throws or reports is a sealed `PurpleCallioError`:

| Error | When |
|---|---|
| `InvalidTokenError` | The token was rejected (invalid or expired). |
| `AuthenticationFailedError` | The server did not acknowledge authentication. |
| `ConnectionFailedError` | The socket could not connect in time. |
| `SignalingFailedError` | A REST or signaling call failed (`statusCode` for REST). |
| `WebrtcFailedError` | A WebRTC operation failed, or ICE did not recover within 15 s. |
| `PermissionDeniedError(kind)` | Camera, microphone or screen permission was denied. |
| `MediaInitializationFailedError` | Capture failed for another reason. |
| `ScreenShareUnavailableError(reason)` | Unsupported platform, audio call, no video sender, or the user declined. |
| `MeetingEndedError(reason)` | The call is already over. |
| `InvalidStateError` | The operation is not valid for this role, state or call type. |

Raw platform errors are only attached as `cause`.

## App lifecycle

`PurpleCallioLifecycle` is an opt-in `WidgetsBindingObserver`:

```dart
final lifecycle = PurpleCallioLifecycle(
  meeting,
  backgroundVideo: PurpleCallioBackgroundVideo.suspend, // default
  disposeOnDetached: true,
)..attach();
```

- `suspend` (default): while the app is backgrounded, the SDK stops sending
  camera frames and restores them on resume. It emits **no**
  `camera.disabled`/`camera.enabled` events, because the user did not turn
  the camera off. Billing and the remote UI keep treating the camera as on,
  and the remote sees a frozen or black frame. iOS usually interrupts camera
  capture in the background anyway.
- `disable`: really disables the camera (emits `camera.disabled`) and
  re-enables it on resume if it was on.
- `keep`: does nothing.
- `detached`: calls `meeting.dispose()`.

It detaches itself when the meeting ends.

## Cleanup

- `meeting.leave()` is graceful and idempotent. A ringing caller cancels, a
  ringing receiver rejects, and in a call it hangs up (the other side gets
  `call-ended`). It always ends in `disconnected(left)`.
- `meeting.dispose()` is local only. It releases everything without
  signaling, and it is idempotent.
- `client.dispose()` disposes every meeting the client created.

Cleanup closes the peer connection, stops and releases every local track
(microphone, camera, screen), clears all timers, and disconnects the socket
with auto-reconnect off. `PurpleCallioVideoView` releases its own renderer
when it is removed from the tree.

## ICE servers

The SDK fetches TURN credentials from `GET /turn/credentials` with the
participant token. If that fails, it falls back to
`stun:stun.l.google.com:19302`. You can add servers, which are merged and
de-duplicated by URL, or use only yours:

```dart
PurpleCallioClient(
  iceServers: const [
    PurpleCallioIceServer(urls: ['turn:turn.example.com:3478'],
        username: 'u', credential: 'p'),
  ],
  overrideIceServers: false,
);
```

## Logging

```dart
PurpleCallioClient(
  logLevel: PurpleCallioLogLevel.debug, // default: none
  logSink: (level, message) => myLogger.log(level.name, message),
);
```

Messages are redacted before they reach the sink: tokens, `Bearer` values,
`token=`/`credential=`/`password=` values, TURN credentials and SDP ICE
passwords. The SDK never logs SDP bodies or tokens in the first place.

## Security

- **Never put a PurpleCallio API key in an app.** Your backend creates calls
  and gives each device a participant token.
- Treat participant tokens as secrets. Do not log them, send them to
  analytics, or store them in plain storage.
- The token is sent only in `Authorization: Bearer` (REST) and in the
  Socket.IO `authenticate` payload, over the `baseUrl` you configure. Use
  `https`.

## Supported platforms

| Platform | Calls | Screen share |
|---|---|---|
| Android 6.0+ (API 23) | Yes (not device-validated) | Experimental |
| iOS 13+ | Yes (not device-validated) | No |
| Web, macOS, Windows, Linux | Not supported by this package | No |

## Known limitations

- **Not yet validated on a physical Android or iOS device.** The call engine
  is covered by unit tests with fake WebRTC. The Socket.IO and REST layers
  pass an end-to-end test against a real server. Real capture, rendering,
  audio routing, NAT traversal and background behavior still need device
  testing.
- Only 1:1 calls.
- Screen sharing works on Android only, is experimental, and needs your own
  foreground service. iOS is unsupported.
- `disableCamera()` does not release the camera hardware (see above).
- No CallKit or ConnectionService integration, and no push notifications.
  Deliver tokens and ring the device yourself.
- The optional `/calls/:id/webrtc-transport` telemetry (P2P vs TURN) is not
  reported. ICE success and failure outcomes are.

## License

MIT
