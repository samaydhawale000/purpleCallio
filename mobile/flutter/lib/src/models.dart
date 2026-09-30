import 'package:flutter/foundation.dart';
import 'package:meta/meta.dart';

/// Role of a participant in a 1:1 PurpleCallio call.
enum PurpleCallioRole {
  caller,
  receiver;

  /// Parses the server's `CALLER` / `RECEIVER` strings.
  static PurpleCallioRole? fromWire(Object? value) {
    switch (value is String ? value.toUpperCase() : null) {
      case 'CALLER':
        return PurpleCallioRole.caller;
      case 'RECEIVER':
        return PurpleCallioRole.receiver;
    }
    return null;
  }

  PurpleCallioRole get other => this == PurpleCallioRole.caller
      ? PurpleCallioRole.receiver
      : PurpleCallioRole.caller;
}

/// Media type of the call, fixed when your backend created it.
enum PurpleCallioCallType {
  audio,
  video;

  static PurpleCallioCallType? fromWire(Object? value) {
    switch (value is String ? value.toUpperCase() : null) {
      case 'AUDIO':
        return PurpleCallioCallType.audio;
      case 'VIDEO':
        return PurpleCallioCallType.video;
    }
    return null;
  }
}

/// Which camera is capturing.
enum PurpleCallioCameraPosition { front, back }

/// Unified client state (see PROTOCOL.md "Unified client state model").
///
/// `disconnected` and `failed` are terminal.
enum PurpleCallioConnectionState {
  idle,
  connecting,
  ringing,
  joining,
  connected,
  reconnecting,
  disconnected,
  failed;

  bool get isTerminal =>
      this == PurpleCallioConnectionState.disconnected ||
      this == PurpleCallioConnectionState.failed;
}

/// Why a meeting reached [PurpleCallioConnectionState.disconnected].
enum PurpleCallioDisconnectReason {
  /// This device left (hang up, cancel, reject, or [PurpleCallioMeeting.dispose]).
  left,

  /// The other participant hung up.
  remoteEnded,

  /// The receiver declined (seen by the caller) or this receiver rejected.
  rejected,

  /// The caller cancelled while ringing.
  cancelled,

  /// Nobody answered before the server's ring timeout.
  missed,

  /// The receiver was busy.
  busy,

  /// The same participant token authenticated from another device/socket.
  sessionReplaced,

  /// The server expired the call (for example a time-limited playground call).
  expired,
}

/// Server-side call status values from `GET /calls/:id/details`.
enum PurpleCallioCallStatus {
  ringing,
  accepted,
  ended,
  missed,
  rejected,
  cancelled,
  busy,
  unknown;

  static PurpleCallioCallStatus fromWire(Object? value) {
    switch (value is String ? value.toUpperCase() : null) {
      case 'RINGING':
        return PurpleCallioCallStatus.ringing;
      case 'ACCEPTED':
        return PurpleCallioCallStatus.accepted;
      case 'ENDED':
        return PurpleCallioCallStatus.ended;
      case 'MISSED':
        return PurpleCallioCallStatus.missed;
      case 'REJECTED':
        return PurpleCallioCallStatus.rejected;
      case 'CANCELLED':
        return PurpleCallioCallStatus.cancelled;
      case 'BUSY':
        return PurpleCallioCallStatus.busy;
    }
    return PurpleCallioCallStatus.unknown;
  }

  /// The disconnect reason for a terminal status, or `null` if the call is
  /// still live (ringing/accepted/unknown).
  PurpleCallioDisconnectReason? get terminalReason {
    switch (this) {
      case PurpleCallioCallStatus.ended:
        return PurpleCallioDisconnectReason.remoteEnded;
      case PurpleCallioCallStatus.missed:
        return PurpleCallioDisconnectReason.missed;
      case PurpleCallioCallStatus.rejected:
        return PurpleCallioDisconnectReason.rejected;
      case PurpleCallioCallStatus.cancelled:
        return PurpleCallioDisconnectReason.cancelled;
      case PurpleCallioCallStatus.busy:
        return PurpleCallioDisconnectReason.busy;
      case PurpleCallioCallStatus.ringing:
      case PurpleCallioCallStatus.accepted:
      case PurpleCallioCallStatus.unknown:
        return null;
    }
  }
}

/// Options for [PurpleCallioClient.joinMeeting].
@immutable
class PurpleCallioJoinOptions {
  const PurpleCallioJoinOptions({
    this.microphoneEnabled = true,
    this.cameraEnabled = true,
    this.cameraPosition = PurpleCallioCameraPosition.front,
  });

