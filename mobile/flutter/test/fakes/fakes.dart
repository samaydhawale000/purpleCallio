import 'dart:async';

export 'package:purplecallio_flutter/src/rtc/rtc_engine.dart'
    show RtcIceState, RtcMediaException;

import 'package:purplecallio_flutter/purplecallio_flutter.dart';
import 'package:purplecallio_flutter/src/api/purplecallio_api.dart';
import 'package:purplecallio_flutter/src/rtc/rtc_engine.dart';
import 'package:purplecallio_flutter/src/signaling/signaling_channel.dart';

/// Ordered log of everything the SDK did across signaling, REST and RTC.
class Timeline {
  final List<String> entries = [];
  void add(String e) => entries.add(e);

  /// Index of the first entry equal to [e] (or starting with it when
  /// [prefix]), -1 if absent.
  int indexOf(String e, {bool prefix = false}) => entries.indexWhere(
      (x) => prefix ? x.startsWith(e) : x == e);

  List<String> where(bool Function(String) f) => entries.where(f).toList();
  void clear() => entries.clear();
  @override
  String toString() => entries.join('\n');
}

// ------------------------------------------------------------------ server

const kCallId = 'call_123';
const kCallerId = 'user_alice';
const kReceiverId = 'user_bob';

/// Real `GET /calls/:id/details` shape (call.service.ts getCallDetails).
Map<String, dynamic> detailsJson({
  String type = 'VIDEO',
  String status = 'RINGING',
  bool caller = true,
}) =>
    {
      'callId': kCallId,
      'type': type,
      'status': status,
      'callerId': kCallerId,
      'receiverId': kReceiverId,
      'callerName': 'Alice',
      'callerAvatar': 'https://example.com/a.png',
      'receiverName': 'Bob',
      'receiverAvatar': null,
      'participantId': caller ? kCallerId : kReceiverId,
      'token': 'SECRET-TOKEN-SHOULD-NOT-BE-KEPT',
      'hostedUrl': 'http://localhost:5173/call?token=SECRET&callId=$kCallId',
      'expiresAt': '2030-01-01T00:00:00.000Z',
      'branding': {
        'companyName': 'Acme',
        'logoUrl': null,
        'primaryColor': '#6d28d9',
        'theme': 'dark',
        'waitingRoom': false,
      },
    };

// ------------------------------------------------------------------ signaling

class FakeSignaling implements SignalingChannel {
  FakeSignaling(this.timeline, {required this.role, this.autoAuth = true});

  final Timeline timeline;
  final String role; // 'CALLER' | 'RECEIVER'
  bool autoAuth;

  /// What the fake server replies to `authenticate`. `null` → never replies.
  Object? Function()? authAck;

  /// Events the "server" emits during authenticate, before the ack.
  List<(String, Object?)> Function()? onAuthenticateEvents;

  final Map<String, List<SignalingHandler>> handlers = {};
  final List<(String, Object?)> emitted = [];
  void Function()? _onConnect;
  void Function(String)? _onDisconnect;
  bool _connected = false;
  int connectCalls = 0;
  int disposeCalls = 0;
  bool get disposed => disposeCalls > 0;

  @override
  bool get isConnected => _connected && !disposed;

  @override
  set onConnect(void Function()? h) => _onConnect = h;
  @override
  set onDisconnect(void Function(String reason)? h) => _onDisconnect = h;
  @override
  set onConnectError(void Function(Object? error)? h) {}

  @override
  void connect() {
    connectCalls++;
    if (disposed) return;
    scheduleMicrotask(() {
      if (disposed) return;
      _connected = true;
      _onConnect?.call();
    });
  }

  @override
  void on(String event, SignalingHandler handler) =>
      (handlers[event] ??= []).add(handler);

  @override
  void emit(String event, [Object? data]) {
    if (disposed) return;
    emitted.add((event, data));
    timeline.add('emit:$event');
  }

  /// Ack body for `join-call`.
  Object? joinCallAck = const {'success': true, 'participants': 2};

  /// When set, the join-call ack is delivered only once this completes.
  Completer<void>? joinAckGate;

