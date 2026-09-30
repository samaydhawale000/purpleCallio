import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../errors.dart';
import '../logging.dart';
import '../models.dart';

/// REST calls the SDK makes with the participant token.
///
/// Internal seam: the default is [HttpPurpleCallioApi]; tests inject fakes.
abstract interface class PurpleCallioApi {
  Future<List<PurpleCallioIceServer>> fetchIceServers();
  Future<PurpleCallioCallDetails> getCallDetails(String callId);
  Future<void> accept(String callId);
  Future<void> reject(String callId);
  Future<void> cancel(String callId);
  Future<void> join(String callId);
  Future<void> leave(String callId);
  Future<void> end(String callId);

  /// Optional telemetry (`outcome`: `SUCCESS` | `FAILED`).
  Future<void> reportIceOutcome(
    String callId, {
    required String outcome,
    required String iceConnectionState,
    String? connectionState,
  });

  /// Releases resources (e.g. an owned HTTP client).
  void close();
}

/// Builds an API bound to one participant token.
typedef PurpleCallioApiFactory = PurpleCallioApi Function(
  Uri baseUrl,
  String token,
  PurpleCallioLogger logger,
);

/// `package:http` implementation. The token is only placed in the
/// `Authorization: Bearer` header and never logged.
class HttpPurpleCallioApi implements PurpleCallioApi {
  HttpPurpleCallioApi({
    required this.baseUrl,
    required String token,
    required this.logger,
    http.Client? client,
    this.timeout = const Duration(seconds: 15),
  })  : _token = token,
        _client = client ?? http.Client(),
        _ownsClient = client == null;

  final Uri baseUrl;
  final String _token;
  final PurpleCallioLogger logger;
  final Duration timeout;
  final http.Client _client;
  final bool _ownsClient;

  Uri _uri(String path) {
    final base = baseUrl.toString().replaceFirst(RegExp(r'/+$'), '');
    return Uri.parse('$base$path');
  }

  Map<String, String> get _headers => {
        'Authorization': 'Bearer $_token',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };

  Future<Object?> _send(String method, String path, [Object? body]) async {
    final uri = _uri(path);
    logger.debug('REST $method $path');
    http.Response res;
    try {
      final req = http.Request(method, uri)..headers.addAll(_headers);
      if (body != null) req.body = jsonEncode(body);
      final streamed = await _client.send(req).timeout(timeout);
      res = await http.Response.fromStream(streamed).timeout(timeout);
    } on TimeoutException catch (e) {
      throw SignalingFailedError('$method $path timed out', e);
    } catch (e) {
      throw SignalingFailedError('$method $path failed', e);
    }
    if (res.statusCode == 401) {
      throw const InvalidTokenError();
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      logger.warning('REST $method $path -> ${res.statusCode}');
      throw SignalingFailedError(
        '$method $path returned ${res.statusCode}',
        _safeServerMessage(res.body),
        res.statusCode,
      );
    }
    if (res.body.isEmpty) return null;
    try {
      return jsonDecode(res.body);
    } catch (_) {
      return null;
    }
  }

  static String? _safeServerMessage(String body) {
    try {
      final j = jsonDecode(body);
      if (j is Map && j['message'] != null) {
        return PurpleCallioLogger.redact(j['message'].toString());
      }
    } catch (_) {}
    return null;
  }

  @override
  Future<List<PurpleCallioIceServer>> fetchIceServers() async {
    final json = await _send('GET', '/turn/credentials');
    if (json is! Map || json['iceServers'] is! List) {
      throw const SignalingFailedError('turn/credentials: bad response');
    }
    return (json['iceServers'] as List)
        .map(PurpleCallioIceServer.fromJson)
        .whereType<PurpleCallioIceServer>()
        .toList();
  }

  @override
  Future<PurpleCallioCallDetails> getCallDetails(String callId) async {
    final json = await _send('GET', '/calls/${Uri.encodeComponent(callId)}/details');
    if (json is! Map<String, dynamic>) {
      throw const SignalingFailedError('call details: bad response');
    }
    try {
      return PurpleCallioCallDetails.fromJson(json);
    } on FormatException catch (e) {
      throw SignalingFailedError('call details: ${e.message}', e);
    }
  }

  Future<void> _post(String callId, String action, [Object? body]) =>
      _send('POST', '/calls/${Uri.encodeComponent(callId)}/$action', body ?? const {});

  @override
  Future<void> accept(String callId) => _post(callId, 'accept');
  @override
  Future<void> reject(String callId) => _post(callId, 'reject');
  @override
  Future<void> cancel(String callId) => _post(callId, 'cancel');
  @override
  Future<void> join(String callId) => _post(callId, 'join');
  @override
  Future<void> leave(String callId) => _post(callId, 'leave');
  @override
  Future<void> end(String callId) => _post(callId, 'end');

  @override
  Future<void> reportIceOutcome(
    String callId, {
    required String outcome,
    required String iceConnectionState,
    String? connectionState,
  }) =>
      _post(callId, 'webrtc-ice', {
        'outcome': outcome,
        'iceConnectionState': iceConnectionState,
        if (connectionState != null) 'connectionState': connectionState,
      });

  @override
  void close() {
    if (_ownsClient) _client.close();
  }
}
