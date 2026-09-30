# PurpleCallio client protocol (native SDK reference)

This is the wire contract every native SDK (Flutter, iOS, Android) implements.
It is derived from the **server** (`apps/server/src/socket/gateways/call.gateway.ts`,
`apps/server/src/call/`) and from the production hosted call page
(`apps/web/app/call/page.tsx`), which is the client that real calls run through
today. Where `@purplecallio/sdk` differs from this document, this document
matches the server and `@purplecallio/sdk` is the one that needs fixing.

Calls are **1:1**: one CALLER and one RECEIVER per call.

## Credentials

The client only ever holds a **participant token**, which your backend gets
from `POST /calls` (authenticated with the project API key, **server-side
only**). The response's `participants[].token` (also `callerToken` /
`receiverToken`) is what goes to the device. A native app must never contain
an API key.

The token is presented two ways:

| Channel | How |
|---|---|
| REST | `Authorization: Bearer <token>` |
| Socket.IO | `emit('authenticate', { token }, ack)` |

Tokens must never be logged, persisted to plain storage, or sent to analytics.

## Endpoints (all relative to the API base URL, e.g. `https://api.purplecallio.com`)

Socket.IO (v4, `websocket` transport) connects to the same base URL, default
namespace.

| Method | Path | Used for |
|---|---|---|
| GET | `/turn/credentials` | `{ iceServers: [{ urls, username?, credential? }] }`. Fall back to `stun:stun.l.google.com:19302` on any failure. |
| GET | `/calls/:callId/details` | `{ callId, type: AUDIO\|VIDEO, status, callerId, receiverId, callerName, callerAvatar, receiverName, receiverAvatar, participantId, expiresAt, branding }` |
| POST | `/calls/:callId/accept` | RECEIVER only. Server emits `call-accepted` to the CALLER. |
| POST | `/calls/:callId/reject` | RECEIVER only, while RINGING. Server emits `call-rejected` to the CALLER. |
| POST | `/calls/:callId/cancel` | CALLER only, while RINGING. Server emits `call-cancelled` to the RECEIVER. |
| POST | `/calls/:callId/join` | Records the join (receiver, after accept). |
| POST | `/calls/:callId/leave` | Records the leave. |
| POST | `/calls/:callId/end` | Ends the call (billing close-out). |
| POST | `/calls/:callId/webrtc-transport` | Optional telemetry `{ transport: P2P\|TURN, candidateType }`. |
| POST | `/calls/:callId/webrtc-ice` | Optional telemetry `{ outcome: SUCCESS\|FAILED, iceConnectionState, connectionState }`. |

## Authentication handshake

1. Connect the socket.
2. On **every** `connect` (including socket.io auto-reconnects) emit
   `authenticate` with `{ token }` **and an ack callback**. The gateway replies
   **only via the ack**: `{ success: true, role: "CALLER"|"RECEIVER" }` or
   `{ success: false }`. There is no `authenticate-result` event.
3. Before the ack, the server emits `connected`
   `{ callId, participantId, role }` to the socket. The `callId` comes from
   here, so the token alone is enough to join.
4. For a RECEIVER the server then emits exactly one of: `incoming-call`
   `{ callId, callerId, callerName, callerAvatar, type }`, or the terminal
   `call-missed` / `call-ended` / `call-rejected` / `call-cancelled` /
   `call-busy` (each `{ callId }`).
5. If the same token authenticates from another socket, the old socket gets
   `session-replaced` `{ callId }` and is force-disconnected.
6. On a bad token the server emits `auth-error` `{ code }` and then
   **disconnects the socket itself**. Codes: `INVALID_TOKEN`, `TOKEN_EXPIRED`,
   and `SOCKET_RATE_LIMITED` (more than `SOCKET_AUTH_ATTEMPTS_PER_MINUTE`
   connections per IP per minute, default 20). The ack is `{ success: false }`
   or `{ success: false, error }`. All of these are **terminal**: turn off
   socket.io reconnection and fail with `invalidToken` (for
   `INVALID_TOKEN`/`TOKEN_EXPIRED`) or `connectionFailed`. Never retry in a
   loop, because retries count against the rate limit.
7. A socket that has not authenticated within 10 s is disconnected by the
   server.
