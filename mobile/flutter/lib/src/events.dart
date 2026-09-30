import 'errors.dart';
import 'models.dart';

/// Events published on `PurpleCallioMeeting.events`.
sealed class PurpleCallioEvent {
  const PurpleCallioEvent();
}

final class ConnectionStateChangedEvent extends PurpleCallioEvent {
  const ConnectionStateChangedEvent(this.state, this.previous);
  final PurpleCallioConnectionState state;
  final PurpleCallioConnectionState previous;
  @override
  String toString() => 'ConnectionStateChanged(${previous.name} -> ${state.name})';
}

/// Receiver only: the call is ringing and waiting for `accept()`/`reject()`.
///
/// This can fire before `joinMeeting` resolves (the server sends it during
/// authentication); `PurpleCallioMeeting.incomingCall` holds the same data.
final class IncomingCallEvent extends PurpleCallioEvent {
  const IncomingCallEvent(this.call);
  final PurpleCallioIncomingCall call;
}

final class ParticipantJoinedEvent extends PurpleCallioEvent {
  const ParticipantJoinedEvent(this.participant);
  final PurpleCallioParticipant participant;
}

/// The remote participant left the room (socket drop or leave). This does not
/// end the call by itself; they may reconnect.
final class ParticipantLeftEvent extends PurpleCallioEvent {
  const ParticipantLeftEvent(this.participant);
  final PurpleCallioParticipant participant;
}

final class ParticipantUpdatedEvent extends PurpleCallioEvent {
  const ParticipantUpdatedEvent(this.participant);
  final PurpleCallioParticipant participant;
}

/// Remote media arrived (`kind` is `audio` or `video`).
final class RemoteTrackAddedEvent extends PurpleCallioEvent {
  const RemoteTrackAddedEvent(this.participant, this.kind);
  final PurpleCallioParticipant participant;
  final String kind;
}

/// A non-fatal or fatal error. Fatal errors also move the meeting to `failed`.
final class ErrorEvent extends PurpleCallioEvent {
  const ErrorEvent(this.error, {required this.fatal});
  final PurpleCallioError error;
  final bool fatal;
}

/// The meeting reached `disconnected`. Always the last event, followed by the
/// stream closing. (A meeting that reaches `failed` emits a fatal
/// [ErrorEvent] and then closes.)
final class MeetingEndedEvent extends PurpleCallioEvent {
  const MeetingEndedEvent(this.reason);
  final PurpleCallioDisconnectReason reason;
}
