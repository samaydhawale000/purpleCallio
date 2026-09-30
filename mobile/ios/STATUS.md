# iOS SDK implementation and release status

**Implementation present; not release-ready until full Xcode and device validation passes.**

## Implemented

- Swift Package Manager library (`PurpleCallio`) targeting iOS 13+, using the
  WebRTC and Socket.IO Swift dependencies.
- Participant-token authentication, REST call lifecycle, Socket.IO signaling,
  WebRTC offer/answer/ICE handling, candidate buffering, reconnect/ICE recovery,
  participant and media state, typed errors, redacted logging, and cleanup.
- Native media permissions, audio session/interruption handling, camera and
  microphone controls, camera switching, and `UIView` video rendering.
- Swift Testing coverage for call flow, authentication, media controls, recovery,
  errors, and resource cleanup.

## Explicit limitations and validation gaps

- Screen sharing is **not supported**. The SDK intentionally throws
  `screenShareUnavailable`; ReplayKit Broadcast Upload Extension and App Group
  communication are not included.
- `mobile/ios/scripts/test.sh` passes **89 tests across 12 suites** on the macOS
  target (plus one gated interop participant, skipped unless
  `PURPLECALLIO_TOKEN` is set). With only the Command Line Tools installed,
  plain `swift test` cannot find `Testing.framework`; use the script. This
  compiles the shared engine for macOS only. It does not compile the
  `#if os(iOS)` UIKit/AVFoundation paths.
- **Real-call interop (macOS, real WebRTC + Socket.IO + REST, local server):**
  the SDK was run as caller and as receiver against the hosted web call page
  (headless Chrome, fake devices), for AUDIO and VIDEO calls. All four runs
  reached ICE `connected` on both sides, received increasing inbound RTP from
  the web peer, and ended cleanly in both hang-up directions (`remoteEnded`
  on the SDK; "Call ended" on the web page). The SDK side ran **receive-only**
  (this terminal has no camera/microphone permission), so **SDK → web media
  was not exercised.**
- Fixed during interop: socket.io-client-swift's default Starscream engine
  always sends an `Origin` header, which the hardened gateway rejects. The
  SDK now uses Apple's `URLSessionWebSocketTask` engine
  (`.useCustomEngine(false)`), which sends none.
- Holds outbound `offer`/`answer`/`ice-candidate`/`call.started` until the
  `join-call` **ack** (the gateway joins the room only after a database
  re-check). `baseURL` is required (no default host); REST keeps the `/api`
  prefix and Socket.IO connects to the host without it.
- The SwiftUI sample app described earlier was never written; there is no
  `Examples/` directory yet.
- Previously: held them until `join-call` was
  sent. The gateway drops signaling from sockets not yet in the room, and
  the Android real-server test showed the receiver's answer can be ready
  first. A regression test covers it.
- One interop run showed the web receiver's page on an "incoming" screen
  after the SDK caller hung up; two repeats showed "Call ended". Watch for
  it in device testing.
- Handles the hardened gateway's `auth-error` (terminal, no reconnect loop),
  `call.expired` (`disconnected(.expired)`), server-forced disconnects, and
  refused `join-call` acks.
- There is no full `Xcode.app`, iOS SDK build, iOS example application, or
  physical-device call validation in this environment.
- Do not publish the SPM package or mark it production-ready until a clean
  Xcode consumer build and physical iPhone/iPad media tests pass.

## Host app requirements

Add `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` to the
consumer app's `Info.plist`. The app must handle `PurpleCallioError` from
`joinMeeting`, camera/microphone operations, and incoming-call acceptance.
Tokens are participant-scoped and must not be logged or persisted in plain
text. Never embed a project API key in the app.

See [README.md](README.md) for SPM setup and a SwiftUI integration example.
