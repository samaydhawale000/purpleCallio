import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:meta/meta.dart';

import 'api/purplecallio_api.dart';
import 'errors.dart';
import 'events.dart';
import 'ice_servers.dart';
import 'logging.dart';
import 'models.dart';
import 'rtc/rtc_engine.dart';
import 'signaling/signaling_channel.dart';
import 'util/serial_queue.dart';

/// Timeouts used by the meeting engine. Override only in tests.
@immutable
class PurpleCallioTimings {
  const PurpleCallioTimings({
    this.connectTimeout = const Duration(seconds: 20),
    this.authAckTimeout = const Duration(seconds: 10),
    this.iceRestartDelay = const Duration(seconds: 3),
    this.iceWatchdog = const Duration(seconds: 15),
  });

  /// Time allowed for the first socket connect + authentication.
  final Duration connectTimeout;

  /// Time to wait for the `authenticate` ack.
  final Duration authAckTimeout;

  /// Delay after ICE `disconnected` before the caller restarts ICE.
  final Duration iceRestartDelay;

  /// Time ICE has to recover after the first disconnect/failure.
  final Duration iceWatchdog;
}

/// A single 1:1 call, from `ringing` through `disconnected`/`failed`.
///
/// Obtain one from `PurpleCallioClient.joinMeeting`. Observe it with:
/// * [addListener] (it is a [Listenable]; notifies on any change),
/// * [connectionStateListenable],
/// * [events] (a broadcast stream of [PurpleCallioEvent]).
///
/// Always finish with [leave] (graceful) or [dispose] (local only).
class PurpleCallioMeeting implements Listenable {
  @internal
  PurpleCallioMeeting.internal({
    required String token,
    required SignalingChannel signaling,
    required PurpleCallioApi api,
    required RtcEngine rtc,
    required PurpleCallioLogger logger,
    required PurpleCallioJoinOptions options,
    required List<PurpleCallioIceServer> configuredIceServers,
    required bool overrideIceServers,
    required PurpleCallioTimings timings,
    void Function(PurpleCallioMeeting meeting)? onClosed,
  })  : _token = token,
        _signaling = signaling,
        _api = api,
        _rtc = rtc,
        _log = logger,
        _options = options,
        _configuredIceServers = configuredIceServers,
        _overrideIceServers = overrideIceServers,
        _timings = timings,
        _onClosed = onClosed,
        _micEnabled = options.microphoneEnabled,
        _camEnabled = options.cameraEnabled,
        _cameraPosition = options.cameraPosition;

  // ---------------------------------------------------------------- deps
  final String _token;
  final SignalingChannel _signaling;
  final PurpleCallioApi _api;
  final RtcEngine _rtc;
  final PurpleCallioLogger _log;
  final PurpleCallioJoinOptions _options;
  final List<PurpleCallioIceServer> _configuredIceServers;
  final bool _overrideIceServers;
  final PurpleCallioTimings _timings;
  final void Function(PurpleCallioMeeting)? _onClosed;

  // ---------------------------------------------------------------- state
  final _MeetingNotifier _notifier = _MeetingNotifier();
  PurpleCallioConnectionState _state = PurpleCallioConnectionState.idle;
  PurpleCallioDisconnectReason? _disconnectReason;
  PurpleCallioError? _error;
  late final ValueNotifier<PurpleCallioConnectionState> _stateNotifier =
      ValueNotifier(_state);
  final StreamController<PurpleCallioEvent> _events =
      StreamController<PurpleCallioEvent>.broadcast();
  final SerialQueue _queue = SerialQueue();

  String? _callId;
  String? _participantId;
  PurpleCallioRole? _role;
  PurpleCallioCallType? _callType;
  PurpleCallioCallDetails? _details;
  PurpleCallioIncomingCall? _incomingCall;
  Future<List<PurpleCallioIceServer>>? _iceServers;

  /// joinMeeting() has resolved.
  bool _started = false;

  /// Set by a terminal server event that arrived before joinMeeting resolved.
  PurpleCallioDisconnectReason? _startTerminalReason;
  Completer<void>? _firstAuth;
  bool _acceptedDuringStart = false;

  /// The socket is connected and authenticated right now.
  bool _authenticated = false;

  /// The call has been accepted/started locally (caller got call-accepted, or
  /// receiver called accept()).
  bool _callStarted = false;

  /// join-call has been emitted on the current socket connection.
  bool _inRoom = false;

  /// ICE reached connected/completed at least once.
  bool _everConnected = false;

  /// leave()/reject()/dispose()/terminal handling began.
  bool _ending = false;
  bool _tornDown = false;
  Future<void>? _endFuture;
  Future<void>? _acceptFuture;

  // Local media.
  RtcLocalMedia? _media;
  bool _mediaAcquired = false;
  RtcLocalTrack? _screenTrack;
  bool _micEnabled;
  bool _camEnabled;
  bool _screenSharing = false;
  bool _videoSuspended = false;
  PurpleCallioCameraPosition _cameraPosition;
  FutureOr<void> Function()? _afterScreenShareStop;

  /// What the server (and billing) currently believes about our media.
  bool _serverMic = true;
  bool _serverCam = false;
  bool _serverScreen = false;

  // Remote.
  PurpleCallioParticipant? _remote;
  bool _remoteMic = true;
  bool _remoteCam = false;
  bool _remoteScreen = false;
  PurpleCallioVideoTrack? _remoteVideo;

  // Peer connection.
  RtcPeer? _pc;
  bool _remoteDescriptionSet = false;
  final List<RtcIceCandidate> _pendingCandidates = [];
  RtcSessionDescription? _pendingOffer;
  RtcIceState _iceState = RtcIceState.newState;
  Timer? _connectTimer;
  Timer? _restartTimer;
  Timer? _watchdog;
  bool _iceSuccessReported = false;
  bool _iceFailureReported = false;

