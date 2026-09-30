// Gated end-to-end test against a REAL PurpleCallio server.
//
// Runs only when both env vars are set:
//   PURPLECALLIO_E2E_BASE_URL  e.g. http://localhost:3005
//   PURPLECALLIO_E2E_API_KEY   a project API key (test-only: this file plays
//                              the part of the customer's backend; an API key
//                              must never ship inside an app)
//
// It exercises the SDK's real Socket.IO signaling and real HTTP REST client
// for both participants, with a fake RTC engine (no platform channels in the
// Dart VM), so offer/answer/candidates are relayed through the real server.
@TestOn('vm')
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:purplecallio_flutter/purplecallio_flutter.dart';

import '../fakes/fakes.dart';

final _base = Platform.environment['PURPLECALLIO_E2E_BASE_URL'];
final _key = Platform.environment['PURPLECALLIO_E2E_API_KEY'];
final _skip = (_base == null || _base!.isEmpty || _key == null || _key!.isEmpty)
    ? 'Set PURPLECALLIO_E2E_BASE_URL and PURPLECALLIO_E2E_API_KEY to run'
    : false;

Future<void> waitFor(bool Function() cond,
    {Duration timeout = const Duration(seconds: 15), String? what}) async {
  final sw = Stopwatch()..start();
  while (!cond()) {
    if (sw.elapsed > timeout) {
      fail('Timed out waiting for ${what ?? 'condition'}');
    }
    await Future<void>.delayed(const Duration(milliseconds: 50));
  }
}

/// Simulates the customer's backend: creates a call with the API key.
Future<Map<String, dynamic>> createCall({String type = 'VIDEO'}) async {
  final suffix = DateTime.now().microsecondsSinceEpoch;
  final res = await http.post(
    Uri.parse('$_base/calls'),
    headers: {'x-api-key': _key!, 'Content-Type': 'application/json'},
    body: jsonEncode({
      'callerId': 'flutter-e2e-caller-$suffix',
      'receiverId': 'flutter-e2e-receiver-$suffix',
      'type': type,
      'callerName': 'E2E Caller',
      'receiverName': 'E2E Receiver',
    }),
  );
  expect(res.statusCode, inInclusiveRange(200, 201),
      reason: 'POST /calls failed: ${res.statusCode}');
  return jsonDecode(res.body) as Map<String, dynamic>;
}

