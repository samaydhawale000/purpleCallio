import 'models.dart';

/// Which device permission was denied.
enum PurpleCallioPermissionKind { camera, microphone, screen }

/// Every error the SDK surfaces. Raw platform/network errors are only ever
/// attached as [cause].
///
/// ```dart
/// try {
///   await client.joinMeeting(token);
/// } on PurpleCallioError catch (e) {
///   switch (e) {
///     case InvalidTokenError():
///       // ask your backend for a fresh token
///     case MeetingEndedError(:final reason):
///       // the call is already over
///     default:
///       // ...
///   }
/// }
/// ```
sealed class PurpleCallioError implements Exception {
  const PurpleCallioError(this.message, [this.cause]);

  /// Human-readable description. Never contains tokens or credentials.
  final String message;

  /// The underlying platform/network error, if any.
  final Object? cause;

  /// Short machine-friendly code, e.g. `invalidToken`.
  String get code;

  @override
  String toString() => 'PurpleCallioError.$code: $message'
      '${cause != null ? ' (cause: ${cause.runtimeType})' : ''}';
}

/// The participant token was rejected (invalid or expired).
final class InvalidTokenError extends PurpleCallioError {
  const InvalidTokenError([String message = 'Participant token rejected'])
      : super(message);
  @override
  String get code => 'invalidToken';
}

/// Authentication could not be completed (e.g. no ack from the server).
final class AuthenticationFailedError extends PurpleCallioError {
  const AuthenticationFailedError(super.message, [super.cause]);
  @override
  String get code => 'authenticationFailed';
}

/// The signaling connection could not be established.
final class ConnectionFailedError extends PurpleCallioError {
  const ConnectionFailedError(super.message, [super.cause]);
  @override
  String get code => 'connectionFailed';
}

/// A REST or socket signaling operation failed.
final class SignalingFailedError extends PurpleCallioError {
  const SignalingFailedError(super.message, [super.cause, this.statusCode]);

  /// HTTP status code for REST failures.
  final int? statusCode;
  @override
  String get code => 'signalingFailed';
}

/// A WebRTC operation failed, or ICE did not recover within the watchdog.
final class WebrtcFailedError extends PurpleCallioError {
  const WebrtcFailedError(super.message, [super.cause]);
  @override
  String get code => 'webrtcFailed';
}

/// The OS/user denied a device permission.
final class PermissionDeniedError extends PurpleCallioError {
  PermissionDeniedError(this.kind, [Object? cause])
      : super('Permission denied: ${kind == PurpleCallioPermissionKind.screen ? 'screen capture' : kind.name}',
            cause);
  final PurpleCallioPermissionKind kind;
  @override
  String get code => 'permissionDenied';
}

/// Capturing local media failed for a reason other than permissions.
final class MediaInitializationFailedError extends PurpleCallioError {
  const MediaInitializationFailedError(super.message, [super.cause]);
  @override
  String get code => 'mediaInitializationFailed';
}

/// Screen sharing is not available (platform, audio call, no video sender,
/// or the user declined consent).
final class ScreenShareUnavailableError extends PurpleCallioError {
  const ScreenShareUnavailableError(this.reason, [Object? cause])
      : super('Screen share unavailable: $reason', cause);
  final String reason;
  @override
  String get code => 'screenShareUnavailable';
}

/// The call is already over.
final class MeetingEndedError extends PurpleCallioError {
  MeetingEndedError(this.reason) : super('Meeting ended (${reason.name})');
  final PurpleCallioDisconnectReason reason;
  @override
  String get code => 'meetingEnded';
}

/// The operation is not valid in the meeting's current state/role/call type.
final class InvalidStateError extends PurpleCallioError {
  const InvalidStateError(super.message);
  @override
  String get code => 'invalidState';
}