  /// Start with the microphone on. When `false`, the SDK still captures the
  /// microphone (so it can be unmuted without renegotiation) but sends
  /// silence, and emits `microphone.disabled` once after joining the room.
  final bool microphoneEnabled;

  /// Start with the camera on. Ignored for audio calls.
  final bool cameraEnabled;

  /// Initial camera.
  final PurpleCallioCameraPosition cameraPosition;
}

/// A handle to a renderable video source (local camera, local screen, or
/// remote video). Pass it to `PurpleCallioVideoView` via a participant.
///
/// The wrapped platform object is an implementation detail of the RTC layer
/// (for the default engine, a `flutter_webrtc` `MediaStream`).
@immutable
class PurpleCallioVideoTrack {
  @internal
  const PurpleCallioVideoTrack({required this.id, required this.native});

  /// Stable id of the underlying track/stream.
  final String id;

  /// The platform object (a `flutter_webrtc` `MediaStream` for the default
  /// engine). Exposed for advanced rendering; do not stop or dispose it
  /// yourself, the meeting owns it.
  final Object native;

  @override
  bool operator ==(Object other) =>
      other is PurpleCallioVideoTrack &&
      other.id == id &&
      identical(other.native, native);

  @override
  int get hashCode => Object.hash(id, identityHashCode(native));

  @override
  String toString() => 'PurpleCallioVideoTrack($id)';
}

/// A participant (local or remote). Immutable snapshot; the meeting publishes
/// a new instance on every change.
@immutable
class PurpleCallioParticipant {
  const PurpleCallioParticipant({
    required this.participantId,
    required this.role,
    required this.isLocal,
    this.displayName,
    this.avatarUrl,
    this.isMicrophoneEnabled = true,
    this.isCameraEnabled = false,
    this.isScreenSharing = false,
    this.videoTrack,
  });

  final String participantId;
  final PurpleCallioRole role;
  final bool isLocal;

  /// From `/calls/:id/details` (`callerName` / `receiverName`). Never invented.
  final String? displayName;

  /// From `/calls/:id/details` (`callerAvatar` / `receiverAvatar`).
  final String? avatarUrl;

  final bool isMicrophoneEnabled;
  final bool isCameraEnabled;
  final bool isScreenSharing;

  /// Video to render, if any. For the local participant this is the camera
  /// (or the screen while sharing); for the remote participant it is present
  /// once remote media arrives. A present track may still be black when
  /// [isCameraEnabled] is `false`; `PurpleCallioVideoView` shows a
  /// placeholder in that case.
  final PurpleCallioVideoTrack? videoTrack;

  /// Whether a video view should show live video rather than a placeholder.
  bool get hasVisibleVideo =>
      videoTrack != null && (isCameraEnabled || isScreenSharing);

  PurpleCallioParticipant copyWith({
    String? displayName,
    String? avatarUrl,
    bool? isMicrophoneEnabled,
    bool? isCameraEnabled,
    bool? isScreenSharing,
    PurpleCallioVideoTrack? videoTrack,
    bool clearVideoTrack = false,
  }) {
    return PurpleCallioParticipant(
      participantId: participantId,
      role: role,
      isLocal: isLocal,
      displayName: displayName ?? this.displayName,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      isMicrophoneEnabled: isMicrophoneEnabled ?? this.isMicrophoneEnabled,
      isCameraEnabled: isCameraEnabled ?? this.isCameraEnabled,
      isScreenSharing: isScreenSharing ?? this.isScreenSharing,
      videoTrack: clearVideoTrack ? null : (videoTrack ?? this.videoTrack),
    );
  }

  @override
  bool operator ==(Object other) =>
      other is PurpleCallioParticipant &&
      other.participantId == participantId &&
      other.role == role &&
      other.isLocal == isLocal &&
      other.displayName == displayName &&
      other.avatarUrl == avatarUrl &&
      other.isMicrophoneEnabled == isMicrophoneEnabled &&
      other.isCameraEnabled == isCameraEnabled &&
      other.isScreenSharing == isScreenSharing &&
      other.videoTrack == videoTrack;

  @override
  int get hashCode => Object.hash(
        participantId,
        role,
        isLocal,
        displayName,
        avatarUrl,
        isMicrophoneEnabled,
        isCameraEnabled,
        isScreenSharing,
        videoTrack,
      );