  // ---------------------------------------------------------------- getters

  /// Server call id (from the `connected` event).
  String get callId => _callId ?? '';

  /// Local role.
  PurpleCallioRole get role => _role ?? PurpleCallioRole.caller;

  /// Call type from call details.
  PurpleCallioCallType get callType => _callType ?? PurpleCallioCallType.video;

  PurpleCallioConnectionState get connectionState => _state;

  /// Listenable view of [connectionState].
  ValueListenable<PurpleCallioConnectionState> get connectionStateListenable =>
      _stateNotifier;

  /// Set when [connectionState] is `disconnected`.
  PurpleCallioDisconnectReason? get disconnectReason => _disconnectReason;

  /// Set when [connectionState] is `failed`.
  PurpleCallioError? get error => _error;

  /// Receiver only: the incoming call while ringing.
  PurpleCallioIncomingCall? get incomingCall => _incomingCall;

  /// Call details from the server (names, ids, type, status at join time).
  PurpleCallioCallDetails? get details => _details;

  /// Always present.
  PurpleCallioParticipant get localParticipant => _buildLocal();

  /// Present once the call is accepted, `null` after the remote leaves.
  PurpleCallioParticipant? get remoteParticipant => _remote;

  /// `[local] + [remote?]`.
  List<PurpleCallioParticipant> get participants =>
      [localParticipant, if (_remote != null) _remote!];

  bool get isMicrophoneEnabled => _micEnabled;
  bool get isCameraEnabled =>
      callType == PurpleCallioCallType.video && _camEnabled;
  bool get isScreenSharing => _screenSharing;
  PurpleCallioCameraPosition get cameraPosition => _cameraPosition;

  /// Whether local video is currently suspended by [setVideoSuspended].
  bool get isVideoSuspended => _videoSuspended;

  /// Whether this platform build can attempt screen sharing at all.
  bool get isScreenShareSupported =>
      _rtc.supportsScreenShare && callType == PurpleCallioCallType.video;

  @override
  void addListener(VoidCallback listener) => _notifier.addListener(listener);

  @override
  void removeListener(VoidCallback listener) =>
      _notifier.removeListener(listener);

  /// All meeting events. Broadcast; closes after the meeting ends.
  Stream<PurpleCallioEvent> get events => _events.stream;

  bool get _isVideoCall => callType == PurpleCallioCallType.video;

  // ---------------------------------------------------------------- start

  /// Connects, authenticates and loads call details. Called by the client.
  @internal
  Future<void> start() async {
    _setState(PurpleCallioConnectionState.connecting);
    _registerHandlers();
    final firstAuth = _firstAuth = Completer<void>();
    _connectTimer = Timer(_timings.connectTimeout, () {
      if (!firstAuth.isCompleted) {
        firstAuth.completeError(const ConnectionFailedError(
            'Timed out connecting to PurpleCallio signaling'));
      }
    });
    _signaling.connect();
    try {
      await firstAuth.future;
      _connectTimer?.cancel();
      _throwIfEndedDuringStart();

      final callId = _callId;
      if (callId == null || _participantId == null) {
        throw const AuthenticationFailedError(
            'Authenticated but no "connected" event was received');
      }

      _iceServers = _resolveIceServers();
      final details = await _api.getCallDetails(callId);
      _throwIfEndedDuringStart();
      _details = details;
      _callType = details.callType;
      _serverMic = true;
      _serverCam = details.callType == PurpleCallioCallType.video;
      _serverScreen = false;
      _remoteMic = true;
      _remoteCam = details.callType == PurpleCallioCallType.video;
      _remoteScreen = false;
      final terminal = details.status.terminalReason;
      if (terminal != null) throw MeetingEndedError(terminal);

      if (role == PurpleCallioRole.caller) {
        await _acquireLocalMedia();
        _throwIfEndedDuringStart();
      }
      _started = true;
      final proceed = role == PurpleCallioRole.caller &&
          (details.status == PurpleCallioCallStatus.accepted ||
              _acceptedDuringStart);
      if (proceed) {
        _callStarted = true;
        _recomputeState();
        _queue.run(_startCallerCall).catchError(_onRtcError);
      } else {
        _recomputeState();
      }
      _log.info('meeting ready: role=${role.name} type=${callType.name} '
          'status=${details.status.name}');
    } catch (e) {
      _connectTimer?.cancel();
      final error = _toError(e,
          (c) => ConnectionFailedError('Could not join the meeting', c));
      _log.warning('join failed: ${error.code}');
      _ending = true;
      await _teardown();
      _state = error is MeetingEndedError
          ? PurpleCallioConnectionState.disconnected
          : PurpleCallioConnectionState.failed;
      if (error is MeetingEndedError) {
        _disconnectReason = error.reason;
      } else {
        _error = error;
      }
      _stateNotifier.value = _state;
      await _closeEvents();
      throw error;
    }
  }

  void _throwIfEndedDuringStart() {
    final reason = _startTerminalReason;
    if (reason != null) throw MeetingEndedError(reason);
    if (_ending) {
      throw MeetingEndedError(
          _disconnectReason ?? PurpleCallioDisconnectReason.left);
    }
  }

  Future<List<PurpleCallioIceServer>> _resolveIceServers() async {
    if (_overrideIceServers) {
      return mergeIceServers(
          fetched: const [], configured: _configuredIceServers, override: true);
    }
    List<PurpleCallioIceServer> fetched;
    try {
      fetched = await _api.fetchIceServers();
      if (fetched.isEmpty) fetched = const [kFallbackStunServer];
    } catch (e) {
      _log.warning('turn/credentials failed, using fallback STUN');
      fetched = const [kFallbackStunServer];
    }
    return mergeIceServers(
        fetched: fetched, configured: _configuredIceServers);
  }

