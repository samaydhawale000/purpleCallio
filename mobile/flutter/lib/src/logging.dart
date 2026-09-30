import 'dart:developer' as developer;

/// Log verbosity. Default is [none].
enum PurpleCallioLogLevel { none, error, warning, info, debug }

/// A log sink. Receives already-redacted messages.
typedef PurpleCallioLogSink = void Function(
  PurpleCallioLogLevel level,
  String message,
);

/// Internal logger. Every message goes through [redact] before reaching the
/// sink, so tokens, bearer headers, TURN credentials and SDP ICE passwords are
/// never emitted even if a caller accidentally interpolates them.
class PurpleCallioLogger {
  PurpleCallioLogger({
    this.level = PurpleCallioLogLevel.none,
    PurpleCallioLogSink? sink,
  }) : sink = sink ?? _defaultSink;

  final PurpleCallioLogLevel level;
  final PurpleCallioLogSink sink;

  static void _defaultSink(PurpleCallioLogLevel level, String message) {
    developer.log(message, name: 'purplecallio', level: _devLevel(level));
  }

  static int _devLevel(PurpleCallioLogLevel l) => switch (l) {
        PurpleCallioLogLevel.error => 1000,
        PurpleCallioLogLevel.warning => 900,
        PurpleCallioLogLevel.info => 800,
        PurpleCallioLogLevel.debug => 500,
        PurpleCallioLogLevel.none => 0,
      };

  bool enabled(PurpleCallioLogLevel l) =>
      l != PurpleCallioLogLevel.none &&
      level != PurpleCallioLogLevel.none &&
      l.index <= level.index;

  void error(String m) => _log(PurpleCallioLogLevel.error, m);
  void warning(String m) => _log(PurpleCallioLogLevel.warning, m);
  void info(String m) => _log(PurpleCallioLogLevel.info, m);
  void debug(String m) => _log(PurpleCallioLogLevel.debug, m);

  void _log(PurpleCallioLogLevel l, String m) {
    if (!enabled(l)) return;
    try {
      sink(l, redact(m));
    } catch (_) {
      // A faulty sink must never break a call.
    }
  }

  static final List<(RegExp, String)> _rules = [
    // Authorization: Bearer xxx
    (RegExp(r'(Bearer\s+)[^\s",;}]+', caseSensitive: false), r'$1<redacted>'),
    // token=xxx / credential=xxx / password=xxx (query strings, key=value)
    (
      RegExp(r'((?:token|credential|password|api[_-]?key)=)[^&\s",;}]+',
          caseSensitive: false),
      r'$1<redacted>'
    ),
    // JSON-ish "token": "xxx", 'credential': 'xxx', callerToken: xxx
    (
      RegExp(
          r'''((?:[A-Za-z]*token|credential|password|api[_-]?key|x-api-key)["']?\s*[:=]\s*["']?)[^"',\s}]+''',
          caseSensitive: false),
      r'$1<redacted>'
    ),
    // SDP ICE credentials.
    (RegExp(r'(a=ice-pwd:)\S+'), r'$1<redacted>'),
    (RegExp(r'(a=ice-ufrag:)\S+'), r'$1<redacted>'),
  ];

  /// Redacts secrets from [input]. Public for testing and for app sinks.
  static String redact(String input) {
    var out = input;
    for (final (re, replacement) in _rules) {
      out = out.replaceAllMapped(re, (m) {
        return replacement.replaceAll(r'$1', m.group(1) ?? '');
      });
    }
    return out;
  }
}
