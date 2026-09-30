import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../errors.dart';
import '../logging.dart';
import '../models.dart';
import 'rtc_engine.dart';

/// [RtcEngine] backed by `flutter_webrtc`.
class FlutterWebrtcEngine implements RtcEngine {
  FlutterWebrtcEngine({required this.logger});

  final PurpleCallioLogger logger;

  @override
  bool get supportsScreenShare => !kIsWeb && Platform.isAndroid;

  static bool _looksLikePermissionError(Object e) {
    final s = e.toString().toLowerCase();
    return s.contains('permission') ||
        s.contains('notallowed') ||
        s.contains('not allowed') ||
        s.contains('denied');
  }

  @override
  Future<RtcLocalMedia> getUserMedia({
    required bool audio,
    required bool video,
    required PurpleCallioCameraPosition cameraPosition,
  }) async {
    RtcLocalTrack? audioTrack;
    RtcLocalTrack? videoTrack;
    // Audio and video are captured separately so a camera failure can fall
    // back to audio-only without losing the microphone.
    if (audio) {
      try {
        final stream = await navigator.mediaDevices.getUserMedia({
          'audio': {
            'echoCancellation': true,
            'noiseSuppression': true,
            'autoGainControl': true,
          },
          'video': false,
        });
        final track = stream.getAudioTracks().first;
        audioTrack = _FlutterLocalTrack(stream, track, 'audio');
      } catch (e) {
        throw RtcMediaException(
          kind: PurpleCallioPermissionKind.microphone,
          permissionDenied: _looksLikePermissionError(e),
          cause: e,
        );
      }
    }
    if (video) {
      try {
        final stream = await navigator.mediaDevices.getUserMedia({
          'audio': false,
          'video': {
            'facingMode':
                cameraPosition == PurpleCallioCameraPosition.front ? 'user' : 'environment',
            'width': {'ideal': 1280},
            'height': {'ideal': 720},
            'frameRate': {'ideal': 30},
          },
        });
        final track = stream.getVideoTracks().first;
        videoTrack = _FlutterLocalTrack(stream, track, 'video');
      } catch (e) {
        await audioTrack?.dispose();
        throw RtcMediaException(
          kind: PurpleCallioPermissionKind.camera,
          permissionDenied: _looksLikePermissionError(e),
          cause: e,
        );
      }
    }
    return RtcLocalMedia(audio: audioTrack, video: videoTrack);
  }

  @override
  Future<RtcLocalTrack> getDisplayMedia() async {
    if (!supportsScreenShare) {
      throw const ScreenShareUnavailableError(
          'not supported on this platform by purplecallio_flutter');
    }
    MediaStream stream;
    try {
      stream = await navigator.mediaDevices
          .getDisplayMedia({'video': true, 'audio': false});
    } catch (e) {
      throw ScreenShareUnavailableError('capture declined or failed', e);
    }
    final tracks = stream.getVideoTracks();
    if (tracks.isEmpty) {
      await stream.dispose();
      throw const ScreenShareUnavailableError('no screen track returned');
    }
    return _FlutterLocalTrack(stream, tracks.first, 'video');
  }

  @override
  Future<RtcPeer> createPeer(List<PurpleCallioIceServer> iceServers) async {
    final pc = await createPeerConnection({
      'iceServers': [for (final s in iceServers) s.toJson()],
      'sdpSemantics': 'unified-plan',
    });
    return _FlutterPeer(pc, logger);
  }

  @override
  Future<void> setSpeakerphoneOn(bool on) => Helper.setSpeakerphoneOn(on);
}

class _FlutterLocalTrack implements RtcLocalTrack {
  _FlutterLocalTrack(this.stream, this.track, this.kind) {
    track.onEnded = () {
      final h = _onEnded;
      _onEnded = null;
      if (!_disposed) h?.call();
    };
  }

  final MediaStream stream;
  final MediaStreamTrack track;
  @override
  final String kind;
  bool _disposed = false;
  void Function()? _onEnded;

  @override
  bool get enabled => track.enabled;
  @override
  set enabled(bool value) => track.enabled = value;

  @override
  PurpleCallioVideoTrack? get videoHandle => kind == 'video'
      ? PurpleCallioVideoTrack(id: track.id ?? stream.id, native: stream)
      : null;

  @override
  set onEnded(void Function()? handler) => _onEnded = handler;

  @override
  Future<void> switchCamera() => Helper.switchCamera(track);

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _onEnded = null;
    try {
      await track.stop();
    } catch (_) {}
    try {
      await stream.dispose();
    } catch (_) {}
  }
}

