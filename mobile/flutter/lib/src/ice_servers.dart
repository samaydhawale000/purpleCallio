import 'models.dart';

/// Used when `/turn/credentials` fails (PROTOCOL.md).
const PurpleCallioIceServer kFallbackStunServer =
    PurpleCallioIceServer(urls: ['stun:stun.l.google.com:19302']);

/// Merges ICE servers, de-duplicating by URL (first occurrence wins; a server
/// whose URLs were all seen before is dropped).
///
/// With [override], only [configured] is used and [fetched] is ignored.
List<PurpleCallioIceServer> mergeIceServers({
  required List<PurpleCallioIceServer> fetched,
  required List<PurpleCallioIceServer> configured,
  bool override = false,
}) {
  final source = override ? configured : [...fetched, ...configured];
  final seen = <String>{};
  final result = <PurpleCallioIceServer>[];
  for (final server in source) {
    final urls = <String>[];
    for (final url in server.urls) {
      final key = url.trim();
      if (key.isEmpty || !seen.add(key)) continue;
      urls.add(key);
    }
    if (urls.isEmpty) continue;
    result.add(PurpleCallioIceServer(
      urls: urls,
      username: server.username,
      credential: server.credential,
    ));
  }
  return result;
}
