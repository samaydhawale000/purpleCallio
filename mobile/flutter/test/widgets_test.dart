import 'package:flutter/material.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:purplecallio_flutter/purplecallio_flutter.dart';

import 'fakes/fakes.dart';

class FakeRenderer implements PurpleCallioVideoRenderer {
  static final List<FakeRenderer> all = [];
  FakeRenderer() {
    all.add(this);
  }
  bool initialized = false;
  bool disposed = false;
  final List<String?> sources = [];
  bool? lastMirror;

  @override
  Future<void> initialize() async => initialized = true;

  @override
  Future<void> setSource(PurpleCallioVideoTrack? track) async =>
      sources.add(track?.id);

  @override
  Widget build(BuildContext context,
      {required bool mirror, required PurpleCallioVideoFit fit}) {
    lastMirror = mirror;
    return const SizedBox(key: Key('fake-video'));
  }

  @override
  Future<void> dispose() async => disposed = true;
}

PurpleCallioParticipant participant({
  bool local = true,
  bool camera = true,
  String? track = 'cam',
}) =>
    PurpleCallioParticipant(
      participantId: 'p1',
      role: PurpleCallioRole.caller,
      isLocal: local,
      displayName: 'Alice',
      isCameraEnabled: camera,
      videoTrack:
          track == null ? null : PurpleCallioVideoTrack(id: track, native: track),
    );

Widget host(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  setUp(FakeRenderer.all.clear);

  testWidgets('PurpleCallioVideoView owns its renderer lifecycle',
      (tester) async {
    await tester.pumpWidget(host(PurpleCallioVideoView(
      participant: participant(),
      rendererFactory: FakeRenderer.new,
    )));
    await tester.pump();
    final r = FakeRenderer.all.single;
    expect(r.initialized, isTrue);
    expect(r.sources, ['cam']);
    expect(find.byKey(const Key('fake-video')), findsOneWidget);
    expect(r.lastMirror, isTrue); // local defaults to mirrored

    // Track change re-points the same renderer.
    await tester.pumpWidget(host(PurpleCallioVideoView(
      participant: participant(track: 'cam2'),
      rendererFactory: FakeRenderer.new,
    )));
    await tester.pump();
    expect(FakeRenderer.all.length, 1);
    expect(r.sources, ['cam', 'cam2']);

    // Camera off → placeholder with initial.
    await tester.pumpWidget(host(PurpleCallioVideoView(
      participant: participant(track: 'cam2', camera: false),
      rendererFactory: FakeRenderer.new,
    )));
    await tester.pump();
    expect(find.byKey(const Key('fake-video')), findsNothing);
    expect(find.text('A'), findsOneWidget);

    await tester.pumpWidget(host(const SizedBox()));
    expect(r.disposed, isTrue);
  });

  testWidgets('remote view is not mirrored; custom placeholder is used',
      (tester) async {
    await tester.pumpWidget(host(PurpleCallioVideoView(
      participant: participant(local: false),
      rendererFactory: FakeRenderer.new,
    )));
    await tester.pump();
    expect(FakeRenderer.all.single.lastMirror, isFalse);

    await tester.pumpWidget(host(PurpleCallioVideoView(
      participant: null,
      rendererFactory: FakeRenderer.new,
      placeholder: (_) => const Text('waiting'),
    )));
    await tester.pump();
    expect(find.text('waiting'), findsOneWidget);
  });

  testWidgets('participant list reflects meeting changes', (tester) async {
    final h = Harness();
    late PurpleCallioMeeting m;
    await tester.runAsync(() async {
      m = await h.join();
      h.signaling.serverEmit('call-accepted', {'callId': kCallId});
      await settle();
    });
    await tester.pumpWidget(host(PurpleCallioParticipantList(meeting: m)));
    expect(find.text('Alice (you)'), findsOneWidget);
    expect(find.text('Bob'), findsOneWidget);
    expect(find.byIcon(Icons.mic), findsNWidgets(2));

    await tester.runAsync(() => m.toggleMicrophone());
    await tester.pump();
    expect(find.byIcon(Icons.mic_off), findsOneWidget);
    await tester.runAsync(() => m.leave());
    await tester.pump();
    expect(find.text('Bob'), findsNothing);
  });

  testWidgets('PurpleCallioLifecycle suspends video silently in background',
      (tester) async {
    final h = Harness();
    late PurpleCallioMeeting m;
    await tester.runAsync(() async {
      m = await h.join();
      h.signaling.serverEmit('call-accepted', {'callId': kCallId});
      await settle();
    });
    final lc = PurpleCallioLifecycle(m)..attach();
    lc.didChangeAppLifecycleState(AppLifecycleState.paused);
    expect(h.rtc.cameraTrack!.enabled, isFalse);
    lc.didChangeAppLifecycleState(AppLifecycleState.resumed);
    expect(h.rtc.cameraTrack!.enabled, isTrue);
    expect(h.signaling.emittedEvents.where((e) => e.startsWith('camera.')),
        isEmpty);
    lc.didChangeAppLifecycleState(AppLifecycleState.detached);
    await tester.runAsync(settle);
    expect(m.connectionState, PurpleCallioConnectionState.disconnected);
  });
}