  // ---------------------------------------------------------------- socket

  void _registerHandlers() {
    final s = _signaling;
    s.onConnect = _handleConnect;
    s.onDisconnect = _handleDisconnect;
    s.onConnectError = (e) => _log.debug('connect error: ${e.runtimeType}');

    s.on('connected', (data) {
      if (data is! Map) return;
      final callId = data['callId'];
      final pid = data['participantId'];
      final role = PurpleCallioRole.fromWire(data['role']);
      if (callId is String) _callId ??= callId;
      if (pid is String) _participantId ??= pid;
      if (role != null) _role ??= role;
    });
    s.on('incoming-call', (data) {
      final call = PurpleCallioIncomingCall.fromJson(data);
      if (call == null) return;
      final first = _incomingCall == null;
      _incomingCall = call;
      _callType ??= call.callType;
      if (first) _emit(IncomingCallEvent(call));
      _changed();
    });
    s.on('call-accepted', (_) => _handleCallAccepted());
    s.on('call-rejected',
        (_) => _handleTerminal(PurpleCallioDisconnectReason.rejected));
    s.on('call-cancelled',
        (_) => _handleTerminal(PurpleCallioDisconnectReason.cancelled));
    s.on('call-missed',
        (_) => _handleTerminal(PurpleCallioDisconnectReason.missed));
    s.on('call-busy',
        (_) => _handleTerminal(PurpleCallioDisconnectReason.busy));
    s.on('call-ended',
        (_) => _handleTerminal(PurpleCallioDisconnectReason.remoteEnded));
    // Room broadcast (includes our own echo, which arrives while _ending).
    s.on('call.ended',
        (_) => _handleTerminal(PurpleCallioDisconnectReason.remoteEnded));
    s.on('session-replaced',
        (_) => _handleTerminal(PurpleCallioDisconnectReason.sessionReplaced));
    s.on('call.expired',
        (_) => _handleTerminal(PurpleCallioDisconnectReason.expired));
    s.on('auth-error', (data) => _handleAuthError(data is Map ? data['code'] : null));

    s.on('offer', (data) {
      final offer = RtcSessionDescription.fromJson(
          data is Map ? data['offer'] : null);
      if (offer == null) return _log.warning('ignored malformed offer');
      _queue.run(() => _handleOffer(offer)).catchError(_onRtcError);
    });
    s.on('answer', (data) {
      final answer = RtcSessionDescription.fromJson(
          data is Map ? data['answer'] : null);
      if (answer == null) return _log.warning('ignored malformed answer');
      _queue.run(() => _handleAnswer(answer)).catchError(_onRtcError);
    });
    s.on('ice-candidate', (data) {
      final c =
          RtcIceCandidate.fromJson(data is Map ? data['candidate'] : null);
      if (c == null) return;
      _queue.run(() => _handleRemoteCandidate(c)).catchError(_onRtcError);
    });

    s.on('participant.joined', (data) {
      final pid = data is Map ? data['participantId'] : null;
      if (pid is! String || pid == _participantId) return;
      if (_callStarted && !_ending) _ensureRemoteParticipant();
    });
    s.on('participant.left', (data) {
      final pid = data is Map ? data['participantId'] : null;
      if (pid is! String || pid == _participantId) return;
      final remote = _remote;
      if (remote == null || remote.participantId != pid) return;
      _remote = null;
      _emit(ParticipantLeftEvent(remote));
      _changed();
    });

    void media(String event, void Function() apply) {
      s.on(event, (data) {
        final pid = data is Map ? data['participantId'] : null;
        if (pid is! String || pid == _participantId) return;
        if (_ending) return;
        apply();
        _refreshRemote(emitUpdate: true);
      });
    }

    media('camera.enabled', () => _remoteCam = true);
    media('camera.disabled', () => _remoteCam = false);
    media('microphone.enabled', () => _remoteMic = true);
    media('microphone.disabled', () => _remoteMic = false);
    media('screenShare.started', () => _remoteScreen = true);
    media('screenShare.stopped', () => _remoteScreen = false);
    // 'participant.updated' is deliberately ignored: its media snapshot is
    // stale for any field not yet toggled (PROTOCOL.md "Media state").
  }

  Future<void> _handleConnect() async {
    if (_ending) return;
    _authenticated = false;
    _inRoom = false;
    final isFirst = !(_firstAuth?.isCompleted ?? true);
    Object? ack;
    try {
      ack = await _signaling.emitWithAck('authenticate', {'token': _token},
          timeout: _timings.authAckTimeout);
    } catch (e) {
      final err = e is SignalingAckTimeout
          ? AuthenticationFailedError('No authenticate ack from server', e)
          : AuthenticationFailedError('authenticate failed', e);
      if (isFirst) {
        _firstAuth?.completeError(err);
      } else {
        await _fail(err);
      }
      return;
    }
    if (_ending) return;
    final ok = ack is Map && ack['success'] == true;
    if (!ok) {
      if (isFirst) {
        if (!_firstAuth!.isCompleted) {
          _firstAuth!.completeError(const InvalidTokenError());
        }
      } else {
        await _fail(const InvalidTokenError(
            'Participant token rejected on reconnect'));
      }
      return;
    }
    _role ??= PurpleCallioRole.fromWire(ack['role']);
    _authenticated = true;
    _log.info('authenticated as ${role.name}');
    if (isFirst) {
      if (!_firstAuth!.isCompleted) _firstAuth!.complete();
      return;
    }
    await _onReauthenticated();
  }

