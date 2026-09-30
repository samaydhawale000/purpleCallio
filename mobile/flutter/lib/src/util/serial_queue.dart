import 'dart:async';

/// Runs async tasks strictly one after another, in submission order.
///
/// Used by the meeting engine for everything that touches the peer connection
/// (offer/answer/candidates/ICE restart/track replacement), so two signaling
/// messages can never interleave across an `await`.
class SerialQueue {
  Future<void> _tail = Future<void>.value();
  bool _closed = false;

  bool get isClosed => _closed;

  /// Enqueues [task]. The returned future completes with its result/error.
  /// After [close], tasks are dropped and complete with `null`-like no-ops.
  Future<T?> run<T>(Future<T> Function() task) {
    if (_closed) return Future<T?>.value(null);
    final completer = Completer<T?>();
    _tail = _tail.then((_) async {
      if (_closed) {
        completer.complete(null);
        return;
      }
      try {
        completer.complete(await task());
      } catch (e, st) {
        completer.completeError(e, st);
      }
    });
    return completer.future;
  }

  void close() => _closed = true;
}
