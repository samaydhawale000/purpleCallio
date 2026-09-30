import Foundation

/// How the SDK derives its REST and Socket.IO URLs from the one `baseURL`.
///
/// `baseURL` is the PurpleCallio REST API base. Behind the hosted service's
/// Nginx that is `https://<host>/api`, while Socket.IO is served at the same
/// host's `/socket.io/`. So the socket origin is `baseURL` without a trailing
/// `/api` (the same rule the hosted web app uses). A base without `/api`
/// (e.g. a server on `http://localhost:3005`) is used as-is for both.
enum PurpleCallioEndpoints {
    /// `base` + `path` by string concatenation. `URL(string:relativeTo:)` would
    /// drop the `/api` segment for absolute paths like `/calls/...`.
    static func apiURL(_ base: URL, _ path: String) -> URL? {
        URL(string: trimmedBase(base) + path)
    }

    static func signalingURL(from base: URL) -> URL {
        let trimmed = trimmedBase(base)
        let origin = trimmed.hasSuffix("/api") ? String(trimmed.dropLast(4)) : trimmed
        return URL(string: origin) ?? base
    }

    private static func trimmedBase(_ base: URL) -> String {
        var s = base.absoluteString
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }
}