8. Browser `Origin` headers are checked against the CORS allowlist. Native
   clients should send **no** `Origin` header (socket.io's native clients
   don't by default).

## Server-side termination

The server can end a call on its own: an expired or disabled playground
call, a call ended over REST, or the last participant leaving a playground
call. It then broadcasts `call.expired` `{ callId }` or `call.ended`
`{ callId }` to the room and force-disconnects every participant socket
(socket.io reason `io server disconnect`, which the client does not retry).
Treat `call.expired` as `disconnected(expired)` and `call.ended` as
`disconnected(remoteEnded)`. A server-initiated disconnect is **never** a
reason to enter `reconnecting`.

`join-call` acks `{ success: false, error }` on failure (e.g.
`PLAYGROUND_PARTICIPANT_LIMIT`, `PLAYGROUND_CALL_EXPIRED`). Surface it as
`signalingFailed`.

`offer`, `answer`, `ice-candidate` and the media events are relayed **only
after this socket has emitted `join-call`** (room membership is checked).
Anything emitted earlier is silently dropped.

**Hold outbound signaling until `join-call`.** The receiver's `POST accept`
makes the server send `call-accepted` to the caller, so the caller's offer
can arrive while the receiver is still in `POST join`, before its own
`join-call`. Answering right away gets the answer and ICE candidates dropped,
and the call never connects. Queue `offer`/`answer`/`ice-candidate` while the
socket is not in the room, and flush them right after `join-call` (also after
a reconnect's re-join). This was observed against the real server with the
Android SDK. Keep the REST order (`accept` → `join` → `join-call`), because
billing records `PARTICIPANT_JOINED` at `join-call`.

## Call setup

The CALLER always makes the offer.

**CALLER**
1. Authenticate, `GET details` (for `type` and the remote participant's id and name).
2. Acquire local media: audio always, plus video when `type == VIDEO`. If video
   capture fails, fall back to audio only.
3. Wait for `call-accepted` `{ callId }`. If `details.status` is already
   `ACCEPTED` (caller reconnecting into a live call), continue straight away.
4. `emit('join-call', { callId })`, then create an offer, `setLocalDescription`,
   `emit('offer', { offer: { type, sdp } })`, then
   `emit('call.started', { callId })`.

**RECEIVER**
1. Authenticate, `GET details`, receive `incoming-call`. The app decides:
   `accept()` or `reject()`.
2. On accept: create the peer connection and attach local media **before**
   anything else (the offer can arrive right after step 3, and the answer has
   to carry local tracks), then `POST accept`, `POST join`,
   `emit('join-call', { callId })`, `emit('call.started', { callId })`.
3. On `offer`: `setRemoteDescription`, flush queued candidates, `createAnswer`,
   `setLocalDescription`, `emit('answer', { answer: { type, sdp } })`.
   Renegotiation offers (ICE restarts) are handled the same way.

**Both**
- `answer` `{ answer }`: `setRemoteDescription`, then flush queued candidates.
- Local ICE candidate: `emit('ice-candidate', { candidate: { candidate, sdpMid, sdpMLineIndex } })`.
- Remote `ice-candidate` `{ candidate }`: if no remote description yet, **queue
  it**; otherwise `addIceCandidate`. Candidates often arrive before the offer
  or answer.
- The server relays `offer`, `answer` and `ice-candidate` only to the other
  participant of the same call.

## Media state

Local toggles emit, with payload `{ callId }`:
`camera.enabled`, `camera.disabled`, `microphone.enabled`, `microphone.disabled`,
`screenShare.started`, `screenShare.stopped`.

- Emit **only on a real change**, never a "here is my initial state" event.
  These events are persisted as billing and usage inputs
  (`CAMERA_ENABLED`, `MIC_ENABLED`, ...), so extra emits change what the
  customer is billed. The segment builder
  (`apps/server/src/billing/usage-segment.service.ts`) assumes call-type
  defaults at `PARTICIPANT_JOINED`: VIDEO means camera on, AUDIO means mic on.
  The one exception: if the app joins with the camera or mic **off** (join
  option), emit only the matching `camera.disabled` / `microphone.disabled`,
  once, right after `join-call` (the server needs room membership first).
  That tells billing and the remote UI the truth. Never emit the `*.enabled`
  defaults.
- The server broadcasts each one to the whole room **including the sender**,
  as `{ callId, participantId, media }`, followed by `participant.updated`.
  Ignore events whose `participantId` is your own.
- Track remote media from the **dedicated** events, one field each. Do not
  use the `media` snapshot in `participant.updated`: the room service starts
  every flag at `false` and only flips the toggled field, so the snapshot is
  stale for anything not yet toggled.
- Remote defaults until an event says otherwise: `camera = (type == VIDEO)`,
  `microphone = true`, `screenShare = false`.
- The toggle itself is `track.enabled = !track.enabled` on the existing
  track. The sender is not removed and there is no renegotiation.

## Screen share

Replace the video sender's track with the screen-capture track (no
renegotiation), then emit `screenShare.started`. To stop, put the camera track
back and emit `screenShare.stopped`. If capture ends on its own (the user
stops it from the system UI), treat that as a stop.

## Recovery

- **Socket drop:** socket.io reconnects on its own. On reconnect: re-authenticate,
  and if the call was in progress, `emit('join-call', { callId })` again (the
  server removed us from the room on disconnect). While disconnected, the
  state is `reconnecting`.
- **ICE `disconnected`:** wait 3 s, then the **CALLER only** sends
  `createOffer({ iceRestart: true })` (only one side restarts, to avoid glare).
  **ICE `failed`:** restart immediately (again CALLER only).
- A 15 s watchdog starts at the first disconnect or failure. If ICE is not
  `connected`/`completed` by then, the call has **failed**.
- ICE `connected`/`completed` clears the watchdog and returns to `connected`.

## Ending

| Action | Client does | Other side receives |
|---|---|---|
| Hang up (in call) | `emit('call.ended',{callId})`, `emit('call-ended')`, `POST leave`, `POST end`, then clean up | `call-ended` (no payload) and `call.ended` |
| Caller cancels while ringing | `POST cancel`, clean up | `call-cancelled` |
| Receiver declines | `POST reject`, clean up | `call-rejected` |
| Timeout | (server) | `call-missed` |

Remote `participant.left` `{ callId, participantId }` (socket drop or
`leave-call`) marks the remote side as gone. It does **not** end the call by
itself, because the other side may be reconnecting.

Cleanup must: close the peer connection, stop and dispose every local track
and capturer (camera, microphone, screen), release renderers, clear all
timers, remove socket listeners, and disconnect the socket (no
auto-reconnect afterwards).

## Unified client state model (all native SDKs)

```
idle → connecting → ringing → joining → connected ⇄ reconnecting
                                        ↘ disconnected(reason)   (terminal)
                                        ↘ failed(error)          (terminal)
```

- `ringing`: caller waiting for accept, or receiver has an incoming call that
  has not been accepted.
- `joining`: accepted, and the offer/answer and ICE are in progress.
- `connected`: ICE `connected`/`completed`.
- Disconnect reasons: `left`, `remoteEnded`, `expired`, `rejected`, `cancelled`,
  `missed`, `busy`, `sessionReplaced`.
