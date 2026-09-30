import 'dart:async';

import 'package:http/http.dart' as http;
import 'package:meta/meta.dart';

import 'api/purplecallio_api.dart';
import 'errors.dart';
import 'logging.dart';
import 'meeting.dart';
import 'models.dart';
import 'rtc/flutter_webrtc_engine.dart';
import 'rtc/rtc_engine.dart';
import 'signaling/signaling_channel.dart';
import 'signaling/socket_io_signaling_channel.dart';

/// Entry point of the SDK.
///
/// ```dart
/// final client = PurpleCallioClient();
/// final token = await myBackend.fetchParticipantToken(); // never an API key
/// final meeting = await client.joinMeeting(token);
/// ```
class PurpleCallioClient {
  PurpleCallioClient({
    String baseUrl = defaultBaseUrl,
    PurpleCallioLogLevel logLevel = PurpleCallioLogLevel.none,
    PurpleCallioLogSink? logSink,
    List<PurpleCallioIceServer> iceServers = const [],
    this.overrideIceServers = false,
    http.Client? httpClient,
    @visibleForTesting SignalingChannelFactory? signalingFactory,
    @visibleForTesting PurpleCallioApiFactory? apiFactory,
    @visibleForTesting RtcEngine? rtcEngine,
    @visibleForTesting PurpleCallioTimings timings = const PurpleCallioTimings(),
  })  : baseUrl = _parseBaseUrl(baseUrl),
        iceServers = List.unmodifiable(iceServers),
        logger = PurpleCallioLogger(level: logLevel, sink: logSink),
        _httpClient = httpClient,
        _signalingFactory = signalingFactory,
        _apiFactory = apiFactory,
        _rtcEngine = rtcEngine,
        _timings = timings;

  static const String defaultBaseUrl = 'https://api.purplecallio.com';

  /// PurpleCallio API origin, used for REST and Socket.IO.
  final Uri baseUrl;

  /// Extra STUN/TURN servers (merged with `/turn/credentials`, de-duplicated).
  final List<PurpleCallioIceServer> iceServers;

  /// Use only [iceServers], ignoring the backend's list.
  final bool overrideIceServers;

  final PurpleCallioLogger logger;

  final http.Client? _httpClient;
  final SignalingChannelFactory? _signalingFactory;
  final PurpleCallioApiFactory? _apiFactory;
  final RtcEngine? _rtcEngine;
  final PurpleCallioTimings _timings;
  late final RtcEngine _rtc = _rtcEngine ?? FlutterWebrtcEngine(logger: logger);
  final Set<PurpleCallioMeeting> _meetings = {};
  bool _disposed = false;

  static Uri _parseBaseUrl(String value) {
    final uri = Uri.tryParse(value.trim());
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      throw ArgumentError.value(value, 'baseUrl', 'must be an absolute URL');
    }
    return uri;
  }

  /// Joins the call identified by a **participant token** (from your
  /// backend's `POST /calls` response, `participants[].token`).
  ///
  /// Resolves once authenticated and call details are loaded, normally in
  /// `ringing`. (A caller whose call is already `ACCEPTED`, e.g. after an app
  /// restart, resolves in `joining`.) Throws a [PurpleCallioError]:
  /// [InvalidTokenError], [MeetingEndedError] when the call is already over,
  /// [ConnectionFailedError], [PermissionDeniedError] (caller media), ...
  Future<PurpleCallioMeeting> joinMeeting(
    String token, {
    PurpleCallioJoinOptions options = const PurpleCallioJoinOptions(),
  }) async {
    if (_disposed) {
      throw const InvalidStateError('PurpleCallioClient was disposed');
    }
    if (token.trim().isEmpty) throw const InvalidTokenError('Empty token');

    final signaling = (_signalingFactory ??
        (url, log) =>
            SocketIoSignalingChannel(baseUrl: url, logger: log))(baseUrl, logger);
    final api = (_apiFactory ??
        (url, t, log) => HttpPurpleCallioApi(
            baseUrl: url, token: t, logger: log, client: _httpClient))(
      baseUrl,
      token,
      logger,
    );
    final meeting = PurpleCallioMeeting.internal(
      token: token,
      signaling: signaling,
      api: api,
      rtc: _rtc,
      logger: logger,
      options: options,
      configuredIceServers: iceServers,
      overrideIceServers: overrideIceServers,
      timings: _timings,
      onClosed: _meetings.remove,
    );
    _meetings.add(meeting);
    await meeting.start();
    return meeting;
  }

  /// Meetings created by this client that have not ended yet.
  List<PurpleCallioMeeting> get activeMeetings => List.unmodifiable(_meetings);

  /// Disposes every meeting created by this client (no signaling). Idempotent.
  Future<void> dispose() async {
    _disposed = true;
    await Future.wait([for (final m in List.of(_meetings)) m.dispose()]);
    _meetings.clear();
  }
}
