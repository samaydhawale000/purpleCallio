import 'dart:async';

import '../logging.dart';

/// Thrown by [SignalingChannel.emitWithAck] when no ack arrives in time.
class SignalingAckTimeout implements Exception {
  const SignalingAckTimeout(this.event);
  final String event;
  @override
  String toString() => 'SignalingAckTimeout($event)';
}

/// Handler for a server event. [data] is the first payload argument (or
/// `null` when the event carries none, e.g. `call-ended`).
typedef SignalingHandler = void Function(Object? data);

/// Transport-level signaling seam (Socket.IO in production, fakes in tests).
///
/// The meeting engine registers its handlers once, before [connect].
abstract interface class SignalingChannel {
  /// Whether the transport is currently connected.
  bool get isConnected;

  /// Starts connecting. [onConnect] fires on every successful connect,
  /// including automatic reconnects.
  void connect();

  /// Fires on every connect (initial and reconnect).
  set onConnect(void Function()? handler);

  /// Fires when the transport drops. [reason] is transport-specific
  /// (Socket.IO: `io server disconnect`, `transport close`, ...).
  set onDisconnect(void Function(String reason)? handler);

  /// Fires when a connection attempt fails.
  set onConnectError(void Function(Object? error)? handler);

  /// Registers a handler for a server event.
  void on(String event, SignalingHandler handler);

  /// Fire-and-forget emit. A `null` [data] sends the event with no payload.
  void emit(String event, [Object? data]);

  /// Emits and waits for the server's ack. Throws [SignalingAckTimeout].
  Future<Object?> emitWithAck(
    String event,
    Object? data, {
    Duration timeout = const Duration(seconds: 10),
  });

  /// Disconnects and releases the transport. No auto-reconnect afterwards.
  /// Removes every handler. Idempotent.
  void dispose();
}

/// Builds a channel for a base URL.
typedef SignalingChannelFactory = SignalingChannel Function(
  Uri baseUrl,
  PurpleCallioLogger logger,
);