  Future<void> _onReauthenticated() async {
    if (!_started || _ending) return;
    if (_callStarted) {
      _emitJoinCall();
    }
    _recomputeState();
    // Something may have happened while we were offline (remote hung up,
    // receiver accepted, the call was missed): reconcile with the server.
    try {
      final details = await _api.getCallDetails(callId);
      if (_ending) return;
      final terminal = details.status.terminalReason;
      if (terminal != null) {
        await _handleTerminal(terminal);
      } else if (role == PurpleCallioRole.caller &&
          !_callStarted &&
          details.status == PurpleCallioCallStatus.accepted) {
        _handleCallAccepted();
      }
    } catch (e) {
      _log.warning('details refresh after reconnect failed: ${e.runtimeType}');
    }
  }

  void _handleDisconnect(String reason) {
    if (_ending) return;
    _authenticated = false;
    _inRoom = false;
    if (!_started) return;
    // The hardened gateway disconnects a socket on purpose (after
    // call.ended/call.expired, auth-error, rate limits, origin checks). The
    // terminal event, if any, arrives first. Otherwise it is still final:
    // reconnecting would only loop into the per-IP limit (PROTOCOL.md).
    if (reason == 'io server disconnect') {
      _fail(ConnectionFailedError('Server closed the connection'));
      return;
    }
    _log.info('signaling lost ($reason), reconnecting');
    _recomputeState();
  }

  void _handleCallAccepted() {
    if (role != PurpleCallioRole.caller || _ending) return;
    if (!_started) {
      _acceptedDuringStart = true;
      return;
    }
    if (_callStarted) return;
    _callStarted = true;
    _recomputeState();
    _queue.run(_startCallerCall).catchError(_onRtcError);
  }

  /// Sends only while authenticated. Returns whether it was sent.
  /// `auth-error` precedes a server-side disconnect and is terminal: stop
  /// reconnecting (retries count against the per-IP connection limit).
  Future<void> _handleAuthError(Object? code) async {
    if (_ending) return;
    _log.warning('server rejected the socket: ${code ?? 'UNKNOWN'}');
    final PurpleCallioError err = (code == 'INVALID_TOKEN' || code == 'TOKEN_EXPIRED')
        ? const InvalidTokenError()
        : ConnectionFailedError('Server rejected the connection: ${code ?? 'UNKNOWN'}');
    _signaling.dispose();
    if (!(_firstAuth?.isCompleted ?? true)) {
      _firstAuth!.completeError(err);
    } else {
      await _fail(err);
    }
  }

  /// offer/answer/ice-candidate held until this socket has emitted `join-call`:
  /// the gateway silently drops signaling from sockets not in the room
  /// (PROTOCOL.md). A receiver's answer can be ready before its `join-call`.
  final List<(String, Object?)> _pendingSignals = [];

  void _sendSignal(String event, Object? data) {
    if (_inRoom && _authenticated && _signaling.isConnected) {
      _signaling.emit(event, data);
    } else {
      _pendingSignals.add((event, data));
    }
  }

  void _flushPendingSignals() {
    if (_pendingSignals.isEmpty) return;
    final queued = List.of(_pendingSignals);
    _pendingSignals.clear();
    _log.debug('sending ${queued.length} signaling message(s) held until join-call');
    for (final (event, data) in queued) {
      _signaling.emit(event, data);
    }
  }

  bool _send(String event, [Object? data]) {
    if (!_authenticated || !_signaling.isConnected) {
      _log.debug('dropped $event (signaling not ready)');
      return false;
    }
    _signaling.emit(event, data);
    return true;
  }

  void _emitJoinCall() {
    if (!_authenticated || !_signaling.isConnected) {
      _log.debug('dropped join-call (signaling not ready)');
      return;
    }
    // The gateway acks `{ success: false, error }` when the join is refused
    // (e.g. PLAYGROUND_PARTICIPANT_LIMIT). A missing ack is not a failure.
    _signaling
        .emitWithAck('join-call', {'callId': callId}, timeout: _timings.authAckTimeout)
        .then((ack) {
      if (ack is Map && ack['success'] == false && !_ending) {
        _fail(SignalingFailedError('join-call refused: ${ack['error'] ?? 'unknown'}'));
      }
    }).catchError((Object _) {});
    _inRoom = true;
    _flushPendingSignals();
    _syncMediaState();
  }

  /// Emits the difference between our real media state and what the server
  /// believes. On first join this can only produce `*.disabled` (defaults
  /// are "on"), and it never re-announces unchanged state.
  void _syncMediaState() {
    if (!_inRoom || _ending) return;
    if (_micEnabled != _serverMic) {
      if (_send(_micEnabled ? 'microphone.enabled' : 'microphone.disabled',
          {'callId': callId})) {
        _serverMic = _micEnabled;
      }
    }
    if (_isVideoCall && _camEnabled != _serverCam) {
      if (_send(_camEnabled ? 'camera.enabled' : 'camera.disabled',
          {'callId': callId})) {
        _serverCam = _camEnabled;
      }
    }
    if (_screenSharing != _serverScreen) {
      if (_send(
          _screenSharing ? 'screenShare.started' : 'screenShare.stopped',
          {'callId': callId})) {
        _serverScreen = _screenSharing;
      }
    }
  }

  // ---------------------------------------------------------------- call

  Future<void> _startCallerCall() async {
    if (_ending) return;
    _ensureRemoteParticipant();
    await _createPeer();
    if (_ending) return;
    _emitJoinCall();
    final pc = _pc!;
    final offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (_ending) return;
    _sendSignal('offer', {'offer': offer.toJson()});
    _send('call.started', {'callId': callId});
    _defaultSpeaker();
  }

  /// Receiver only, while ringing: acquires media, then accepts.
  Future<void> accept() {
    return _acceptFuture ??= _accept().whenComplete(() {
      if (!_callStarted) _acceptFuture = null;
    });
  }