  @override
  String toString() => 'PurpleCallioParticipant($participantId, ${role.name}, '
      '${isLocal ? 'local' : 'remote'}, mic=$isMicrophoneEnabled, '
      'camera=$isCameraEnabled, screen=$isScreenSharing, '
      'video=${videoTrack != null})';
}

/// The `incoming-call` payload, for a receiver in `ringing`.
@immutable
class PurpleCallioIncomingCall {
  const PurpleCallioIncomingCall({
    required this.callId,
    required this.callerId,
    required this.callType,
    this.callerName,
    this.callerAvatar,
  });

  final String callId;
  final String callerId;
  final String? callerName;
  final String? callerAvatar;
  final PurpleCallioCallType callType;

  static PurpleCallioIncomingCall? fromJson(Object? json) {
    if (json is! Map) return null;
    final callId = json['callId'];
    final callerId = json['callerId'];
    if (callId is! String || callerId is! String) return null;
    return PurpleCallioIncomingCall(
      callId: callId,
      callerId: callerId,
      callerName: _optString(json['callerName']),
      callerAvatar: _optString(json['callerAvatar']),
      callType: PurpleCallioCallType.fromWire(json['type']) ??
          PurpleCallioCallType.video,
    );
  }
}

/// Parsed `GET /calls/:callId/details`. The token the server echoes back is
/// deliberately not retained.
@immutable
class PurpleCallioCallDetails {
  const PurpleCallioCallDetails({
    required this.callId,
    required this.callType,
    required this.status,
    required this.callerId,
    required this.receiverId,
    required this.participantId,
    this.callerName,
    this.callerAvatar,
    this.receiverName,
    this.receiverAvatar,
    this.expiresAt,
  });

  final String callId;
  final PurpleCallioCallType callType;
  final PurpleCallioCallStatus status;
  final String callerId;
  final String receiverId;
  final String? callerName;
  final String? callerAvatar;
  final String? receiverName;
  final String? receiverAvatar;
  final String participantId;
  final DateTime? expiresAt;

  static PurpleCallioCallDetails fromJson(Map<String, dynamic> json) {
    String req(String key) {
      final v = json[key];
      if (v is! String) {
        throw FormatException('call details: missing "$key"');
      }
      return v;
    }

    final type = PurpleCallioCallType.fromWire(json['type']);
    if (type == null) {
      throw const FormatException('call details: missing or unknown "type"');
    }
    final expires = json['expiresAt'];
    return PurpleCallioCallDetails(
      callId: req('callId'),
      callType: type,
      status: PurpleCallioCallStatus.fromWire(json['status']),
      callerId: req('callerId'),
      receiverId: req('receiverId'),
      participantId: req('participantId'),
      callerName: _optString(json['callerName']),
      callerAvatar: _optString(json['callerAvatar']),
      receiverName: _optString(json['receiverName']),
      receiverAvatar: _optString(json['receiverAvatar']),
      expiresAt: expires is String ? DateTime.tryParse(expires) : null,
    );
  }
}

/// A STUN/TURN server.
@immutable
class PurpleCallioIceServer {
  const PurpleCallioIceServer({
    required this.urls,
    this.username,
    this.credential,
  });

  final List<String> urls;
  final String? username;
  final String? credential;

  /// Parses `{ urls: string | string[], username?, credential? }`.
  static PurpleCallioIceServer? fromJson(Object? json) {
    if (json is! Map) return null;
    final raw = json['urls'] ?? json['url'];
    final urls = <String>[
      if (raw is String) raw,
      if (raw is List) ...raw.whereType<String>(),
    ].where((u) => u.isNotEmpty).toList();
    if (urls.isEmpty) return null;
    return PurpleCallioIceServer(
      urls: urls,
      username: _optString(json['username']),
      credential: _optString(json['credential']),
    );
  }

  /// The map shape `flutter_webrtc` / WebRTC expects.
  Map<String, dynamic> toJson() => {
        'urls': urls,
        if (username != null) 'username': username,
        if (credential != null) 'credential': credential,
      };

  @override
  bool operator ==(Object other) =>
      other is PurpleCallioIceServer &&
      listEquals(other.urls, urls) &&
      other.username == username &&
      other.credential == credential;

  @override
  int get hashCode => Object.hash(Object.hashAll(urls), username, credential);

  /// Never prints the credential.
  @override
  String toString() => 'PurpleCallioIceServer(${urls.join(', ')}'
      '${credential != null ? ', credential=<redacted>' : ''})';
}

String? _optString(Object? v) => v is String && v.isNotEmpty ? v : null;
