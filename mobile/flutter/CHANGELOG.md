## 0.1.0

Initial release.

- `PurpleCallioClient.joinMeeting(token)` with a participant token: ack-based
  Socket.IO authentication on every connect, call details, ICE server fetch
  with merge/de-dup/override and STUN fallback.
- 1:1 caller and receiver flows: `accept()`, `reject()`, `leave()` (cancel,
  reject or hang up as appropriate), `dispose()`.
- Offer/answer, ICE candidate queueing until the remote description is set,
  caller-only ICE restart (3 s after `disconnected`, immediately on `failed`),
  15 s ICE watchdog, Socket.IO reconnect with re-authentication and room
  re-join.
- Media: microphone/camera enable/disable/toggle with billing-accurate events
  (emitted only on real changes; joining muted emits a single `*.disabled`),
  `switchCamera()`, experimental Android-only screen sharing.
- Remote media state from dedicated events; participants with names/avatars
  from call details.
- Typed sealed errors (`PurpleCallioError`) and events (`PurpleCallioEvent`),
  `Listenable`/`ValueListenable`/`Stream` observation.
- Redacting logger (tokens, bearer headers, TURN credentials, SDP ICE
  passwords are never logged).
- Optional widgets: `PurpleCallioVideoView`, `PurpleCallioParticipantList`,
  `PurpleCallioParticipantsBuilder`; opt-in `PurpleCallioLifecycle`.
- Not yet validated on a physical device (see README "Known limitations").