  @override
  Future<Object?> emitWithAck(String event, Object? data,
      {Duration timeout = const Duration(seconds: 10)}) {
    emitted.add((event, data));
    timeline.add('emit:$event');
    if (event == 'join-call') {
      final gate = joinAckGate;
      return gate == null ? Future.value(joinCallAck) : gate.future.then((_) => joinCallAck);
    }
    if (event != 'authenticate') return Future.value(null);
    final c = Completer<Object?>();
    // Server emits `connected` (+ receiver status event) before the ack.
    scheduleMicrotask(() {
      if (disposed) return;
      final ack = authAck != null
          ? authAck!()
          : {'success': true, 'role': role};
      final ok = ack is Map && ack['success'] == true;
      if (ok) {
        serverEmit('connected', {
          'callId': kCallId,
          'participantId': role == 'CALLER' ? kCallerId : kReceiverId,
          'role': role,
        });
        for (final (e, d) in onAuthenticateEvents?.call() ??
            (role == 'RECEIVER'
                ? [
                    (
                      'incoming-call',
                      {
                        'callId': kCallId,
                        'callerId': kCallerId,
                        'callerName': 'Alice',
                        'callerAvatar': 'https://example.com/a.png',
                        'type': 'VIDEO',
                      }
                    )
                  ]
                : const <(String, Object?)>[])) {
          serverEmit(e, d);
        }
      }
      if (authAck != null && ack == null) {
        // Never ack → exercise the timeout.
        return;
      }
      c.complete(ack);
    });
    return c.future.timeout(timeout,
        onTimeout: () => throw SignalingAckTimeout(event));
  }

  /// Simulates a server → client event.
  void serverEmit(String event, [Object? data]) {
    if (disposed) return;
    for (final h in List.of(handlers[event] ?? const <SignalingHandler>[])) {
      h(data);
    }
  }

  void simulateDisconnect([String reason = 'transport close']) {
    _connected = false;
    _onDisconnect?.call(reason);
  }

  void simulateReconnect() {
    _connected = true;
    _onConnect?.call();
  }

  List<String> get emittedEvents => [for (final (e, _) in emitted) e];
  int count(String event) => emittedEvents.where((e) => e == event).length;

  @override
  void dispose() {
    disposeCalls++;
    _connected = false;
    handlers.clear();
    _onConnect = null;
    _onDisconnect = null;
  }
}

// ------------------------------------------------------------------ REST

class FakeApi implements PurpleCallioApi {
  FakeApi(this.timeline, {Map<String, dynamic>? details})
      : detailsJsonValue = details ?? detailsJson();

  final Timeline timeline;
  Map<String, dynamic> detailsJsonValue;
  List<PurpleCallioIceServer>? iceServers = const [
    PurpleCallioIceServer(
        urls: ['turn:turn.example.com:3478'],
        username: 'u',
        credential: 'TURN-SECRET'),
  ];
  Object? iceError;
  final Map<String, Object> errors = {};
  final List<String> calls = [];
  int closeCalls = 0;

  /// Called when a request is recorded (e.g. to deliver a server event mid-request).
  void Function(String name)? onRecord;

  /// Awaited before a request returns (simulates latency).
  final Map<String, Future<void> Function()> holds = {};

  Future<void> _record(String name) async {
    calls.add(name);
    timeline.add('rest:$name');
    onRecord?.call(name);
    final hold = holds[name];
    if (hold != null) await hold();
    final e = errors[name];
    if (e != null) throw e;
  }

  @override
  Future<List<PurpleCallioIceServer>> fetchIceServers() async {
    await _record('turn');
    if (iceError != null) throw iceError!;
    return iceServers ?? const [];
  }

  @override
  Future<PurpleCallioCallDetails> getCallDetails(String callId) async {
    await _record('details');
    return PurpleCallioCallDetails.fromJson(detailsJsonValue);
  }

  @override
  Future<void> accept(String callId) => _record('accept');
  @override
  Future<void> reject(String callId) => _record('reject');
  @override
  Future<void> cancel(String callId) => _record('cancel');
  @override
  Future<void> join(String callId) => _record('join');
  @override
  Future<void> leave(String callId) => _record('leave');
  @override
  Future<void> end(String callId) => _record('end');
  @override
  Future<void> reportIceOutcome(String callId,
          {required String outcome,
          required String iceConnectionState,
          String? connectionState}) =>
      _record('ice:$outcome');

  @override
  void close() => closeCalls++;
}

// ------------------------------------------------------------------ RTC