  Future<void> _accept() async {
    _assertNotEnded();
    if (role != PurpleCallioRole.receiver) {
      throw const InvalidStateError('Only the receiver can accept');
    }
    if (_callStarted || _state != PurpleCallioConnectionState.ringing) {
      throw InvalidStateError('Cannot accept in state ${_state.name}');
    }
    await _acquireLocalMedia();
    _assertNotEnded();
    _callStarted = true;
    _recomputeState();
    _ensureRemoteParticipant();
    try {
      await _queue.run(_createPeer);
      _assertNotEnded();
      if (_details?.status != PurpleCallioCallStatus.accepted) {
        await _api.accept(callId);
      }
      _assertNotEnded();
    } catch (e) {
      final err = _toError(e, (c) => SignalingFailedError('accept failed', c));
      if (!_ending) await _fail(err);
      throw err;
    }
    try {
      await _api.join(callId);
    } catch (e) {
      _log.warning('POST join failed (continuing): ${e.runtimeType}');
    }
    if (_ending) return;
    _emitJoinCall();
    _send('call.started', {'callId': callId});
    _defaultSpeaker();
    final pending = _pendingOffer;
    if (pending != null) {
      _pendingOffer = null;
      await _queue.run(() => _handleOffer(pending));
    }
  }

  /// Receiver only, while ringing: declines the call.
  Future<void> reject() {
    if (_endFuture != null) return _endFuture!;
    if (role != PurpleCallioRole.receiver || _callStarted) {
      return Future.error(
          const InvalidStateError('Only a ringing receiver can reject'));
    }
    return _endFuture = _endWith(PurpleCallioDisconnectReason.rejected,
        () async {
      await _bestEffort('reject', () => _api.reject(callId));
    });
  }

  /// Ends the call from this side. Always valid and idempotent:
  /// ringing caller → cancel; ringing receiver → reject; in call → hang up.
  /// Ends in `disconnected(left)`.
  Future<void> leave() {
    return _endFuture ??= _endWith(PurpleCallioDisconnectReason.left, () async {
      if (!_started) return;
      if (!_callStarted) {
        if (role == PurpleCallioRole.caller) {
          await _bestEffort('cancel', () => _api.cancel(callId));
        } else {
          await _bestEffort('reject', () => _api.reject(callId));
        }
        return;
      }
      _send('call.ended', {'callId': callId});
      _send('call-ended');
      await _bestEffort('leave', () => _api.leave(callId));
      await _bestEffort('end', () => _api.end(callId));
    });
  }

  /// Releases everything without signaling. Idempotent. Prefer [leave] for a
  /// graceful end.
  ///
  /// Listeners are notified of the final state and then never again, so
  /// widgets that still hold the meeting can safely remove their listeners.
  Future<void> dispose() {
    return _endFuture ??=
        _endWith(PurpleCallioDisconnectReason.left, () async {});
  }

  Future<void> _endWith(PurpleCallioDisconnectReason reason,
      Future<void> Function() signal) async {
    if (_state.isTerminal) return;
    _ending = true;
    try {
      await signal();
    } finally {
      await _teardown();
      _setTerminal(PurpleCallioConnectionState.disconnected, reason: reason);
      _emit(MeetingEndedEvent(reason));
      await _closeEvents();
    }
  }

  Future<void> _bestEffort(String what, Future<void> Function() f) async {
    try {
      await f();
    } catch (e) {
      _log.warning('POST $what failed: ${e.runtimeType}');
    }
  }

  Future<void> _handleTerminal(PurpleCallioDisconnectReason reason) async {
    if (_ending || _state.isTerminal) return;
    if (!_started) {
      _startTerminalReason ??= reason;
      final fa = _firstAuth;
      if (fa != null && !fa.isCompleted) {
        fa.completeError(MeetingEndedError(reason));
      }
      return;
    }
    _log.info('call ended by server/remote: ${reason.name}');
    _endFuture ??= _endWith(reason, () async {});
    await _endFuture;
  }

  Future<void> _fail(PurpleCallioError error) async {
    if (_ending || _state.isTerminal) return;
    _ending = true;
    _log.error('meeting failed: ${error.code}');
    _error = error;
    _emit(ErrorEvent(error, fatal: true));
    final done = Completer<void>();
    _endFuture ??= done.future;
    await _teardown();
    _setTerminal(PurpleCallioConnectionState.failed);
    await _closeEvents();
    if (!done.isCompleted) done.complete();
  }

  void _onRtcError(Object e, [StackTrace? st]) {
    if (_ending) return;
    _fail(_toError(e, (c) => WebrtcFailedError('WebRTC operation failed', c)));
  }

  // ---------------------------------------------------------------- media

  Future<void> _acquireLocalMedia() async {
    if (_mediaAcquired) return;
    final wantVideo = _isVideoCall && _camEnabled;
    RtcLocalMedia media;
    try {
      media = await _rtc.getUserMedia(
          audio: true, video: wantVideo, cameraPosition: _cameraPosition);
    } on RtcMediaException catch (e) {
      if (e.kind != PurpleCallioPermissionKind.camera) throw e.toError();
      // PROTOCOL.md: if video capture fails, fall back to audio only.
      _log.warning('camera capture failed, continuing audio-only');
      _emit(ErrorEvent(e.toError(), fatal: false));
      try {
        media = await _rtc.getUserMedia(
            audio: true, video: false, cameraPosition: _cameraPosition);
      } on RtcMediaException catch (e2) {
        throw e2.toError();
      }
      _camEnabled = false;
    } catch (e) {
      throw MediaInitializationFailedError('Could not capture media', e);
    }
    if (_ending) {
      await media.audio?.dispose();
      await media.video?.dispose();
      return;
    }
    _media = media;
    _mediaAcquired = true;
    media.audio?.enabled = _micEnabled;
    _applyVideoEnabled();
    _changed();
  }

  void _applyVideoEnabled() {
    final v = _media?.video;
    if (v != null) v.enabled = _camEnabled && !_videoSuspended;
  }

