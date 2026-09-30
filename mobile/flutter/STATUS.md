# Flutter SDK implementation and release status

**Implementation present; not release-ready until Flutter and device validation passes.**

## Implemented

- `PurpleCallioClient` and `PurpleCallioMeeting`, using participant-token
  authentication, the backend REST endpoints, Socket.IO signaling, and the
  `flutter_webrtc` peer connection implementation.
- Caller/receiver flow, call state, participant snapshots/events, candidate
  buffering, ICE restart/watchdog, socket reconnect, REST call ending, and
  deterministic resource cleanup.
- Microphone/camera toggles, front/back switching, Flutter video rendering,
  participant list and lifecycle helpers.
- Android screen capture through `flutter_webrtc` and a foreground service;
  iOS screen sharing is explicitly unsupported because this package does not
  include a ReplayKit Broadcast Upload Extension.
- Unit tests with fake signaling/RTC, an example app, package README, and a
  gated real-server signaling/REST integration test.

## Verified in this environment (Flutter stable, Android SDK 35, no device)

- `flutter analyze lib test`: no errors or warnings (7 style infos).
  Fixed while getting here: `dispose()` called `reconnection(false)`, but in
  socket_io_client 3.1.6 `reconnection` is a field, so reconnection was never
  turned off. It now sets `reconnection = false`.
- `flutter test`: **87 passed, 3 skipped** (90 with the real-server tests enabled) (the skipped ones are the gated
  real-server tests). Coverage includes models, auth (ack/rejection/timeout,
  `auth-error`), caller/receiver ordering, candidate queueing, toggles,
  billing-safe muted join, remote media filtering, reconnect/re-join, ICE
  restart and watchdog (fake_async), server-side `call.ended`/`call.expired`,
  refused `join-call`, holding the answer until `join-call`, cleanup, log
  redaction, ICE merge, and widgets.
- **Real-server tests** (`test/integration/e2e_test.dart`, with
  `PURPLECALLIO_E2E_BASE_URL`/`PURPLECALLIO_E2E_API_KEY`): **3 passed**
  against the local server using the real socket_io_client + http (WebRTC
  faked): a full call, an invalid token, and caller cancel while ringing.
  The database shows the full server-side event lifecycle for those calls.
- Room-scoped messages (offer/answer/ICE/`call.started`) wait for the
  `join-call` ack. `baseUrl` is required (no default host) and Socket.IO
  connects to the host without `/api`. socket_io_client throws an uncaught
  `WebSocketConnectionClosed` after a server-initiated disconnect; the channel
  now contains that one error.
- Behaviour change to match the hardened gateway: a bare server-initiated
  disconnect is now terminal (`failed(connectionFailed)`). It used to
  trigger a manual reconnect, which would loop into the per-IP limit.
- `flutter pub publish --dry-run`: no package-content issues. The two
  warnings are git-state only (uncommitted changes; the old
  `lib/purplecallio.dart` is deleted but still tracked).
- `example/` now has Android/iOS platform folders, the README's permissions
  (AndroidManifest, Info.plist) and `minSdk = 23`; `flutter analyze` is clean.
- `flutter build apk --debug` for the example succeeds. The APK bundles
  flutter_webrtc's native `libjingle_peerconnection_so` for arm64-v8a,
  armeabi-v7a and x86_64. It has not been installed on a device.

## Not yet validated

- Anything that needs a device: real WebRTC media through `flutter_webrtc`,
  camera/microphone, `PurpleCallioVideoView` rendering, permission prompts,
  audio routes, lifecycle, and Android screen sharing (experimental).
- No iOS build (no Xcode.app here).
- Not published to pub.dev. `repository` in pubspec points at
  github.com/samaydhawale000/BlueJoinet, which must be public before
  publishing.

## Commands to release-check

```sh
flutter pub get
flutter analyze
flutter test
cd example && flutter pub get && flutter build apk --debug
```

Then run the example on physical Android and iOS devices and validate calls
against a staging PurpleCallio server. Run `test/integration/e2e_test.dart`
with test-only staging environment variables to validate the real signaling
server. Never place the API key used by that test in the app.
