import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../logging.dart';
import 'signaling_channel.dart';

/// [SignalingChannel] over `socket_io_client` (Socket.IO v4, websocket
/// transport, default namespace, a dedicated manager per meeting).
class SocketIoSignalingChannel implements SignalingChannel {
  SocketIoSignalingChannel({
    required Uri baseUrl,
    required PurpleCallioLogger logger,
    Duration reconnectionDelay = const Duration(seconds: 1),
    Duration reconnectionDelayMax = const Duration(seconds: 5),
  })  : _logger = logger,
        _socket = io.io(
          baseUrl.toString(),
          io.OptionBuilder()
              .setTransports(['websocket'])
              .disableAutoConnect()
              // One manager per meeting: never multiplex two participants
              // (e.g. caller and receiver in one process) over one socket.
              .enableForceNew()
              .enableReconnection()
              .setReconnectionDelay(reconnectionDelay.inMilliseconds)
              .setReconnectionDelayMax(reconnectionDelayMax.inMilliseconds)
              .build(),
        ) {
    _socket.onConnect((_) {
      if (_disposed) return;
      _logger.debug('socket connected');
      _onConnect?.call();
    });
    _socket.onDisconnect((reason) {
      if (_disposed) return;
      _logger.info('socket disconnected: $reason');
      _onDisconnect?.call(reason?.toString() ?? 'unknown');
    });
    _socket.onConnectError((err) {
      if (_disposed) return;
      _logger.warning('socket connect error: ${err.runtimeType}');
      _onConnectError?.call(err);
    });
  }

  final PurpleCallioLogger _logger;
  final io.Socket _socket;
  bool _disposed = false;

  void Function()? _onConnect;
  void Function(String reason)? _onDisconnect;
  void Function(Object? error)? _onConnectError;

  @override
  set onConnect(void Function()? handler) => _onConnect = handler;
  @override
  set onDisconnect(void Function(String reason)? handler) =>
      _onDisconnect = handler;
  @override
  set onConnectError(void Function(Object? error)? handler) =>
      _onConnectError = handler;

  @override
  bool get isConnected => !_disposed && _socket.connected;

  @override
  void connect() {
    if (_disposed) return;
    _socket.connect();
  }

  /// socket_io_client hands multi-argument payloads over as a List.
  static Object? _first(Object? data) =>
      data is List && data.length == 1 ? data.first : data;

  @override
  void on(String event, SignalingHandler handler) {
    _socket.on(event, (data) {
      if (_disposed) return;
      handler(_first(data));
    });
  }

  @override
  void emit(String event, [Object? data]) {
    if (_disposed) return;
    _logger.debug('emit $event');
    if (data == null) {
      _socket.emit(event);
    } else {
      _socket.emit(event, data);
    }
  }

  @override
  Future<Object?> emitWithAck(
    String event,
    Object? data, {
    Duration timeout = const Duration(seconds: 10),
  }) {
    if (_disposed) {
      return Future.error(StateError('signaling channel disposed'));
    }
    final completer = Completer<Object?>();
    final timer = Timer(timeout, () {
      if (!completer.isCompleted) {
        completer.completeError(SignalingAckTimeout(event));
      }
    });
    _logger.debug('emit $event (ack)');
    _socket.emitWithAck(event, data, ack: (response) {
      timer.cancel();
      if (!completer.isCompleted) completer.complete(_first(response));
    });
    return completer.future;
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _onConnect = null;
    _onDisconnect = null;
    _onConnectError = null;
    try {
      _socket.io.reconnection = false; // no reconnects after dispose
    } catch (_) {}
    _socket.clearListeners();
    _socket.disconnect();
    _socket.dispose();
    try {
      _socket.io.close();
    } catch (_) {}
  }
}