  Future<void> _createPeer() async {
    if (_pc != null || _ending) return;
    final servers = await (_iceServers ??= _resolveIceServers());
    if (_ending) return;
    final pc = await _rtc.createPeer(servers);
    if (_ending) {
      await pc.close();
      return;
    }
    _pc = pc;
    pc.onIceCandidate = (c) {
      if (_ending) return;
      _sendSignal('ice-candidate', {'candidate': c.toJson()});
    };
    pc.onIceStateChange = _handleIceState;
    pc.onRemoteTrack = _handleRemoteTrack;
    final media = _media ?? RtcLocalMedia();
    await pc.addLocalTracks(media, videoCall: _isVideoCall);
  }

  Future<void> _handleOffer(RtcSessionDescription offer) async {
    if (_ending) return;
    final pc = _pc;
    if (pc == null) {
      _pendingOffer = offer;
      return;
    }
    await pc.setRemoteDescription(offer);
    _remoteDescriptionSet = true;
    await _flushCandidates(pc);
    final answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (_ending) return;
    _sendSignal('answer', {'answer': answer.toJson()});
  }

  Future<void> _handleAnswer(RtcSessionDescription answer) async {
    final pc = _pc;
    if (pc == null || _ending) return;
    await pc.setRemoteDescription(answer);
    _remoteDescriptionSet = true;
    await _flushCandidates(pc);
  }

  Future<void> _handleRemoteCandidate(RtcIceCandidate c) async {
    final pc = _pc;
    if (_ending) return;
    if (pc == null || !_remoteDescriptionSet) {
      _pendingCandidates.add(c);
      return;
    }
    try {
      await pc.addIceCandidate(c);
    } catch (e) {
      _log.debug('addIceCandidate failed: ${e.runtimeType}');
    }
  }

  Future<void> _flushCandidates(RtcPeer pc) async {
    final queued = List.of(_pendingCandidates);
    _pendingCandidates.clear();
    for (final c in queued) {
      try {
        await pc.addIceCandidate(c);
      } catch (e) {
        _log.debug('addIceCandidate (flushed) failed: ${e.runtimeType}');
      }
    }
  }

  void _handleRemoteTrack(RtcRemoteTrack track) {
    if (_ending) return;
    if (track.kind == 'video' && track.videoHandle != null) {
      _remoteVideo = track.videoHandle;
    }
    _refreshRemote(emitUpdate: false);
    final remote = _remote;
    if (remote != null) _emit(RemoteTrackAddedEvent(remote, track.kind));
  }

  // ---------------------------------------------------------------- ICE

  void _handleIceState(RtcIceState s) {
    if (_ending) return;
    _iceState = s;
    _log.debug('ICE ${s.wire}');
    switch (s) {
      case RtcIceState.connected:
      case RtcIceState.completed:
        _everConnected = true;
        _watchdog?.cancel();
        _watchdog = null;
        _restartTimer?.cancel();
        _restartTimer = null;
        if (!_iceSuccessReported) {
          _iceSuccessReported = true;
          _reportIce('SUCCESS', s);
        }
      case RtcIceState.disconnected:
        _watchdog ??= Timer(_timings.iceWatchdog, _onWatchdog);
        if (role == PurpleCallioRole.caller && _restartTimer == null) {
          _restartTimer = Timer(_timings.iceRestartDelay, () {
            _restartTimer = null;
            _queue.run(_iceRestart).catchError(_onIceRestartError);
          });
        }
      case RtcIceState.failed:
        _watchdog ??= Timer(_timings.iceWatchdog, _onWatchdog);
        if (!_iceFailureReported) {
          _iceFailureReported = true;
          _reportIce('FAILED', s);
        }
        if (role == PurpleCallioRole.caller) {
          _restartTimer?.cancel();
          _restartTimer = null;
          _queue.run(_iceRestart).catchError(_onIceRestartError);
        }
      case RtcIceState.newState:
      case RtcIceState.checking:
      case RtcIceState.closed:
        break;
    }
    _recomputeState();
  }

  bool get _iceUp =>
      _iceState == RtcIceState.connected || _iceState == RtcIceState.completed;

  Future<void> _iceRestart() async {
    final pc = _pc;
    if (pc == null || _ending || role != PurpleCallioRole.caller || _iceUp) {
      return;
    }
    _log.info('ICE restart');
    final offer = await pc.createOffer(iceRestart: true);
    await pc.setLocalDescription(offer);
    if (_ending) return;
    _sendSignal('offer', {'offer': offer.toJson()});
  }

  Null _onIceRestartError(Object e) {
    _log.warning('ICE restart failed: ${e.runtimeType}');
    return null;
  }

  void _onWatchdog() {
    _watchdog = null;
    if (_ending || _iceUp) return;
    _fail(const WebrtcFailedError(
        'Media connection did not recover within the watchdog window'));
  }

  void _reportIce(String outcome, RtcIceState s) {
    final id = _callId;
    if (id == null) return;
    _api
        .reportIceOutcome(id, outcome: outcome, iceConnectionState: s.wire)
        .catchError((Object _) {});
  }

  void _defaultSpeaker() {
    if (!_isVideoCall) return;
    _rtc.setSpeakerphoneOn(true).catchError((Object e) {
      _log.debug('speakerphone: ${e.runtimeType}');
    });
  }

  // ---------------------------------------------------------------- toggles

  Future<void> enableMicrophone() => _setMicrophone(true);
  Future<void> disableMicrophone() => _setMicrophone(false);

  /// Flips the current microphone state.
  Future<void> toggleMicrophone() => _setMicrophone(!_micEnabled);

