import 'package:flutter_test/flutter_test.dart';
import 'package:purplecallio_flutter/purplecallio_flutter.dart';

import 'fakes/fakes.dart';

Future<(Harness, PurpleCallioMeeting)> inCall({
  String type = 'VIDEO',
  PurpleCallioJoinOptions options = const PurpleCallioJoinOptions(),
}) async {
  final h = Harness(details: detailsJson(type: type));
  final m = await h.join(options);
  h.signaling.serverEmit('call-accepted', {'callId': kCallId});
  await settle();
  h.rtc.peer.setIce(RtcIceState.connected);
  return (h, m);
}

List<String> mediaEmits(Harness h) => h.signaling.emittedEvents
    .where((e) =>
        e.startsWith('camera.') ||
        e.startsWith('microphone.') ||
        e.startsWith('screenShare.'))
    .toList();

void main() {
  group('local toggles', () {
    test('toggle flips; no-op enable/disable emits nothing', () async {
      final (h, m) = await inCall();
      await m.enableMicrophone(); // already on → no-op
      await m.enableCamera(); // already on → no-op
      expect(mediaEmits(h), isEmpty);

      await m.toggleMicrophone();
      expect(m.isMicrophoneEnabled, isFalse);
      expect(h.rtc.micTrack!.enabled, isFalse);
      await m.disableMicrophone(); // no-op
      await m.toggleMicrophone();
      await m.toggleMicrophone();
      expect(mediaEmits(h), [
        'microphone.disabled',
        'microphone.enabled',
        'microphone.disabled',
      ]);
      expect(h.signaling.emitted.last.$2, {'callId': kCallId});

      await m.toggleCamera();
      expect(h.rtc.cameraTrack!.enabled, isFalse);
      expect(m.localParticipant.isCameraEnabled, isFalse);
      await m.toggleCamera();
      expect(h.rtc.cameraTrack!.enabled, isTrue);
      expect(mediaEmits(h).skip(3), ['camera.disabled', 'camera.enabled']);
      // The sender is never replaced for a toggle (no renegotiation).
      expect(h.timeline.indexOf('rtc:replaceVideo', prefix: true), -1);
      expect(h.rtc.peer.offerCount, 1);
      await m.leave();
    });

    test('join with mic off emits exactly one microphone.disabled right '
        'after join-call and never *.enabled', () async {
      final (h, m) = await inCall(
          options: const PurpleCallioJoinOptions(microphoneEnabled: false));
      final events = h.signaling.emittedEvents;
      expect(events.sublist(0, 4),
          ['authenticate', 'join-call', 'microphone.disabled', 'offer']);
      expect(mediaEmits(h), ['microphone.disabled']);
      expect(h.rtc.micTrack!.enabled, isFalse);
      await m.disableMicrophone();
      expect(mediaEmits(h), ['microphone.disabled']);
      await m.leave();
    });

    test('join with camera off captures no camera, emits camera.disabled once, '
        'and enableCamera captures late into the existing sender', () async {
      final (h, m) = await inCall(
          options: const PurpleCallioJoinOptions(cameraEnabled: false));
      expect(h.rtc.cameraTrack, isNull);
      expect(h.rtc.peer.addedEmptyVideoTransceiver, isTrue);
      expect(mediaEmits(h), ['camera.disabled']);
      await m.enableCamera();
      expect(h.rtc.cameraTrack, isNotNull);
      expect(h.timeline.entries.last, startsWith('emit:camera.enabled'));
      expect(h.timeline.indexOf('rtc:replaceVideo:camera', prefix: true),
          greaterThan(-1));
      expect(h.rtc.peer.offerCount, 1); // still no renegotiation
      expect(mediaEmits(h), ['camera.disabled', 'camera.enabled']);
      await m.leave();
    });

    test('camera ops throw invalidState on audio calls', () async {
      final (h, m) = await inCall(type: 'AUDIO');
      expect(h.rtc.cameraTrack, isNull);
      expect(h.rtc.peer.addedEmptyVideoTransceiver, isFalse);
      await expectLater(m.enableCamera(), throwsA(isA<InvalidStateError>()));
      await expectLater(m.toggleCamera(), throwsA(isA<InvalidStateError>()));
      await expectLater(
          m.startScreenShare(), throwsA(isA<ScreenShareUnavailableError>()));
      // AUDIO default is camera off: nothing emitted on join.
      expect(mediaEmits(h), isEmpty);
      await m.leave();
    });

    test('toggles before join are applied at join time', () async {
      final h = Harness(role: 'RECEIVER');
      final m = await h.join();
      await m.disableCamera(); // decide before answering
      await m.accept();
      await settle();
      expect(h.rtc.cameraTrack, isNull);
      expect(mediaEmits(h), ['camera.disabled']);
      expect(h.signaling.emittedEvents.indexOf('camera.disabled'),
          h.signaling.emittedEvents.indexOf('join-call') + 1);
      await m.leave();
    });

    test('switchCamera flips position without signaling', () async {
      final (h, m) = await inCall();
      final before = h.signaling.emitted.length;
      expect(m.cameraPosition, PurpleCallioCameraPosition.front);
      await m.switchCamera();
      expect(m.cameraPosition, PurpleCallioCameraPosition.back);
      expect(h.rtc.cameraTrack!.switchCalls, 1);
      expect(h.signaling.emitted.length, before);
      await m.leave();
    });

    test('setVideoSuspended silences video without any event', () async {
      final (h, m) = await inCall();
      m.setVideoSuspended(true);
      expect(h.rtc.cameraTrack!.enabled, isFalse);
      expect(m.isCameraEnabled, isTrue);
      m.setVideoSuspended(false);
      expect(h.rtc.cameraTrack!.enabled, isTrue);
      expect(mediaEmits(h), isEmpty);
      await m.leave();
    });
  });

  group('remote media', () {
    test('dedicated events update the remote; own echoes are ignored; '
        'participant.updated snapshot is ignored', () async {
      final (h, m) = await inCall();
      final updates = <PurpleCallioParticipant>[];
      m.events
          .where((e) => e is ParticipantUpdatedEvent).cast<ParticipantUpdatedEvent>()
          .listen((e) => updates.add(e.participant));

      // Our own echo (server broadcasts to the sender too).
      h.signaling.serverEmit('camera.disabled', {
        'callId': kCallId,
        'participantId': kCallerId,
        'media': {'camera': false, 'microphone': false, 'screenShare': false},
      });
      // The stale snapshot must not flip anything.
      h.signaling.serverEmit('participant.updated', {
        'callId': kCallId,
        'participantId': kReceiverId,
        'media': {'camera': false, 'microphone': false, 'screenShare': false},
      });
      await settle();
      expect(m.remoteParticipant!.isCameraEnabled, isTrue);
      expect(m.remoteParticipant!.isMicrophoneEnabled, isTrue);
      expect(updates, isEmpty);

      h.signaling.serverEmit('microphone.disabled', {
        'callId': kCallId,
        'participantId': kReceiverId,
        'media': {'camera': false, 'microphone': false, 'screenShare': false},
      });
      await settle();
      expect(m.remoteParticipant!.isMicrophoneEnabled, isFalse);
      // Camera untouched by an unrelated event (snapshot says false).
      expect(m.remoteParticipant!.isCameraEnabled, isTrue);

      h.signaling.serverEmit('screenShare.started',
          {'callId': kCallId, 'participantId': kReceiverId});
      h.signaling.serverEmit('camera.disabled',
          {'callId': kCallId, 'participantId': kReceiverId});
      await settle();
      expect(m.remoteParticipant!.isScreenSharing, isTrue);
      expect(m.remoteParticipant!.isCameraEnabled, isFalse);
      expect(updates.length, 3);
      await m.leave();
    });

    test('remote track populates remoteParticipant.videoTrack', () async {
      final (h, m) = await inCall();
      final added = m.events.where((e) => e is RemoteTrackAddedEvent).cast<RemoteTrackAddedEvent>().first;
      h.rtc.peer.emitRemoteVideo();
      final e = await added;
      expect(e.kind, 'video');
      expect(m.remoteParticipant!.videoTrack?.id, 'remote-video');
      expect(m.remoteParticipant!.hasVisibleVideo, isTrue);
      await m.leave();
    });
  });

  group('screen share (fake engine)', () {
    test('start replaces the video sender track and emits started; stop '
        'restores the camera and emits stopped', () async {
      final (h, m) = await inCall();
      var before = 0, after = 0;
      await m.startScreenShare(
          beforeCapture: () => before++, afterStop: () => after++);
      expect(before, 1);
      expect(m.isScreenSharing, isTrue);
      expect(h.rtc.peer.videoSenderTrack, isA<FakeTrack>());
      expect((h.rtc.peer.videoSenderTrack! as FakeTrack).label, 'screen');
      expect(m.localParticipant.videoTrack?.id, 'screen');
      await m.startScreenShare(); // idempotent
      await m.stopScreenShare();
      expect((h.rtc.peer.videoSenderTrack! as FakeTrack).label,
          startsWith('camera'));
      expect(h.rtc.tracks.firstWhere((t) => t.label == 'screen').disposed,
          isTrue);
      expect(after, 1);
      expect(mediaEmits(h), ['screenShare.started', 'screenShare.stopped']);
      expect(h.rtc.peer.offerCount, 1);
      await m.leave();
    });

    test('capture ended by the system is treated as stop', () async {
      final (h, m) = await inCall();
      await m.startScreenShare();
      h.rtc.tracks.firstWhere((t) => t.label == 'screen').end();
      await settle();
      expect(m.isScreenSharing, isFalse);
      expect(mediaEmits(h), ['screenShare.started', 'screenShare.stopped']);
      await m.leave();
    });

    test('unsupported platform → ScreenShareUnavailableError', () async {
      final (h, m) = await inCall();
      h.rtc.screenShareSupported = false;
      await expectLater(
          m.startScreenShare(), throwsA(isA<ScreenShareUnavailableError>()));
      expect(mediaEmits(h), isEmpty);
      await m.leave();
    });
  });
}
