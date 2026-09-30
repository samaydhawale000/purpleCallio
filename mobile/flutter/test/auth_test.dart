import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:purplecallio_flutter/purplecallio_flutter.dart';

import 'fakes/fakes.dart';

void main() {
  test('authenticates with the token via ack and takes callId from connected',
      () async {
    final h = Harness();
    final m = await h.join();
    final (event, data) = h.signaling.emitted.first;
    expect(event, 'authenticate');
    expect(data, {'token': 'participant-token-abc'});
    expect(m.callId, kCallId);
    expect(m.role, PurpleCallioRole.caller);
    expect(m.callType, PurpleCallioCallType.video);
    expect(m.connectionState, PurpleCallioConnectionState.ringing);
    expect(m.localParticipant.participantId, kCallerId);
    expect(m.localParticipant.displayName, 'Alice');
    expect(m.remoteParticipant, isNull);
    // details loaded after auth
    expect(h.timeline.indexOf('emit:authenticate'),
        lessThan(h.timeline.indexOf('rest:details')));
    await m.leave();
  });

  test('success:false → InvalidTokenError and everything released', () async {
    final h = Harness();
    h.signaling.authAck = () => {'success': false};
    await expectLater(h.join(), throwsA(isA<InvalidTokenError>()));
    expect(h.signaling.disposed, isTrue);
    expect(h.api.closeCalls, 1);
    expect(h.client.activeMeetings, isEmpty);
  });

  test('empty token is rejected before connecting', () async {
    final h = Harness();
    await expectLater(h.join(const PurpleCallioJoinOptions(), '  '),
        throwsA(isA<InvalidTokenError>()));
    expect(h.signaling.connectCalls, 0);
  });

  test('no ack → AuthenticationFailedError after the ack timeout', () {
    fakeAsync((async) {
      final h = Harness();
      h.signaling.authAck = () => null; // never replies
      Object? error;
      h.join().then((_) {}, onError: (Object e) {
        error = e;
      });
      async.flushMicrotasks();
      expect(error, isNull);
      async.elapse(const Duration(seconds: 3));
      expect(error, isA<AuthenticationFailedError>());
      expect(h.signaling.disposed, isTrue);
    });
  });

  test('receiver gets incoming-call during auth and lands in ringing',
      () async {
    final h = Harness(role: 'RECEIVER');
    final m = await h.join();
    expect(m.role, PurpleCallioRole.receiver);
    expect(m.connectionState, PurpleCallioConnectionState.ringing);
    expect(m.incomingCall?.callerName, 'Alice');
    expect(m.incomingCall?.callType, PurpleCallioCallType.video);
    // Receiver does not capture media until accept().
    expect(h.rtc.getUserMediaCalls, 0);
    await m.dispose();
  });

  for (final (event, reason) in [
    ('call-missed', PurpleCallioDisconnectReason.missed),
    ('call-ended', PurpleCallioDisconnectReason.remoteEnded),
    ('call-rejected', PurpleCallioDisconnectReason.rejected),
    ('call-cancelled', PurpleCallioDisconnectReason.cancelled),
    ('call-busy', PurpleCallioDisconnectReason.busy),
  ]) {
    test('receiver auth followed by $event → MeetingEndedError($reason)',
        () async {
      final h = Harness(role: 'RECEIVER');
      h.signaling.onAuthenticateEvents = () => [(event, {'callId': kCallId})];
      await expectLater(
          h.join(),
          throwsA(isA<MeetingEndedError>()
              .having((e) => e.reason, 'reason', reason)));
      expect(h.signaling.disposed, isTrue);
    });
  }

  test('caller whose call is already over → MeetingEndedError', () async {
    final h = Harness(details: detailsJson(status: 'MISSED'));
    await expectLater(
        h.join(),
        throwsA(isA<MeetingEndedError>().having(
            (e) => e.reason, 'reason', PurpleCallioDisconnectReason.missed)));
    expect(h.rtc.getUserMediaCalls, 0);
  });

  test('caller microphone permission denied fails joinMeeting', () async {
    final h = Harness();
    h.rtc.micError = const RtcMediaException(
        kind: PurpleCallioPermissionKind.microphone, permissionDenied: true);
    await expectLater(
        h.join(),
        throwsA(isA<PermissionDeniedError>().having((e) => e.kind, 'kind',
            PurpleCallioPermissionKind.microphone)));
    expect(h.signaling.disposed, isTrue);
  });
}