class FakeTrack implements RtcLocalTrack {
  FakeTrack(this.engine, this.kind, this.label) {
    engine.tracksCreated++;
  }
  final FakeRtcEngine engine;
  @override
  final String kind;
  final String label;
  @override
  bool enabled = true;
  bool disposed = false;
  int switchCalls = 0;
  void Function()? endedHandler;

  @override
  PurpleCallioVideoTrack? get videoHandle => kind == 'video'
      ? PurpleCallioVideoTrack(id: label, native: this)
      : null;

  @override
  set onEnded(void Function()? handler) => endedHandler = handler;

  @override
  Future<void> switchCamera() async => switchCalls++;

  @override
  Future<void> dispose() async {
    if (disposed) return;
    disposed = true;
    engine.tracksDisposed++;
  }

  /// Simulates the OS ending capture.
  void end() => endedHandler?.call();
}

class FakePeer implements RtcPeer {
  FakePeer(this.engine, this.iceServers) {
    engine.peersCreated++;
  }
  final FakeRtcEngine engine;
  final List<PurpleCallioIceServer> iceServers;
  Timeline get timeline => engine.timeline;

  void Function(RtcIceCandidate)? iceCandidateHandler;
  void Function(RtcIceState)? iceStateHandler;
  void Function(RtcRemoteTrack)? remoteTrackHandler;
  RtcIceState _ice = RtcIceState.newState;
  bool closed = false;
  bool _videoSender = false;
  RtcLocalTrack? videoSenderTrack;
  final List<RtcIceCandidate> addedCandidates = [];
  RtcSessionDescription? remoteDescription;
  RtcSessionDescription? localDescription;
  int offerCount = 0;
  int iceRestartOffers = 0;
  bool addedEmptyVideoTransceiver = false;

  @override
  set onIceCandidate(void Function(RtcIceCandidate)? h) =>
      iceCandidateHandler = h;
  @override
  set onIceStateChange(void Function(RtcIceState)? h) => iceStateHandler = h;
  @override
  set onRemoteTrack(void Function(RtcRemoteTrack)? h) => remoteTrackHandler = h;
  @override
  RtcIceState get iceState => _ice;

  void setIce(RtcIceState s) {
    _ice = s;
    iceStateHandler?.call(s);
  }

  void emitLocalCandidate(String c) => iceCandidateHandler
      ?.call(RtcIceCandidate(candidate: c, sdpMid: '0', sdpMLineIndex: 0));

  void emitRemoteVideo() => remoteTrackHandler?.call(RtcRemoteTrack(
      kind: 'video',
      videoHandle: PurpleCallioVideoTrack(id: 'remote-video', native: this)));

  @override
  Future<void> addLocalTracks(RtcLocalMedia media,
      {required bool videoCall}) async {
    timeline.add('rtc:addTracks');
    if (media.video != null) {
      _videoSender = true;
      videoSenderTrack = media.video;
    } else if (videoCall) {
      _videoSender = true;
      addedEmptyVideoTransceiver = true;
    }
  }

  @override
  bool get hasVideoSender => _videoSender;

  @override
  Future<RtcSessionDescription> createOffer({bool iceRestart = false}) async {
    offerCount++;
    if (iceRestart) iceRestartOffers++;
    timeline.add(iceRestart ? 'rtc:createOffer(iceRestart)' : 'rtc:createOffer');
    return RtcSessionDescription(
        type: 'offer', sdp: 'v=0 offer$offerCount a=ice-pwd:SECRETPWD');
  }

  @override
  Future<RtcSessionDescription> createAnswer() async {
    timeline.add('rtc:createAnswer');
    return const RtcSessionDescription(type: 'answer', sdp: 'v=0 answer');
  }

  @override
  Future<void> setLocalDescription(RtcSessionDescription d) async {
    timeline.add('rtc:setLocal:${d.type}');
    localDescription = d;
  }

  @override
  Future<void> setRemoteDescription(RtcSessionDescription d) async {
    timeline.add('rtc:setRemote:${d.type}');
    remoteDescription = d;
  }

  @override
  Future<void> addIceCandidate(RtcIceCandidate c) async {
    timeline.add('rtc:addCandidate:${c.candidate}');
    addedCandidates.add(c);
  }

