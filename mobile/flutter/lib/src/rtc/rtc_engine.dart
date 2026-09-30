import 'dart:async';

import '../errors.dart';
import '../models.dart';

/// SDP offer/answer.
class RtcSessionDescription {
  const RtcSessionDescription({required this.type, required this.sdp});
  final String type;
  final String sdp;

  Map<String, dynamic> toJson() => {'type': type, 'sdp': sdp};

  static RtcSessionDescription? fromJson(Object? json) {
    if (json is! Map) return null;
    final type = json['type'];
    final sdp = json['sdp'];
    if (type is! String || sdp is! String) return null;
    return RtcSessionDescription(type: type, sdp: sdp);
  }
}

/// ICE candidate in the `RTCIceCandidateInit` wire shape.
class RtcIceCandidate {
  const RtcIceCandidate({
    required this.candidate,
    this.sdpMid,
    this.sdpMLineIndex,
  });
  final String candidate;
  final String? sdpMid;
  final int? sdpMLineIndex;

  Map<String, dynamic> toJson() => {
        'candidate': candidate,
        'sdpMid': sdpMid,
        'sdpMLineIndex': sdpMLineIndex,
      };

  static RtcIceCandidate? fromJson(Object? json) {
    if (json is! Map) return null;
    final c = json['candidate'];
    if (c is! String) return null;
    final idx = json['sdpMLineIndex'];
    return RtcIceCandidate(
      candidate: c,
      sdpMid: json['sdpMid'] is String ? json['sdpMid'] as String : null,
      sdpMLineIndex: idx is int ? idx : (idx is num ? idx.toInt() : null),
    );
  }
}

/// ICE connection states (subset of `RTCIceConnectionState` we act on).
enum RtcIceState {
  newState,
  checking,
  connected,
  completed,
  disconnected,
  failed,
  closed;

  /// The W3C string, for telemetry.
  String get wire => this == RtcIceState.newState ? 'new' : name;
}

/// Why local media could not be captured.
class RtcMediaException implements Exception {
  const RtcMediaException({
    required this.kind,
    required this.permissionDenied,
    this.cause,
  });
  final PurpleCallioPermissionKind kind;
  final bool permissionDenied;
  final Object? cause;

  PurpleCallioError toError() => permissionDenied
      ? PermissionDeniedError(kind, cause)
      : MediaInitializationFailedError(
          'Could not capture ${kind.name}', cause);

  @override
  String toString() =>
      'RtcMediaException(${kind.name}, permissionDenied=$permissionDenied)';
}

/// A local capture track (camera, microphone, or screen).
abstract interface class RtcLocalTrack {
  /// `audio` or `video`.
  String get kind;
  bool get enabled;
  set enabled(bool value);

  /// Renderable handle (video tracks only).
  PurpleCallioVideoTrack? get videoHandle;

  /// Called once if capture ends on its own (e.g. user stops screen capture
  /// from system UI).
  set onEnded(void Function()? handler);

  /// Switches front/back camera. Camera tracks only.
  Future<void> switchCamera();

  /// Stops capture and releases the track (and its stream). Idempotent.
  Future<void> dispose();
}

/// Local camera/mic capture result.
class RtcLocalMedia {
  RtcLocalMedia({this.audio, this.video});
  RtcLocalTrack? audio;
  RtcLocalTrack? video;
}

/// Remote track arrival.
class RtcRemoteTrack {
  const RtcRemoteTrack({required this.kind, this.videoHandle});
  final String kind;
  final PurpleCallioVideoTrack? videoHandle;
}

/// One peer connection.
abstract interface class RtcPeer {
  set onIceCandidate(void Function(RtcIceCandidate candidate)? handler);
  set onIceStateChange(void Function(RtcIceState state)? handler);
  set onRemoteTrack(void Function(RtcRemoteTrack track)? handler);

  RtcIceState get iceState;

  /// Adds local tracks (`addTrack`), keeping the video sender for
  /// [replaceVideoTrack]. For a video call without a camera track (joined
  /// with camera off, or capture failed) it adds a `sendrecv` video
  /// transceiver with no track, so remote video is still received and a
  /// camera track can be attached later with no renegotiation.
  Future<void> addLocalTracks(RtcLocalMedia media, {required bool videoCall});

  /// Whether a video sender exists (needed for screen share).
  bool get hasVideoSender;

  Future<RtcSessionDescription> createOffer({bool iceRestart = false});
  Future<RtcSessionDescription> createAnswer();
  Future<void> setLocalDescription(RtcSessionDescription description);
  Future<void> setRemoteDescription(RtcSessionDescription description);
  Future<void> addIceCandidate(RtcIceCandidate candidate);

  /// `RTCRtpSender.replaceTrack` on the video sender. No renegotiation.
  Future<void> replaceVideoTrack(RtcLocalTrack? track);

  /// Closes and releases the connection. Idempotent.
  Future<void> close();
}

/// Platform WebRTC seam. The default is `FlutterWebrtcEngine`.
abstract interface class RtcEngine {
  /// Captures local media. Throws [RtcMediaException].
  Future<RtcLocalMedia> getUserMedia({
    required bool audio,
    required bool video,
    required PurpleCallioCameraPosition cameraPosition,
  });

  /// Captures the screen. Throws [ScreenShareUnavailableError] where
  /// unsupported, and [RtcMediaException] on denial.
  Future<RtcLocalTrack> getDisplayMedia();

  /// Whether [getDisplayMedia] can work on this platform at all.
  bool get supportsScreenShare;

  Future<RtcPeer> createPeer(List<PurpleCallioIceServer> iceServers);

  /// Routes call audio to the loudspeaker (`true`) or earpiece (`false`).
  Future<void> setSpeakerphoneOn(bool on);
}
