import 'package:flutter_test/flutter_test.dart';
import 'package:purplecallio_flutter/purplecallio_flutter.dart';

import 'fakes/fakes.dart';

void main() {
  group('PurpleCallioLogger.redact', () {
    test('redacts bearer tokens, token/credential params and JSON fields', () {
      final cases = {
        'Authorization: Bearer eyJhbGciOi.abc.def': 'eyJhbGciOi',
        'GET /call?token=tok_123&callId=c1': 'tok_123',
        '{"token":"tok_456","x":1}': 'tok_456',
        "{callerToken: tok_789, receiverToken: 'tok_000'}": 'tok_789',
        '{"credential":"turnpw","username":"u"}': 'turnpw',
        'password=hunter2': 'hunter2',
        'x-api-key: pk_live_abcdef': 'pk_live_abcdef',
        'a=ice-pwd:asd88fgpdd777uzjYhagZg\r\n': 'asd88fgpdd777uzjYhagZg',
      };
      cases.forEach((input, secret) {
        final out = PurpleCallioLogger.redact(input);
        expect(out, isNot(contains(secret)), reason: input);
        expect(out, contains('<redacted>'), reason: input);
      });
      expect(PurpleCallioLogger.redact('callId=c1 state connected'),
          'callId=c1 state connected');
    });

    test('respects level and never lets a sink see a secret', () {
      final seen = <String>[];
      final log = PurpleCallioLogger(
          level: PurpleCallioLogLevel.warning,
          sink: (_, m) => seen.add(m));
      log.debug('Bearer abc');
      log.info('token=abc');
      log.warning('token=abc');
      log.error('Bearer abc');
      expect(seen, ['token=<redacted>', 'Bearer <redacted>']);
      final none = PurpleCallioLogger(sink: (_, m) => seen.add(m));
      none.error('x');
      expect(seen.length, 2);
    });

    test('a full SDK call at debug level never logs the token or TURN secret',
        () async {
      final lines = <String>[];
      final h = Harness(logSink: (_, m) => lines.add(m));
      final m = await h.join();
      h.signaling.serverEmit('call-accepted', {'callId': kCallId});
      await settle();
      h.rtc.peer.setIce(RtcIceState.connected);
      await m.leave();
      expect(lines, isNotEmpty);
      final all = lines.join('\n');
      expect(all, isNot(contains('participant-token-abc')));
      expect(all, isNot(contains('TURN-SECRET')));
      expect(all, isNot(contains('SECRETPWD')));
    });
  });

  group('mergeIceServers', () {
    const a = PurpleCallioIceServer(urls: ['stun:a', 'stun:b']);
    const b = PurpleCallioIceServer(
        urls: ['turn:t'], username: 'u', credential: 'c');
    const dup = PurpleCallioIceServer(urls: ['stun:b', ' stun:a ']);
    const custom = PurpleCallioIceServer(urls: ['turn:custom', 'stun:a']);

    test('merges and de-duplicates by URL', () {
      final merged =
          mergeIceServers(fetched: [a, b], configured: [dup, custom]);
      expect(merged.map((s) => s.urls).toList(), [
        ['stun:a', 'stun:b'],
        ['turn:t'],
        ['turn:custom'],
      ]);
      expect(merged[1].credential, 'c');
    });

    test('override uses only configured servers', () {
      final merged = mergeIceServers(
          fetched: [a, b], configured: [custom], override: true);
      expect(merged.map((s) => s.urls).toList(), [
        ['turn:custom', 'stun:a'],
      ]);
    });

    test('meeting uses backend + configured servers', () async {
      final h = Harness(iceServers: const [
        PurpleCallioIceServer(urls: ['turn:turn.example.com:3478']),
        PurpleCallioIceServer(urls: ['stun:mine']),
      ]);
      await h.join();
      h.signaling.serverEmit('call-accepted', {'callId': kCallId});
      await settle();
      expect(h.rtc.peer.iceServers.map((s) => s.urls).toList(), [
        ['turn:turn.example.com:3478'],
        ['stun:mine'],
      ]);
    });

    test('falls back to Google STUN when /turn/credentials fails', () async {
      final h = Harness();
      h.api.iceError = const SignalingFailedError('boom');
      await h.join();
      h.signaling.serverEmit('call-accepted', {'callId': kCallId});
      await settle();
      expect(h.rtc.peer.iceServers, [kFallbackStunServer]);
    });

    test('override skips the backend list', () async {
      final h = Harness(overrideIceServers: true, iceServers: const [
        PurpleCallioIceServer(urls: ['turn:only']),
      ]);
      await h.join();
      h.signaling.serverEmit('call-accepted', {'callId': kCallId});
      await settle();
      expect(h.api.calls, isNot(contains('turn')));
      expect(h.rtc.peer.iceServers.single.urls, ['turn:only']);
    });
  });
}