  Future<void> _setMicrophone(bool on) async {
    _assertNotEnded();
    if (_micEnabled == on) return;
    final track = _media?.audio;
    if (_mediaAcquired && track == null) {
      throw const InvalidStateError('No microphone track');
    }
    _micEnabled = on;
    track?.enabled = on;
    _syncMediaState();
    _changed();
  }

  Future<void> enableCamera() => _setCamera(true);
  Future<void> disableCamera() => _setCamera(false);

  /// Flips the current camera state.
  Future<void> toggleCamera() => _setCamera(!_camEnabled);

  Future<void> _setCamera(bool on) async {
    _assertNotEnded();
    if (!_isVideoCall) {
      throw const InvalidStateError('Camera is not available in audio calls');
    }
    if (_camEnabled == on) return;
    if (on && _mediaAcquired && _media?.video == null) {
      // Joined with the camera off (or capture failed earlier): capture now
      // and attach to the existing video sender, no renegotiation.
      await _captureCameraLate();
      if (_ending) return;
    }
    _camEnabled = on;
    _applyVideoEnabled();
    _syncMediaState();
    _changed();
  }

  Future<void> _captureCameraLate() async {
    RtcLocalMedia m;
    try {
      m = await _rtc.getUserMedia(
          audio: false, video: true, cameraPosition: _cameraPosition);
    } on RtcMediaException catch (e) {
      throw e.toError();
    }
    final track = m.video;
    if (track == null) {
      throw const MediaInitializationFailedError('No camera track returned');
    }
    if (_ending) {
      await track.dispose();
      return;
    }
    (_media ??= RtcLocalMedia()).video = track;
    track.enabled = !_videoSuspended;
    final pc = _pc;
    if (pc != null && !_screenSharing) {
      await _queue.run(() => pc.replaceVideoTrack(track));
    }
  }

  /// Switches front ↔ back camera. No signaling.
  Future<void> switchCamera() async {
    _assertNotEnded();
    final track = _media?.video;
    if (track == null) {
      throw const InvalidStateError('No camera track to switch');
    }
    try {
      await track.switchCamera();
    } catch (e) {
      throw MediaInitializationFailedError('switchCamera failed', e);
    }
    _cameraPosition = _cameraPosition == PurpleCallioCameraPosition.front
        ? PurpleCallioCameraPosition.back
        : PurpleCallioCameraPosition.front;
    _changed();
  }

  /// Silently suspends (`true`) or resumes (`false`) sending camera video
  /// without changing [isCameraEnabled] and without any signaling or billing
  /// event. Used by `PurpleCallioLifecycle` while the app is backgrounded.
  void setVideoSuspended(bool suspended) {
    if (_ending || _videoSuspended == suspended) return;
    _videoSuspended = suspended;
    _applyVideoEnabled();
    _changed();
  }

  /// Routes call audio to the loudspeaker (default for video calls) or the
  /// earpiece.
  Future<void> setSpeakerphoneOn(bool on) => _rtc.setSpeakerphoneOn(on);

  /// **Experimental, Android only, not device-validated.**
  ///
  /// Replaces the outgoing camera track with a screen capture track (no
  /// renegotiation) and emits `screenShare.started`.
  ///
  /// Android 10+ requires your app to run a foreground service of type
  /// `mediaProjection` while capturing: start it in [beforeCapture] and stop
  /// it in [afterStop]. On iOS, web and desktop this throws
  /// [ScreenShareUnavailableError].
  Future<void> startScreenShare({
    FutureOr<void> Function()? beforeCapture,
    FutureOr<void> Function()? afterStop,
  }) async {
    _assertNotEnded();
    if (!_isVideoCall) {
      throw const ScreenShareUnavailableError('audio call');
    }
    if (!_rtc.supportsScreenShare) {
      throw const ScreenShareUnavailableError(
          'not supported on this platform');
    }
    if (_screenSharing) return;
    final pc = _pc;
    if (!_callStarted || pc == null) {
      throw const InvalidStateError('Screen share needs an active call');
    }
    if (!pc.hasVideoSender) {
      throw const ScreenShareUnavailableError('no video sender');
    }
    await beforeCapture?.call();
    RtcLocalTrack track;
    try {
      track = await _rtc.getDisplayMedia();
    } on PurpleCallioError {
      await afterStop?.call();
      rethrow;
    } catch (e) {
      await afterStop?.call();
      throw ScreenShareUnavailableError('capture declined or failed', e);
    }
    if (_ending) {
      await track.dispose();
      await afterStop?.call();
      return;
    }
    await _queue.run(() => pc.replaceVideoTrack(track));
    _screenTrack = track;
    _afterScreenShareStop = afterStop;
    track.onEnded = () => stopScreenShare();
    _screenSharing = true;
    _syncMediaState();
    _changed();
  }

  /// Puts the camera track back and emits `screenShare.stopped`.
  Future<void> stopScreenShare() async {
    if (!_screenSharing || _ending) return;
    _screenSharing = false;
    final track = _screenTrack;
    _screenTrack = null;
    final camera = _media?.video;
    final pc = _pc;
    if (pc != null) await _queue.run(() => pc.replaceVideoTrack(camera));
    await track?.dispose();
    _syncMediaState();
    _changed();
    final after = _afterScreenShareStop;
    _afterScreenShareStop = null;
    await after?.call();
  }

  // ---------------------------------------------------------------- model

  PurpleCallioParticipant _buildLocal() {
    final d = _details;
    final isCaller = role == PurpleCallioRole.caller;
    final video = _screenSharing
        ? _screenTrack?.videoHandle
        : _media?.video?.videoHandle;
    return PurpleCallioParticipant(
      participantId: _participantId ?? '',
      role: role,
      isLocal: true,
      displayName: d == null ? null : (isCaller ? d.callerName : d.receiverName),
      avatarUrl:
          d == null ? null : (isCaller ? d.callerAvatar : d.receiverAvatar),
      isMicrophoneEnabled: _micEnabled,
      isCameraEnabled: isCameraEnabled && !_videoSuspended,
      isScreenSharing: _screenSharing,
      videoTrack: _tornDown ? null : video,
    );
  }

