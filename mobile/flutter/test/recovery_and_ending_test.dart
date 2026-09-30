import 'dart:async';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:purplecallio_flutter/purplecallio_flutter.dart';

import 'fakes/fakes.dart';

Future<(Harness, PurpleCallioMeeting)> callerInCall() async {
  final h = Harness();
  final m = await h.join();
  h.signaling.serverEmit('call-accepted', {'callId': kCallId});
  await settle();
  h.rtc.peer.setIce(RtcIceState.connected);
  return (h, m);
}

/// Same as [callerInCall] inside fakeAsync.
(Harness, PurpleCallioMeeting) syncInCall(FakeAsync async,
    {String role = 'CALLER'}) {
  final h = Harness(role: role);
  PurpleCallioMeeting? m;
  h.join().then((v) => m = v);
  async.flushMicrotasks();
  if (role == 'CALLER') {
    h.signaling.serverEmit('call-accepted', {'callId': kCallId});
  } else {
    m!.accept();
  }
  async.flushMicrotasks();
  h.rtc.peer.setIce(RtcIceState.connected);
  async.flushMicrotasks();
  return (h, m!);
}

void main() {
  group('signaling reconnect', () {
    test('drop → reconnecting → re-authenticate → join-call re-emitted',
        () async {
      final (h, m) = await callerInCall();
      expect(m.connectionState, PurpleCallioConnectionState.connected);
      final states = <PurpleCallioConnectionState>[];
      m.connectionStateListenable
          .addListener(() => states.add(m.connectionState));

      h.signaling.simulateDisconnect();
      expect(m.connectionState, PurpleCallioConnectionState.reconnecting);
      // Toggles while offline are not lost and not sent pre-auth.
      await m.toggleMicrophone();
      final beforeReconnect = h.signaling.emittedEvents.length;
      expect(h.signaling.emittedEvents.last, isNot('microphone.disabled'));

      h.signaling.simulateReconnect();
      await settle();
      final after = h.signaling.emittedEvents.sublist(beforeReconnect);
      expect(after.take(3),
          ['authenticate', 'join-call', 'microphone.disabled']);
      expect(h.signaling.count('join-call'), 2);
      expect(h.signaling.count('microphone.disabled'), 1);
      expect(h.api.calls.where((c) => c == 'details').length, 2);
      expect(m.connectionState, PurpleCallioConnectionState.connected);
      expect(states, [
        PurpleCallioConnectionState.reconnecting,
        PurpleCallioConnectionState.connected,
      ]);
      await m.leave();
    });

    test('ringing caller that missed call-accepted while offline starts the '
        'call after reconnect', () async {
      final h = Harness();
      final m = await h.join();
      h.signaling.simulateDisconnect();
      expect(m.connectionState, PurpleCallioConnectionState.reconnecting);
      h.api.detailsJsonValue = detailsJson(status: 'ACCEPTED');
      h.signaling.simulateReconnect();
      await settle();
      expect(h.signaling.emittedEvents.skip(2),
          ['join-call', 'offer', 'call.started']);
      await m.leave();
    });

    test('call ended while offline → disconnected(remoteEnded) on reconnect',
        () async {
      final (h, m) = await callerInCall();
      h.signaling.simulateDisconnect();
      h.api.detailsJsonValue = detailsJson(status: 'ENDED');
      h.signaling.simulateReconnect();
      await settle();
      expect(m.disconnectReason, PurpleCallioDisconnectReason.remoteEnded);
    });

    test('re-auth rejected on reconnect → failed(invalidToken)', () async {
      final (h, m) = await callerInCall();
      h.signaling.simulateDisconnect();
      h.signaling.authAck = () => {'success': false};
      h.signaling.simulateReconnect();
      await settle();
      expect(m.connectionState, PurpleCallioConnectionState.failed);
      expect(m.error, isA<InvalidTokenError>());
    });

    test('bare server-side disconnect is terminal, never a reconnect loop',
        () async {
      final (h, m) = await callerInCall();
      final before = h.signaling.connectCalls;
      h.signaling.simulateDisconnect('io server disconnect');
      await settle();
      expect(h.signaling.connectCalls, before);
      expect(m.connectionState, PurpleCallioConnectionState.failed);
      expect(m.error, isA<ConnectionFailedError>());
    });

    test('call.expired then forced disconnect → disconnected(expired)',
        () async {
      final (h, m) = await callerInCall();
      h.signaling.serverEmit('call.expired', {'callId': kCallId});
      h.signaling.simulateDisconnect('io server disconnect');
      await settle();
      expect(m.connectionState, PurpleCallioConnectionState.disconnected);
      expect(m.disconnectReason, PurpleCallioDisconnectReason.expired);
      expect(m.error, isNull);
      expect(h.api.calls, isNot(contains('end')));
    });

    test('server call.ended then forced disconnect → remoteEnded, no error',
        () async {
      final (h, m) = await callerInCall();
      h.signaling.serverEmit('call.ended', {'callId': kCallId});
      h.signaling.simulateDisconnect('io server disconnect');
      await settle();
      expect(m.disconnectReason, PurpleCallioDisconnectReason.remoteEnded);
      expect(m.error, isNull);
    });

    test('auth-error TOKEN_EXPIRED → failed(invalidToken), socket disposed',
        () async {
      final (h, m) = await callerInCall();
      h.signaling.serverEmit('auth-error', {'code': 'TOKEN_EXPIRED'});
      await settle();
      expect(m.connectionState, PurpleCallioConnectionState.failed);
      expect(m.error, isA<InvalidTokenError>());
      expect(h.signaling.disposeCalls, greaterThan(0));
    });

    test('auth-error SOCKET_RATE_LIMITED → failed(connectionFailed)', () async {
      final (h, m) = await callerInCall();
      h.signaling.serverEmit('auth-error', {'code': 'SOCKET_RATE_LIMITED'});
      await settle();
      expect(m.error, isA<ConnectionFailedError>());
    });

    test('refused join-call ack → failed(signalingFailed) without POST end',
        () async {
      final h = Harness();
      h.signaling.joinCallAck = {'success': false, 'error': 'PLAYGROUND_PARTICIPANT_LIMIT'};
      final m = await h.join();
      h.signaling.serverEmit('call-accepted', {'callId': kCallId});
      await settle();
      expect(m.connectionState, PurpleCallioConnectionState.failed);
      expect(m.error, isA<SignalingFailedError>());
      expect(h.api.calls, isNot(contains('end')));
    });

    test('caller offer and call.started wait for the join-call ack', () async {
      final h = Harness();
      final m = await h.join();
      h.signaling.joinAckGate = Completer<void>();
      h.signaling.serverEmit('call-accepted', {'callId': kCallId});
      await settle();
      var names = h.signaling.emitted.map((e) => e.$1).toList();
      expect(names, contains('join-call'));
      expect(names, isNot(contains('offer')), reason: 'held until the ack');
      expect(names, isNot(contains('call.started')), reason: 'held until the ack');
      h.signaling.joinAckGate!.complete();
      await settle();
      names = h.signaling.emitted.map((e) => e.$1).toList();
      expect(names.indexOf('offer'), lessThan(names.indexOf('call.started')));
      await m.leave();
    });

    test('receiver holds answer and candidates until join-call', () async {
      final h = Harness(role: 'RECEIVER');
      final m = await h.join();
      h.api.onRecord = (name) {
        if (name != 'accept') return;
        h.signaling.serverEmit('offer', {
          'offer': {'type': 'offer', 'sdp': 'v=0 early-offer'}
        });
      };
      h.api.holds['join'] = () async {
        await settle();
        h.rtc.peer.emitLocalCandidate('candidate:local');
        await settle();
      };
      await m.accept();
      await settle();
      final names = h.signaling.emitted.map((e) => e.$1).toList();
      final joinCall = names.indexOf('join-call');
      expect(names, contains('answer'));
      expect(joinCall, lessThan(names.indexOf('answer')), reason: '$names');
      expect(joinCall, lessThan(names.indexOf('ice-candidate')), reason: '$names');
      await m.leave();
    });

    test('session-replaced → disconnected(sessionReplaced), no reconnect',
        () async {
      final (h, m) = await callerInCall();
      h.signaling.serverEmit('session-replaced', {'callId': kCallId});
      await settle();
      expect(m.disconnectReason, PurpleCallioDisconnectReason.sessionReplaced);
      final connects = h.signaling.connectCalls;
      h.signaling.simulateDisconnect('io server disconnect');
      expect(h.signaling.connectCalls, connects);
      expect(h.api.calls, isNot(contains('end')));
    });
  });

  group('ICE recovery', () {
    test('caller restarts ICE 3s after disconnected', () {
      fakeAsync((async) {
        final (h, m) = syncInCall(async);
        h.rtc.peer.setIce(RtcIceState.disconnected);
        expect(m.connectionState, PurpleCallioConnectionState.reconnecting);
        async.elapse(const Duration(milliseconds: 2900));
        expect(h.rtc.peer.iceRestartOffers, 0);
        async.elapse(const Duration(milliseconds: 200));
        expect(h.rtc.peer.iceRestartOffers, 1);
        expect(h.signaling.count('offer'), 2);
        h.rtc.peer.setIce(RtcIceState.connected);
        expect(m.connectionState, PurpleCallioConnectionState.connected);
        async.elapse(const Duration(seconds: 30));
        expect(m.connectionState, PurpleCallioConnectionState.connected);
        m.leave();
        async.flushMicrotasks();
      });
    });

    test('caller restarts immediately on failed', () {
      fakeAsync((async) {
        final (h, m) = syncInCall(async);
        h.rtc.peer.setIce(RtcIceState.failed);
        async.flushMicrotasks();
        expect(h.rtc.peer.iceRestartOffers, 1);
        expect(h.api.calls, contains('ice:FAILED'));
        m.leave();
        async.flushMicrotasks();
      });
    });

    test('receiver never restarts ICE (no glare)', () {
      fakeAsync((async) {
        final (h, m) = syncInCall(async, role: 'RECEIVER');
        h.rtc.peer.setIce(RtcIceState.disconnected);
        async.elapse(const Duration(seconds: 5));
        h.rtc.peer.setIce(RtcIceState.failed);
        async.elapse(const Duration(seconds: 5));
        expect(h.rtc.peer.offerCount, 0);
        expect(h.signaling.count('offer'), 0);
        m.leave();
        async.flushMicrotasks();
      });
    });

    test('15s watchdog → failed(webrtcFailed) with full cleanup', () {
      fakeAsync((async) {
        final (h, m) = syncInCall(async);
        final events = <PurpleCallioEvent>[];
        m.events.listen(events.add);
        h.rtc.peer.setIce(RtcIceState.disconnected);
        async.elapse(const Duration(seconds: 14));
        expect(m.connectionState, PurpleCallioConnectionState.reconnecting);
        async.elapse(const Duration(seconds: 2));
        expect(m.connectionState, PurpleCallioConnectionState.failed);
        expect(m.error, isA<WebrtcFailedError>());
        expect(events.where((e) => e is ErrorEvent).cast<ErrorEvent>().single.fatal, isTrue);
        expect(h.rtc.peersClosed, 1);
        expect(h.rtc.tracksDisposed, h.rtc.tracksCreated);
        expect(h.signaling.disposed, isTrue);
      });
    });

    test('recovery before the watchdog clears it', () {
      fakeAsync((async) {
        final (h, m) = syncInCall(async);
        h.rtc.peer.setIce(RtcIceState.disconnected);
        async.elapse(const Duration(seconds: 10));
        h.rtc.peer.setIce(RtcIceState.completed);
        async.elapse(const Duration(seconds: 30));
        expect(m.connectionState, PurpleCallioConnectionState.connected);
        m.leave();
        async.flushMicrotasks();
      });
    });
  });

  group('ending', () {
    test('hang up: call.ended, call-ended, POST leave, POST end, cleanup',
        () async {
      final (h, m) = await callerInCall();
      final ended = m.events.where((e) => e is MeetingEndedEvent).cast<MeetingEndedEvent>().first;
      await m.leave();
      final t = h.timeline;
      final a = t.indexOf('emit:call.ended');
      final b = t.indexOf('emit:call-ended');
      final c = t.indexOf('rest:leave');
      final d = t.indexOf('rest:end');
      expect([a, b, c, d].every((i) => i >= 0), isTrue);
      expect(a < b && b < c && c < d, isTrue);
      expect(h.signaling.emitted.firstWhere((e) => e.$1 == 'call-ended').$2,
          isNull);
      expect((await ended).reason, PurpleCallioDisconnectReason.left);
      expect(m.connectionState, PurpleCallioConnectionState.disconnected);
      // Our own call.ended echo after leaving changes nothing.
      h.signaling.serverEmit('call.ended', {'callId': kCallId});
      expect(m.disconnectReason, PurpleCallioDisconnectReason.left);
    });

    test('remote hang-up (call-ended, no payload) → remoteEnded', () async {
      final (h, m) = await callerInCall();
      h.signaling.serverEmit('call-ended');
      h.signaling.serverEmit('call.ended', {'callId': kCallId});
      await settle();
      expect(m.disconnectReason, PurpleCallioDisconnectReason.remoteEnded);
      expect(h.api.calls, isNot(contains('end')));
      expect(h.signaling.disposed, isTrue);
    });

    test('participant.left removes the remote without ending; rejoin restores',
        () async {
      final (h, m) = await callerInCall();
      final left = m.events.where((e) => e is ParticipantLeftEvent).cast<ParticipantLeftEvent>().first;
      h.signaling.serverEmit('participant.left',
          {'callId': kCallId, 'participantId': kCallerId}); // own id: ignored
      expect(m.remoteParticipant, isNotNull);
      h.signaling.serverEmit('participant.left',
          {'callId': kCallId, 'participantId': kReceiverId});
      expect((await left).participant.participantId, kReceiverId);
      expect(m.remoteParticipant, isNull);
      expect(m.participants.length, 1);
      expect(m.connectionState, PurpleCallioConnectionState.connected);

      h.signaling.serverEmit('participant.joined',
          {'callId': kCallId, 'participantId': kReceiverId, 'participants': 2});
      expect(m.remoteParticipant?.participantId, kReceiverId);
      await m.leave();
    });

    test('cleanup releases everything and leave()/dispose() are idempotent',
        () async {
      final (h, m) = await callerInCall();
      await m.startScreenShare();
      await Future.wait([m.leave(), m.leave(), m.dispose()]);
      await m.dispose();
      expect(h.api.calls.where((c) => c == 'end').length, 1);
      expect(h.rtc.peersCreated, 1);
      expect(h.rtc.peersClosed, 1);
      expect(h.rtc.tracksCreated, 3); // mic, camera, screen
      expect(h.rtc.tracksDisposed, 3);
      expect(h.signaling.disposeCalls, 1);
      expect(h.api.closeCalls, 1);
      expect(m.debugIsTornDown, isTrue);
      expect(m.localParticipant.videoTrack, isNull);
      expect(m.remoteParticipant, isNull);
      expect(h.client.activeMeetings, isEmpty);
      // Late server events and late RTC callbacks are harmless.
      h.signaling.serverEmit('offer', {
        'offer': {'type': 'offer', 'sdp': 'x'}
      });
      h.rtc.peer.setIce(RtcIceState.failed);
      await settle();
      expect(h.rtc.peersCreated, 1);
      await expectLater(m.toggleMicrophone(), throwsA(isA<MeetingEndedError>()));
    });

    test('events stream closes after MeetingEndedEvent', () async {
      final (_, m) = await callerInCall();
      final all = m.events.toList();
      await m.leave();
      final list = await all;
      expect(list.last, isA<MeetingEndedEvent>());
    });

    test('join → leave → join → leave leaves no residue', () async {
      for (var i = 0; i < 2; i++) {
        final (h, m) = await callerInCall();
        await m.leave();
        expect(h.rtc.tracksDisposed, h.rtc.tracksCreated);
        expect(h.rtc.peersClosed, h.rtc.peersCreated);
        expect(h.signaling.disposed, isTrue);
        expect(h.client.activeMeetings, isEmpty);
      }
      // Same client, two sequential meetings.
      final h = Harness();
      final m1 = await h.join();
      await m1.leave();
      expect(h.client.activeMeetings, isEmpty);
    });

    test('client.dispose() disposes live meetings without signaling',
        () async {
      final (h, m) = await callerInCall();
      await h.client.dispose();
      expect(m.connectionState, PurpleCallioConnectionState.disconnected);
      expect(h.api.calls, isNot(contains('end')));
      expect(h.signaling.count('call.ended'), 0);
      await expectLater(h.join(), throwsA(isA<InvalidStateError>()));
    });
  });
}
