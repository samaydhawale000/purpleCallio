# Android SDK implementation and release status

**Implementation present; not release-ready until Gradle and physical-device validation passes.**

## Implemented

- Android library module using Stream's WebRTC Android binding, Socket.IO,
  OkHttp, and Kotlin coroutines; Maven publication configuration is present.
- Participant-token authentication, backend REST call lifecycle, Socket.IO
  signaling, WebRTC SDP/ICE handling, reconnect and ICE recovery, participant
  state/events, typed errors, redacted logging, and cleanup.
- Runtime permission helpers, audio focus/lifecycle handling, microphone and
  camera controls, camera switching, and `SurfaceViewRenderer`-based video.
- Android MediaProjection consent flow and foreground service for screen
  sharing. The sample app is in `sample/`.
- JVM tests with fake API/signaling/RTC/platform dependencies.

## Verified in this environment (JDK 17, Android SDK 35, no device)

- `./gradlew :purplecallio:testDebugUnitTest` passes **37 JVM tests in 7
  classes**: authentication (ack, rejection, timeout, `auth-error`), caller
  and receiver ordering, candidate queueing, toggle semantics, billing-safe
  join with mic/camera off, remote media filtering, reconnect/re-join,
  caller-only ICE restart, the 15 s watchdog, every ending path including
  server-side `call.ended`/`call.expired`, refused `join-call`, resource
  balance across join → leave → join → leave, and log redaction. A mutation
  check (removing the `call.expired` handler) makes the suite fail.
- **Real-server integration** (`RealServerIntegrationTest`, gated on
  `PURPLECALLIO_E2E_BASE_URL`/`PURPLECALLIO_E2E_API_KEY`): two meetings using
  the SDK's real io.socket signaling and OkHttp REST clients (WebRTC faked)
  complete a call through the local PurpleCallio server: auth, incoming
  call, REST accept, offer/answer/ICE relayed by the server, media-state
  relay, hang-up delivered as `remoteEnded`, balanced cleanup. An invalid
  token is rejected by the real server.
- That test found a real race, now fixed: the receiver's answer could be
  sent before its `join-call`, and the hardened gateway silently drops
  signaling from sockets not in the room. Outbound offer/answer/candidates
  are now held until `join-call` (unit regression test included).
- `:purplecallio:assembleRelease`, `:sample:assembleDebug` and
  `:purplecallio:publishToMavenLocal` succeed (AAR, sources jar, POM, Gradle
  module metadata). `lintRelease`: 0 errors, 19 warnings (mostly newer
  dependency versions available).
- A clean consumer project resolves
  `com.purplecallio:purplecallio-android:0.1.0` from `mavenLocal()`, with
  transitive `stream-webrtc-android` and `socket.io-client`, and assembles.

## Not yet validated

- Nothing that needs a device or emulator: camera capture and switching,
  microphone, audio focus/routing, `SurfaceViewRenderer` rendering, runtime
  permission prompts, app lifecycle, MediaProjection screen sharing, and
  real WebRTC media. The `org.webrtc` engine (`WebRtcEngine.kt`) compiles
  but has not run.
- No instrumentation tests have run (no emulator/device here).
- Not published to Maven Central (needs Sonatype credentials and signing).
- Do not publish or mark production-ready until physical-device calls
  (Android ↔ web, Android ↔ iOS) pass.

## Host app requirements

Request `RECORD_AUDIO` and `CAMERA` at runtime before joining/accepting. Merge
the SDK manifest, which declares network/media permissions and the internal
MediaProjection foreground service. Screen share additionally requires a
fresh `MediaProjectionManager.createScreenCaptureIntent()` consent result for
each capture. Never embed a project API key in the app; pass only that
participant's token.

See [README.md](README.md) for dependency setup and Kotlin usage.
