import 'package:flutter_test/flutter_test.dart';
import 'package:purplecallio_flutter/purplecallio_flutter.dart';

import 'fakes/fakes.dart';

void main() {
  group('caller', () {
    test('captures media, waits for call-accepted, then '
        'join-call → offer → call.started', () async {
      final h = Harness();
      final m = await h.join();
      expect(h.rtc.getUserMediaCalls, 1);
      expect(h.timeline.indexOf('rtc:getUserMedia(audio=true,video=true)'),
          greaterThan(h.timeline.indexOf('rest:details')));
      await settle();
      // Nothing call-related before acceptance.
      expect(h.signaling.emittedEvents, ['authenticate']);
      expect(m.connectionState, PurpleCallioConnectionState.ringing);

      final joined = m.events.where((e) => e is ParticipantJoinedEvent).first;
      h.signaling.serverEmit('call-accepted', {'callId': kCallId});
      await settle();

      expect(h.signaling.emittedEvents,
          ['authenticate', 'join-call', 'offer', 'call.started']);
      final t = h.timeline;
      expect(t.indexOf('rtc:createPeer'), lessThan(t.indexOf('emit:join-call')));
      expect(t.indexOf('emit:join-call'), lessThan(t.indexOf('rtc:createOffer')));
      expect(t.indexOf('rtc:setLocal:offer'), lessThan(t.indexOf('emit:offer')));
      expect(t.indexOf('emit:offer'), lessThan(t.indexOf('emit:call.started')));
      final (_, offer) = h.signaling.emitted[2];
      expect(offer, {
        'offer': {'type': 'offer', 'sdp': 'v=0 offer1 a=ice-pwd:SECRETPWD'}
      });
      expect(h.signaling.emitted[1].$2, {'callId': kCallId});
      expect(h.signaling.emitted[3].$2, {'callId': kCallId});

      expect(m.connectionState, PurpleCallioConnectionState.joining);
      final remote = (await joined as ParticipantJoinedEvent).participant;
      expect(remote.participantId, kReceiverId);
      expect(remote.displayName, 'Bob');
      expect(remote.isCameraEnabled, isTrue); // VIDEO default
      expect(remote.isMicrophoneEnabled, isTrue);
      expect(m.participants.length, 2);

      h.rtc.peer.setIce(RtcIceState.connected);
      expect(m.connectionState, PurpleCallioConnectionState.connected);
      expect(h.rtc.speakerphone, isTrue);
      await m.leave();
    });

    test('proceeds immediately when details.status is ACCEPTED', () async {
      final h = Harness(details: detailsJson(status: 'ACCEPTED'));
      final m = await h.join();
      await settle();
      expect(h.signaling.emittedEvents,
          ['authenticate', 'join-call', 'offer', 'call.started']);
      expect(m.connectionState, PurpleCallioConnectionState.joining);
      await m.leave();
    });

    test('duplicate call-accepted starts the call only once', () async {
      final h = Harness();
      final m = await h.join();
      h.signaling.serverEmit('call-accepted', {'callId': kCallId});
      h.signaling.serverEmit('call-accepted', {'callId': kCallId});
      await settle();
      expect(h.signaling.count('offer'), 1);
      expect(h.rtc.peersCreated, 1);
      await m.leave();
    });

    test('answer → setRemoteDescription then queued candidates flush',
        () async {
      final h = Harness();
      final m = await h.join();
      h.signaling.serverEmit('call-accepted', {'callId': kCallId});
      await settle();
      // Candidates arrive before the answer: queued.
      for (final c in ['c1', 'c2']) {
        h.signaling.serverEmit('ice-candidate', {
          'candidate': {'candidate': c, 'sdpMid': '0', 'sdpMLineIndex': 0}
        });
      }
      await settle();
      expect(h.rtc.peer.addedCandidates, isEmpty);
      expect(m.debugPendingCandidateCount, 2);

      h.signaling.serverEmit('answer', {
        'answer': {'type': 'answer', 'sdp': 'v=0 remote'}
      });
      await settle();
      final t = h.timeline;
      expect(t.indexOf('rtc:setRemote:answer'),
          lessThan(t.indexOf('rtc:addCandidate:c1')));
      expect(h.rtc.peer.addedCandidates.map((c) => c.candidate), ['c1', 'c2']);

      // After the remote description, candidates apply directly.
      h.signaling.serverEmit('ice-candidate', {
        'candidate': {'candidate': 'c3', 'sdpMid': '0', 'sdpMLineIndex': 0}
      });
      await settle();
      expect(h.rtc.peer.addedCandidates.length, 3);
      expect(m.debugPendingCandidateCount, 0);

      // Local candidates are relayed in RTCIceCandidateInit shape.
      h.rtc.peer.emitLocalCandidate('local1');
      expect(h.signaling.emitted.last.$1, 'ice-candidate');
      expect(h.signaling.emitted.last.$2, equals(
        {
          'candidate': {
            'candidate': 'local1',
            'sdpMid': '0',
            'sdpMLineIndex': 0
          }
        },
      ));
      await m.leave();
    });

    test('camera failure falls back to audio-only and emits camera.disabled '
        'once after join-call', () async {
      final h = Harness();
      h.rtc.cameraError = const RtcMediaException(
          kind: PurpleCallioPermissionKind.camera, permissionDenied: true);
      final errors = <PurpleCallioEvent>[];
      final m = await h.join();
      m.events.listen(errors.add);
      expect(m.isCameraEnabled, isFalse);
      expect(h.rtc.micTrack, isNotNull);
      h.signaling.serverEmit('call-accepted', {'callId': kCallId});
      await settle();
      expect(h.signaling.emittedEvents,
          ['authenticate', 'join-call', 'camera.disabled', 'offer', 'call.started']);
      // Still receives remote video.
      expect(h.rtc.peer.addedEmptyVideoTransceiver, isTrue);
      await m.leave();
    });

    test('remote rejection → disconnected(rejected)', () async {
      final h = Harness();
      final m = await h.join();
      final ended = m.events.where((e) => e is MeetingEndedEvent).cast<MeetingEndedEvent>().first;
      h.signaling.serverEmit('call-rejected', {'callId': kCallId});
      expect((await ended).reason, PurpleCallioDisconnectReason.rejected);
      expect(m.connectionState, PurpleCallioConnectionState.disconnected);
      expect(m.disconnectReason, PurpleCallioDisconnectReason.rejected);
      expect(h.signaling.disposed, isTrue);
      expect(h.rtc.tracksDisposed, h.rtc.tracksCreated);
    });

    test('call-missed → disconnected(missed)', () async {
      final h = Harness();
      final m = await h.join();
      h.signaling.serverEmit('call-missed', {'callId': kCallId});
      await settle();
      expect(m.disconnectReason, PurpleCallioDisconnectReason.missed);
    });

    test('leave() while ringing cancels (POST cancel), no call signaling',
        () async {
      final h = Harness();
      final m = await h.join();
      await m.leave();
      expect(h.api.calls, contains('cancel'));
      expect(h.api.calls, isNot(contains('end')));
      expect(h.signaling.emittedEvents, ['authenticate']);
      expect(m.disconnectReason, PurpleCallioDisconnectReason.left);
      expect(h.rtc.tracksDisposed, h.rtc.tracksCreated);
    });
  });

  group('receiver', () {
    test('accept: media + peer before POST accept, then '
        'join → join-call → call.started', () async {
      final h = Harness(role: 'RECEIVER');
      final m = await h.join();
      await m.accept();
      await settle();
      final t = h.timeline;
      final gum = t.indexOf('rtc:getUserMedia', prefix: true);
      final addTracks = t.indexOf('rtc:addTracks');
      final accept = t.indexOf('rest:accept');
      final join = t.indexOf('rest:join');
      final joinCall = t.indexOf('emit:join-call');
      final started = t.indexOf('emit:call.started');
      expect(gum, greaterThan(-1));
      expect(gum, lessThan(addTracks));
      expect(addTracks, lessThan(accept));
      expect(accept, lessThan(join));
      expect(join, lessThan(joinCall));
      expect(joinCall, lessThan(started));
      expect(h.signaling.emittedEvents,
          ['authenticate', 'join-call', 'call.started']);
      expect(m.connectionState, PurpleCallioConnectionState.joining);
      expect(m.remoteParticipant?.participantId, kCallerId);
      expect(m.remoteParticipant?.displayName, 'Alice');
      await m.leave();
    });

    test('offer → setRemote → flush → createAnswer → setLocal → answer',
        () async {
      final h = Harness(role: 'RECEIVER');
      final m = await h.join();
      await m.accept();
      h.signaling.serverEmit('ice-candidate', {
        'candidate': {'candidate': 'early', 'sdpMid': '0', 'sdpMLineIndex': 0}
      });
      h.signaling.serverEmit('offer', {
        'offer': {'type': 'offer', 'sdp': 'v=0 caller'}
      });
      await settle();
      final t = h.timeline;
      expect(t.indexOf('rtc:setRemote:offer'),
          lessThan(t.indexOf('rtc:addCandidate:early')));
      expect(t.indexOf('rtc:addCandidate:early'),
          lessThan(t.indexOf('rtc:createAnswer')));
      expect(t.indexOf('rtc:setLocal:answer'),
          lessThan(t.indexOf('emit:answer')));
      expect(h.signaling.emitted.last.$1, 'answer');
      expect(h.signaling.emitted.last.$2, equals(
        {
          'answer': {'type': 'answer', 'sdp': 'v=0 answer'}
        },
      ));
      await m.leave();
    });

    test('accept is invalid for a caller and after the call started',
        () async {
      final caller = await Harness().join();
      await expectLater(caller.accept(), throwsA(isA<InvalidStateError>()));
      await caller.dispose();

      final h = Harness(role: 'RECEIVER');
      final m = await h.join();
      await m.accept();
      await expectLater(m.reject(), throwsA(isA<InvalidStateError>()));
      await m.dispose();
    });

    test('media failure on accept keeps ringing and does not POST accept',
        () async {
      final h = Harness(role: 'RECEIVER');
      h.rtc.micError = const RtcMediaException(
          kind: PurpleCallioPermissionKind.microphone, permissionDenied: true);
      final m = await h.join();
      await expectLater(m.accept(), throwsA(isA<PermissionDeniedError>()));
      expect(m.connectionState, PurpleCallioConnectionState.ringing);
      expect(h.api.calls, isNot(contains('accept')));
      // Can retry.
      h.rtc.micError = null;
      await m.accept();
      expect(h.api.calls, contains('accept'));
      await m.leave();
    });

    test('reject → POST reject, disconnected(rejected), cleanup', () async {
      final h = Harness(role: 'RECEIVER');
      final m = await h.join();
      await m.reject();
      expect(h.api.calls, contains('reject'));
      expect(h.api.calls, isNot(contains('accept')));
      expect(m.disconnectReason, PurpleCallioDisconnectReason.rejected);
      expect(h.signaling.disposed, isTrue);
      // idempotent
      await m.reject();
      await m.leave();
      expect(h.api.calls.where((c) => c == 'reject').length, 1);
    });

    test('leave() while ringing rejects and ends in left', () async {
      final h = Harness(role: 'RECEIVER');
      final m = await h.join();
      await m.leave();
      expect(h.api.calls, contains('reject'));
      expect(m.disconnectReason, PurpleCallioDisconnectReason.left);
    });

    test('caller cancels while ringing → disconnected(cancelled)', () async {
      final h = Harness(role: 'RECEIVER');
      final m = await h.join();
      h.signaling.serverEmit('call-cancelled', {'callId': kCallId});
      await settle();
      expect(m.disconnectReason, PurpleCallioDisconnectReason.cancelled);
      await expectLater(m.accept(), throwsA(isA<MeetingEndedError>()));
    });
  });
}