  @override
  Future<void> replaceVideoTrack(RtcLocalTrack? track) async {
    timeline.add('rtc:replaceVideo:${(track as FakeTrack?)?.label}');
    videoSenderTrack = track;
  }

  @override
  Future<void> close() async {
    if (closed) return;
    closed = true;
    engine.peersClosed++;
  }
}

class FakeRtcEngine implements RtcEngine {
  FakeRtcEngine(this.timeline);
  final Timeline timeline;

  int tracksCreated = 0;
  int tracksDisposed = 0;
  int peersCreated = 0;
  int peersClosed = 0;
  int getUserMediaCalls = 0;
  bool screenShareSupported = true;
  bool? speakerphone;

  /// Set to make camera or microphone capture fail.
  RtcMediaException? cameraError;
  RtcMediaException? micError;

  final List<FakePeer> peers = [];
  final List<FakeTrack> tracks = [];
  FakePeer get peer => peers.last;
  Completer<void>? gumGate;

  FakeTrack? get cameraTrack =>
      tracks.where((t) => t.label.startsWith('camera')).lastOrNull;
  FakeTrack? get micTrack =>
      tracks.where((t) => t.label == 'mic').lastOrNull;

  @override
  Future<RtcLocalMedia> getUserMedia(
      {required bool audio,
      required bool video,
      required PurpleCallioCameraPosition cameraPosition}) async {
    getUserMediaCalls++;
    timeline.add('rtc:getUserMedia(audio=$audio,video=$video)');
    if (gumGate != null) await gumGate!.future;
    if (audio && micError != null) throw micError!;
    if (video && cameraError != null) throw cameraError!;
    FakeTrack? a;
    FakeTrack? v;
    if (audio) tracks.add(a = FakeTrack(this, 'audio', 'mic'));
    if (video) {
      tracks.add(v = FakeTrack(this, 'video', 'camera${tracks.length}'));
    }
    return RtcLocalMedia(audio: a, video: v);
  }

  @override
  Future<RtcLocalTrack> getDisplayMedia() async {
    timeline.add('rtc:getDisplayMedia');
    final t = FakeTrack(this, 'video', 'screen');
    tracks.add(t);
    return t;
  }

  @override
  bool get supportsScreenShare => screenShareSupported;

  @override
  Future<RtcPeer> createPeer(List<PurpleCallioIceServer> iceServers) async {
    timeline.add('rtc:createPeer');
    final p = FakePeer(this, iceServers);
    peers.add(p);
    return p;
  }

  @override
  Future<void> setSpeakerphoneOn(bool on) async => speakerphone = on;
}

// ------------------------------------------------------------------ harness

/// Wires a client to fakes for one participant.
class Harness {
  Harness({
    String role = 'CALLER',
    Map<String, dynamic>? details,
    this.timings = const PurpleCallioTimings(
      connectTimeout: Duration(seconds: 5),
      authAckTimeout: Duration(seconds: 2),
    ),
    List<PurpleCallioIceServer> iceServers = const [],
    bool overrideIceServers = false,
    PurpleCallioLogSink? logSink,
  }) : timeline = Timeline() {
    signaling = FakeSignaling(timeline, role: role);
    api = FakeApi(timeline,
        details: details ?? detailsJson(caller: role == 'CALLER'));
    rtc = FakeRtcEngine(timeline);
    client = PurpleCallioClient(
      baseUrl: 'https://api.example.test',
      iceServers: iceServers,
      overrideIceServers: overrideIceServers,
      logLevel: logSink != null
          ? PurpleCallioLogLevel.debug
          : PurpleCallioLogLevel.none,
      logSink: logSink,
      signalingFactory: (_, __) => signaling,
      apiFactory: (_, __, ___) => api,
      rtcEngine: rtc,
      timings: timings,
    );
  }

  final Timeline timeline;
  final PurpleCallioTimings timings;
  late final FakeSignaling signaling;
  late final FakeApi api;
  late final FakeRtcEngine rtc;
  late final PurpleCallioClient client;

  Future<PurpleCallioMeeting> join(
          [PurpleCallioJoinOptions options = const PurpleCallioJoinOptions(),
          String token = 'participant-token-abc']) =>
      client.joinMeeting(token, options: options);
}

/// Lets queued microtasks/async work settle.
Future<void> settle([int rounds = 20]) async {
  for (var i = 0; i < rounds; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}