  PurpleCallioParticipant? _buildRemote() {
    final d = _details;
    if (d == null) return null;
    final remoteIsCaller = role == PurpleCallioRole.receiver;
    return PurpleCallioParticipant(
      participantId: remoteIsCaller ? d.callerId : d.receiverId,
      role: role.other,
      isLocal: false,
      displayName: remoteIsCaller ? d.callerName : d.receiverName,
      avatarUrl: remoteIsCaller ? d.callerAvatar : d.receiverAvatar,
      isMicrophoneEnabled: _remoteMic,
      isCameraEnabled: _isVideoCall && _remoteCam,
      isScreenSharing: _remoteScreen,
      videoTrack: _remoteVideo,
    );
  }

  void _ensureRemoteParticipant() {
    if (_remote != null) return;
    final r = _buildRemote();
    if (r == null) return;
    _remote = r;
    _emit(ParticipantJoinedEvent(r));
    _changed();
  }

  void _refreshRemote({required bool emitUpdate}) {
    if (_remote == null) return;
    final r = _buildRemote();
    if (r == null || r == _remote) return;
    _remote = r;
    if (emitUpdate) _emit(ParticipantUpdatedEvent(r));
    _changed();
  }

  // ---------------------------------------------------------------- state

  void _recomputeState() {
    if (_ending || _state.isTerminal) return;
    PurpleCallioConnectionState next;
    if (!_started) {
      next = PurpleCallioConnectionState.connecting;
    } else if (!_authenticated) {
      next = PurpleCallioConnectionState.reconnecting;
    } else if (!_callStarted) {
      next = PurpleCallioConnectionState.ringing;
    } else if (_iceUp) {
      next = PurpleCallioConnectionState.connected;
    } else if (_everConnected) {
      next = PurpleCallioConnectionState.reconnecting;
    } else {
      next = PurpleCallioConnectionState.joining;
    }
    _setState(next);
  }

  void _setState(PurpleCallioConnectionState next) {
    if (_state == next) return;
    final prev = _state;
    _state = next;
    _stateNotifier.value = next;
    _log.info('state ${prev.name} -> ${next.name}');
    _emit(ConnectionStateChangedEvent(next, prev));
    _changed();
  }

  void _setTerminal(PurpleCallioConnectionState s,
      {PurpleCallioDisconnectReason? reason}) {
    if (_state.isTerminal) return;
    if (reason != null) _disconnectReason = reason;
    final prev = _state;
    _state = s;
    _stateNotifier.value = s;
    _log.info('state ${prev.name} -> ${s.name}'
        '${reason != null ? ' (${reason.name})' : ''}');
    _emit(ConnectionStateChangedEvent(s, prev));
    _changed(force: true);
  }

  bool _notifyClosed = false;

  void _changed({bool force = false}) {
    if (_notifyClosed) return;
    if (force) _notifyClosed = true;
    _notifier.notify();
  }

  void _emit(PurpleCallioEvent e) {
    if (!_events.isClosed) _events.add(e);
  }

  Future<void> _closeEvents() async {
    if (!_events.isClosed) await _events.close();
  }

  void _assertNotEnded() {
    if (_ending || _state.isTerminal) {
      throw MeetingEndedError(
          _disconnectReason ?? PurpleCallioDisconnectReason.left);
    }
  }

  static PurpleCallioError _toError(
      Object e, PurpleCallioError Function(Object cause) wrap) {
    if (e is PurpleCallioError) return e;
    if (e is RtcMediaException) return e.toError();
    return wrap(e);
  }

  // ---------------------------------------------------------------- cleanup

  /// Releases every resource. Deterministic and idempotent.
  Future<void> _teardown() async {
    if (_tornDown) return;
    _tornDown = true;
    _connectTimer?.cancel();
    _restartTimer?.cancel();
    _watchdog?.cancel();
    _connectTimer = null;
    _restartTimer = null;
    _watchdog = null;
    _queue.close();
    final fa = _firstAuth;
    if (fa != null && !fa.isCompleted) {
      fa.completeError(MeetingEndedError(
          _startTerminalReason ?? PurpleCallioDisconnectReason.left));
    }
    _authenticated = false;
    _inRoom = false;
    _pendingSignals.clear();
    _signaling.dispose();

    final pc = _pc;
    _pc = null;
    _pendingCandidates.clear();
    _pendingOffer = null;
    await _safe(() => pc?.close());

    final screen = _screenTrack;
    _screenTrack = null;
    await _safe(() => screen?.dispose());
    final media = _media;
    _media = null;
    await _safe(() => media?.audio?.dispose());
    await _safe(() => media?.video?.dispose());
    _screenSharing = false;
    _remoteVideo = null;
    _remote = null;
    _api.close();
    final after = _afterScreenShareStop;
    _afterScreenShareStop = null;
    if (after != null) await _safe(() async => after());
    _onClosed?.call(this);
  }

  Future<void> _safe(FutureOr<void> Function() f) async {
    try {
      await f();
    } catch (e) {
      _log.debug('cleanup step failed: ${e.runtimeType}');
    }
  }

  @visibleForTesting
  bool get debugIsTornDown => _tornDown;

  @visibleForTesting
  int get debugPendingCandidateCount => _pendingCandidates.length;

  @override
  String toString() =>
      'PurpleCallioMeeting(${role.name}, ${_state.name}, call=${_callId ?? '-'})';

  // Unused-field guard for options kept for diagnostics.
  @visibleForTesting
  PurpleCallioJoinOptions get debugOptions => _options;
}

class _MeetingNotifier extends ChangeNotifier {
  void notify() => notifyListeners();
}
