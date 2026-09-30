import 'package:flutter_test/flutter_test.dart';
import 'package:purplecallio_flutter/purplecallio_flutter.dart';

import 'fakes/fakes.dart';

void main() {
  group('wire enums', () {
    test('role/type/status parse server strings', () {
      expect(PurpleCallioRole.fromWire('CALLER'), PurpleCallioRole.caller);
      expect(PurpleCallioRole.fromWire('RECEIVER'), PurpleCallioRole.receiver);
      expect(PurpleCallioRole.fromWire('x'), isNull);
      expect(PurpleCallioCallType.fromWire('AUDIO'), PurpleCallioCallType.audio);
      expect(PurpleCallioCallType.fromWire('VIDEO'), PurpleCallioCallType.video);
      expect(PurpleCallioCallStatus.fromWire('ACCEPTED'),
          PurpleCallioCallStatus.accepted);
      expect(PurpleCallioCallStatus.fromWire('weird'),
          PurpleCallioCallStatus.unknown);
    });

    test('terminal statuses map to disconnect reasons', () {
      expect(PurpleCallioCallStatus.ended.terminalReason,
          PurpleCallioDisconnectReason.remoteEnded);
      expect(PurpleCallioCallStatus.missed.terminalReason,
          PurpleCallioDisconnectReason.missed);
      expect(PurpleCallioCallStatus.rejected.terminalReason,
          PurpleCallioDisconnectReason.rejected);
      expect(PurpleCallioCallStatus.cancelled.terminalReason,
          PurpleCallioDisconnectReason.cancelled);
      expect(PurpleCallioCallStatus.busy.terminalReason,
          PurpleCallioDisconnectReason.busy);
      expect(PurpleCallioCallStatus.ringing.terminalReason, isNull);
      expect(PurpleCallioCallStatus.accepted.terminalReason, isNull);
    });
  });

  group('PurpleCallioCallDetails', () {
    test('parses the real server payload and drops the token', () {
      final d = PurpleCallioCallDetails.fromJson(detailsJson(caller: false));
      expect(d.callId, kCallId);
      expect(d.callType, PurpleCallioCallType.video);
      expect(d.status, PurpleCallioCallStatus.ringing);
      expect(d.callerId, kCallerId);
      expect(d.receiverId, kReceiverId);
      expect(d.participantId, kReceiverId);
      expect(d.callerName, 'Alice');
      expect(d.receiverAvatar, isNull);
      expect(d.expiresAt, DateTime.utc(2030));
      // No token field exists on the model at all.
      expect(d.toString(), isNot(contains('SECRET')));
    });

    test('rejects payloads without required fields', () {
      expect(() => PurpleCallioCallDetails.fromJson({'callId': 'x'}),
          throwsFormatException);
    });
  });

  test('incoming-call payload', () {
    final c = PurpleCallioIncomingCall.fromJson({
      'callId': kCallId,
      'callerId': kCallerId,
      'callerName': 'Alice',
      'callerAvatar': null,
      'type': 'AUDIO',
    })!;
    expect(c.callType, PurpleCallioCallType.audio);
    expect(c.callerName, 'Alice');
    expect(c.callerAvatar, isNull);
    expect(PurpleCallioIncomingCall.fromJson({'x': 1}), isNull);
  });

  group('PurpleCallioIceServer', () {
    test('parses string and list urls', () {
      expect(PurpleCallioIceServer.fromJson({'urls': 'stun:a'})!.urls,
          ['stun:a']);
      final s = PurpleCallioIceServer.fromJson({
        'urls': ['turn:a', 'turns:b'],
        'username': 'u',
        'credential': 'pw',
      })!;
      expect(s.urls, ['turn:a', 'turns:b']);
      expect(s.toJson(),
          {'urls': ['turn:a', 'turns:b'], 'username': 'u', 'credential': 'pw'});
      expect(PurpleCallioIceServer.fromJson({'urls': []}), isNull);
    });

    test('toString never includes the credential', () {
      const s = PurpleCallioIceServer(
          urls: ['turn:a'], username: 'u', credential: 'TOPSECRET');
      expect(s.toString(), isNot(contains('TOPSECRET')));
    });
  });

  group('PurpleCallioParticipant', () {
    test('hasVisibleVideo needs a track and camera or screen', () {
      const track = PurpleCallioVideoTrack(id: 't', native: Object);
      const p = PurpleCallioParticipant(
          participantId: 'p',
          role: PurpleCallioRole.caller,
          isLocal: true,
          isCameraEnabled: true);
      expect(p.hasVisibleVideo, isFalse);
      expect(p.copyWith(videoTrack: track).hasVisibleVideo, isTrue);
      expect(
          p
              .copyWith(videoTrack: track, isCameraEnabled: false)
              .hasVisibleVideo,
          isFalse);
      expect(
          p
              .copyWith(
                  videoTrack: track,
                  isCameraEnabled: false,
                  isScreenSharing: true)
              .hasVisibleVideo,
          isTrue);
      expect(p.copyWith(videoTrack: track).copyWith(clearVideoTrack: true),
          p);
    });
  });

  test('errors expose stable codes and never print causes verbatim', () {
    final errors = <PurpleCallioError>[
      const InvalidTokenError(),
      const AuthenticationFailedError('x'),
      const ConnectionFailedError('x'),
      const SignalingFailedError('x'),
      const WebrtcFailedError('x'),
      PermissionDeniedError(PurpleCallioPermissionKind.camera),
      const MediaInitializationFailedError('x'),
      const ScreenShareUnavailableError('ios'),
      MeetingEndedError(PurpleCallioDisconnectReason.missed),
      const InvalidStateError('x'),
    ];
    expect(errors.map((e) => e.code).toSet().length, errors.length);
    const withCause = SignalingFailedError('x', 'Bearer abc.def');
    expect(withCause.toString(), isNot(contains('abc.def')));
  });
}