class _FlutterPeer implements RtcPeer {
  _FlutterPeer(this._pc, this._logger) {
    _pc.onIceCandidate = (c) {
      final cand = c.candidate;
      if (cand == null || cand.isEmpty) return;
      _onIceCandidate?.call(RtcIceCandidate(
          candidate: cand, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex));
    };
    _pc.onIceConnectionState = (s) {
      _iceState = _map(s);
      _onIceStateChange?.call(_iceState);
    };
    _pc.onTrack = (event) {
      final kind = event.track.kind ?? 'unknown';
      PurpleCallioVideoTrack? handle;
      if (kind == 'video' && event.streams.isNotEmpty) {
        final stream = event.streams.first;
        handle = PurpleCallioVideoTrack(
            id: event.track.id ?? stream.id, native: stream);
      }
      _onRemoteTrack?.call(RtcRemoteTrack(kind: kind, videoHandle: handle));
    };
  }

  final RTCPeerConnection _pc;
  final PurpleCallioLogger _logger;
  RTCRtpSender? _videoSender;
  RtcIceState _iceState = RtcIceState.newState;
  bool _closed = false;

  void Function(RtcIceCandidate)? _onIceCandidate;
  void Function(RtcIceState)? _onIceStateChange;
  void Function(RtcRemoteTrack)? _onRemoteTrack;

  @override
  set onIceCandidate(void Function(RtcIceCandidate)? h) => _onIceCandidate = h;
  @override
  set onIceStateChange(void Function(RtcIceState)? h) => _onIceStateChange = h;
  @override
  set onRemoteTrack(void Function(RtcRemoteTrack)? h) => _onRemoteTrack = h;

  @override
  RtcIceState get iceState => _iceState;

  static RtcIceState _map(RTCIceConnectionState s) => switch (s) {
        RTCIceConnectionState.RTCIceConnectionStateNew => RtcIceState.newState,
        RTCIceConnectionState.RTCIceConnectionStateChecking =>
          RtcIceState.checking,
        RTCIceConnectionState.RTCIceConnectionStateConnected =>
          RtcIceState.connected,
        RTCIceConnectionState.RTCIceConnectionStateCompleted =>
          RtcIceState.completed,
        RTCIceConnectionState.RTCIceConnectionStateDisconnected =>
          RtcIceState.disconnected,
        RTCIceConnectionState.RTCIceConnectionStateFailed => RtcIceState.failed,
        RTCIceConnectionState.RTCIceConnectionStateClosed => RtcIceState.closed,
        RTCIceConnectionState.RTCIceConnectionStateCount =>
          RtcIceState.newState,
      };

  @override
  Future<void> addLocalTracks(RtcLocalMedia media,
      {required bool videoCall}) async {
    final audio = media.audio;
    if (audio is _FlutterLocalTrack) {
      await _pc.addTrack(audio.track, audio.stream);
    }
    final video = media.video;
    if (video is _FlutterLocalTrack) {
      _videoSender = await _pc.addTrack(video.track, video.stream);
    } else if (videoCall) {
      final transceiver = await _pc.addTransceiver(
        kind: RTCRtpMediaType.RTCRtpMediaTypeVideo,
        init: RTCRtpTransceiverInit(direction: TransceiverDirection.SendRecv),
      );
      _videoSender = transceiver.sender;
    }
  }

  @override
  bool get hasVideoSender => _videoSender != null;

  @override
  Future<RtcSessionDescription> createOffer({bool iceRestart = false}) async {
    if (iceRestart) {
      try {
        await _pc.restartIce();
      } catch (e) {
        _logger.warning('restartIce not available: ${e.runtimeType}');
      }
    }
    final d = await _pc.createOffer({
      if (iceRestart) 'iceRestart': true,
    });
    return RtcSessionDescription(type: d.type ?? 'offer', sdp: d.sdp ?? '');
  }

  @override
  Future<RtcSessionDescription> createAnswer() async {
    final d = await _pc.createAnswer({});
    return RtcSessionDescription(type: d.type ?? 'answer', sdp: d.sdp ?? '');
  }

  @override
  Future<void> setLocalDescription(RtcSessionDescription d) =>
      _pc.setLocalDescription(RTCSessionDescription(d.sdp, d.type));

  @override
  Future<void> setRemoteDescription(RtcSessionDescription d) =>
      _pc.setRemoteDescription(RTCSessionDescription(d.sdp, d.type));

  @override
  Future<void> addIceCandidate(RtcIceCandidate c) => _pc.addCandidate(
      RTCIceCandidate(c.candidate, c.sdpMid, c.sdpMLineIndex));

  @override
  Future<void> replaceVideoTrack(RtcLocalTrack? track) async {
    final sender = _videoSender;
    if (sender == null) return;
    await sender.replaceTrack(track is _FlutterLocalTrack ? track.track : null);
  }

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _pc.onIceCandidate = null;
    _pc.onIceConnectionState = null;
    _pc.onTrack = null;
    _onIceCandidate = null;
    _onIceStateChange = null;
    _onRemoteTrack = null;
    try {
      await _pc.close();
    } catch (_) {}
    try {
      await _pc.dispose();
    } catch (_) {}
  }
}
