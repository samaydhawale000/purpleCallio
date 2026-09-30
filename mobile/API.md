# Native SDK public API (shared conceptual model)

Flutter, iOS and Android expose the same concepts with platform-idiomatic
syntax. The wire behaviour behind every call is specified in
[PROTOCOL.md](PROTOCOL.md).

## Client

`PurpleCallioClient(baseUrl, logLevel = none, iceServers = [], overrideIceServers = false)`

- `baseUrl`: **required** PurpleCallio REST API base, e.g. `https://<host>/api` (no default host).
  Socket.IO connects to the same host with a trailing `/api` removed, matching
  the hosted web app and the Nginx layout (`/api/` → REST, `/socket.io/` → signaling).
- `iceServers`: extra STUN/TURN servers, merged with the backend's
  `/turn/credentials` and de-duplicated by URL. With `overrideIceServers`,
  only these are used.
- `joinMeeting(token, options) → PurpleCallioMeeting` (async). Resolves once
  authenticated and call details are loaded, with the meeting in `ringing`.
  Throws a typed error on an invalid or expired token, or when the call is
  already over.
- `dispose()`: disposes every meeting created by this client.

`JoinOptions`: `microphoneEnabled = true`, `cameraEnabled = true` (ignored
for AUDIO calls), `cameraPosition = front`.

## Meeting

Read-only state (observable: Flutter `ValueListenable`/`Stream`, Swift
`@Published` via `ObservableObject` plus a delegate, Kotlin `StateFlow`):

| Property | Meaning |
|---|---|
| `callId`, `role` (`caller`/`receiver`), `callType` (`audio`/`video`) | From `connected` + details |
| `connectionState` | `idle, connecting, ringing, joining, connected, reconnecting, disconnected, failed` |
| `disconnectReason` | `left, remoteEnded, expired, rejected, cancelled, missed, busy, sessionReplaced` (when `disconnected`) |
| `error` | Last `PurpleCallioError` (when `failed`) |
| `localParticipant` | Always present |
| `remoteParticipant` | Present once the call is accepted, `null` after they leave |
| `participants` | `[local] + [remote?]` |
| `isMicrophoneEnabled`, `isCameraEnabled`, `isScreenSharing`, `cameraPosition` | Local media |

Operations (all async where the platform allows):

| Operation | Rules |
|---|---|
| `accept()` | Receiver only, in `ringing`. Acquires media, then accepts. |
| `reject()` | Receiver only, in `ringing`. |
| `leave()` | Always valid, idempotent. Ringing caller → cancel. Ringing receiver → reject. In call → hang up. Then full cleanup. Ends in `disconnected(left)`. |
| `enableMicrophone()` / `disableMicrophone()` / `toggleMicrophone()` | `toggle` flips the **current** state. No-op (no emit) when already in the target state. |
| `enableCamera()` / `disableCamera()` / `toggleCamera()` | Same. Throws `invalidState` on AUDIO calls. |
| `switchCamera()` | Front ↔ back. Needs a camera track. No signaling event (not a media-state change). |
| `startScreenShare()` / `stopScreenShare()` | Explicit start and stop; there is **no** `toggleScreenShare`. Throws `screenShareUnavailable` where unsupported, in AUDIO calls, or when the user declines consent. |
| `dispose()` | Releases everything without signaling (use `leave()` for a graceful end). Idempotent. |

Events (Flutter `Stream<PurpleCallioEvent>`, Swift delegate, Kotlin
`SharedFlow<PurpleCallioEvent>`): `connectionStateChanged`, `incomingCall`,
`participantJoined`, `participantLeft`, `participantUpdated`,
`remoteTrackAdded`, `error`, `ended(reason)`.

## Participant

`participantId, displayName?, avatarUrl?, role, isLocal, isMicrophoneEnabled,
isCameraEnabled, isScreenSharing, videoTrack?` (platform video track handle
for rendering). Names and avatars come from `/calls/:id/details`
(`callerName`, `receiverName`, ...). Nothing else is invented.

## Errors

A sealed or enum `PurpleCallioError`:
`invalidToken, authenticationFailed, connectionFailed(cause), signalingFailed(cause),
webrtcFailed(cause), permissionDenied(kind: camera|microphone|screen),
mediaInitializationFailed(cause), screenShareUnavailable(reason),
meetingEnded(reason), invalidState(message)`.
Raw platform errors are only ever attached as `cause`.

## Logging

`PurpleCallioLogLevel { none, error, warning, info, debug }`, default `none`,
with a pluggable log sink. Tokens, SDP credentials and TURN passwords are
never logged. The logger redacts any `token=` / `Bearer ` / `credential`
values it is given.

## Rendering helpers

- **Flutter:** `PurpleCallioVideoView(participant, mirror, fit)`, a widget
  wrapping `RTCVideoRenderer` whose lifecycle it owns.
- **iOS:** `PurpleCallioVideoView: UIView`, with `attach(participant)` and
  `detach()` (wraps `RTCMTLVideoView`).
- **Android:** `PurpleCallioVideoView: FrameLayout`, with `attach(meeting, participant)`
  and `release()` (wraps `SurfaceViewRenderer` and the shared EGL context).