void main() {
  test('two SDK meetings complete a call through the real server', () async {
    final created = await createCall();
    final callId = created['callId'] as String;
    final callerToken = created['callerToken'] as String;
    final receiverToken = created['receiverToken'] as String;

    final callerRtc = FakeRtcEngine(Timeline());
    final receiverRtc = FakeRtcEngine(Timeline());
    final logs = <String>[];
    void sink(PurpleCallioLogLevel _, String m) => logs.add(m);

    final callerClient = PurpleCallioClient(
        baseUrl: _base!,
        rtcEngine: callerRtc,
        logLevel: PurpleCallioLogLevel.debug,
        logSink: sink);
    final receiverClient = PurpleCallioClient(
        baseUrl: _base!,
        rtcEngine: receiverRtc,
        logLevel: PurpleCallioLogLevel.debug,
        logSink: sink);

    try {
      // Both authenticate.
      final caller = await callerClient.joinMeeting(callerToken);
      expect(caller.callId, callId);
      expect(caller.role, PurpleCallioRole.caller);
      expect(caller.connectionState, PurpleCallioConnectionState.ringing);
      expect(caller.localParticipant.displayName, 'E2E Caller');

      final receiver = await receiverClient.joinMeeting(receiverToken);
      expect(receiver.role, PurpleCallioRole.receiver);
      expect(receiver.connectionState, PurpleCallioConnectionState.ringing);
      expect(receiver.incomingCall?.callerName, 'E2E Caller');
      expect(receiver.incomingCall?.callType, PurpleCallioCallType.video);

      // Receiver accepts via real REST → server emits call-accepted → caller
      // joins and sends an offer, which the server relays.
      await receiver.accept();
      await waitFor(() => callerRtc.peers.isNotEmpty, what: 'caller peer');
      await waitFor(
          () => receiverRtc.peers.isNotEmpty &&
              receiverRtc.peer.remoteDescription?.type == 'offer',
          what: 'offer relayed to receiver');
      expect(receiverRtc.peer.remoteDescription!.sdp, startsWith('v=0 offer1'));
      await waitFor(
          () => callerRtc.peer.remoteDescription?.type == 'answer',
          what: 'answer relayed to caller');

      // Candidates relay both ways.
      callerRtc.peer.emitLocalCandidate('candidate:caller-1');
      receiverRtc.peer.emitLocalCandidate('candidate:receiver-1');
      await waitFor(
          () => receiverRtc.peer.addedCandidates
              .any((c) => c.candidate == 'candidate:caller-1'),
          what: 'caller candidate at receiver');
      await waitFor(
          () => callerRtc.peer.addedCandidates
              .any((c) => c.candidate == 'candidate:receiver-1'),
          what: 'receiver candidate at caller');

      callerRtc.peer.setIce(RtcIceState.connected);
      receiverRtc.peer.setIce(RtcIceState.connected);
      expect(caller.connectionState, PurpleCallioConnectionState.connected);
      expect(receiver.connectionState, PurpleCallioConnectionState.connected);
      expect(caller.remoteParticipant?.displayName, 'E2E Receiver');
      expect(receiver.remoteParticipant?.displayName, 'E2E Caller');

      // Media state relays via the room (both joined with join-call).
      await caller.toggleMicrophone();
      await waitFor(
          () => receiver.remoteParticipant?.isMicrophoneEnabled == false,
          what: 'microphone.disabled relayed');
      // Our own echo must not have changed our local state.
      expect(caller.isMicrophoneEnabled, isFalse);
      expect(caller.remoteParticipant?.isMicrophoneEnabled, isTrue);

      // Hang up → receiver gets call-ended.
      await caller.leave();
      await waitFor(
          () => receiver.connectionState ==
              PurpleCallioConnectionState.disconnected,
          what: 'receiver sees hang-up');
      expect(receiver.disconnectReason, PurpleCallioDisconnectReason.remoteEnded);
      expect(caller.disconnectReason, PurpleCallioDisconnectReason.left);
      expect(callerRtc.tracksDisposed, callerRtc.tracksCreated);
      expect(receiverRtc.tracksDisposed, receiverRtc.tracksCreated);

      // A finished call cannot be rejoined as a receiver.
      await expectLater(receiverClient.joinMeeting(receiverToken),
          throwsA(isA<PurpleCallioError>()));

      // Tokens never reached the logs.
      final all = logs.join('\n');
      expect(all, isNot(contains(callerToken)));
      expect(all, isNot(contains(receiverToken)));
    } finally {
      await callerClient.dispose();
      await receiverClient.dispose();
    }
  }, skip: _skip, timeout: const Timeout(Duration(seconds: 90)));

  test('invalid token is rejected by the real server', () async {
    final client = PurpleCallioClient(baseUrl: _base!, rtcEngine: FakeRtcEngine(Timeline()));
    await expectLater(client.joinMeeting('definitely-not-a-token'),
        throwsA(isA<InvalidTokenError>()));
    await client.dispose();
  }, skip: _skip, timeout: const Timeout(Duration(seconds: 30)));

  test('caller cancel while ringing reaches the receiver', () async {
    final created = await createCall(type: 'AUDIO');
    final c = PurpleCallioClient(baseUrl: _base!, rtcEngine: FakeRtcEngine(Timeline()));
    final r = PurpleCallioClient(baseUrl: _base!, rtcEngine: FakeRtcEngine(Timeline()));
    try {
      final caller = await c.joinMeeting(created['callerToken'] as String);
      final receiver = await r.joinMeeting(created['receiverToken'] as String);
      expect(receiver.callType, PurpleCallioCallType.audio);
      await caller.leave();
      await waitFor(
          () => receiver.disconnectReason == PurpleCallioDisconnectReason.cancelled,
          what: 'call-cancelled at receiver');
    } finally {
      await c.dispose();
      await r.dispose();
    }
  }, skip: _skip, timeout: const Timeout(Duration(seconds: 60)));
}
