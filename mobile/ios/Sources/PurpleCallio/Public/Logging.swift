import Foundation

/// Log verbosity. Default is `.none`. A message is emitted when its level is at or
/// below the configured level (`.debug` shows everything).
public enum PurpleCallioLogLevel: Int, Comparable, Sendable {
    case none = 0
    case error = 1
    case warning = 2
    case info = 3
    case debug = 4

    public static func < (lhs: PurpleCallioLogLevel, rhs: PurpleCallioLogLevel) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// Pluggable log sink. Receives already-redacted messages. May be called from any thread.
public typealias PurpleCallioLogHandler = @Sendable (PurpleCallioLogLevel, String) -> Void

/// Redacts secrets from any string before it reaches a log sink.
///
/// Covers `token=` / `"token":"…"` (including `callerToken`, `receiverToken`),
/// `Bearer …`, `credential`, `password`, `x-api-key`, and SDP `a=ice-pwd` /
/// `a=ice-ufrag` lines.
public enum PurpleCallioLogRedactor {
    static let placeholder = "[REDACTED]"

    private static let rules: [(NSRegularExpression, String)] = {
        let keyValue = "[\"']?\\s*[:=]\\s*[\"']?"
        let value = "[^\"'&\\s,;}\\]]+"
        let patterns: [(String, String)] = [
            ("(?i)(bearer\\s+)[A-Za-z0-9\\-._~+/=]+", "$1\(placeholder)"),
            ("(?i)([A-Za-z_]*token\(keyValue))\(value)", "$1\(placeholder)"),
            ("(?i)(credential\(keyValue))\(value)", "$1\(placeholder)"),
            ("(?i)(password\(keyValue))\(value)", "$1\(placeholder)"),
            ("(?i)(x-api-key\(keyValue))\(value)", "$1\(placeholder)"),
            ("(?i)(api[_-]?key\(keyValue))\(value)", "$1\(placeholder)"),
            ("(a=ice-pwd:)\\S+", "$1\(placeholder)"),
            ("(a=ice-ufrag:)\\S+", "$1\(placeholder)"),
        ]
        return patterns.compactMap { pattern, template in
            (try? NSRegularExpression(pattern: pattern)).map { ($0, template) }
        }
    }()

    public static func redact(_ message: String) -> String {
        var result = message
        for (regex, template) in rules {
            let range = NSRange(result.startIndex..<result.endIndex, in: result)
            result = regex.stringByReplacingMatches(in: result, range: range, withTemplate: template)
        }
        return result
    }
}

/// Internal logger. Thread-safe (immutable).
final class PurpleCallioLogger: @unchecked Sendable {
    let level: PurpleCallioLogLevel
    private let handler: PurpleCallioLogHandler

    init(level: PurpleCallioLogLevel, handler: PurpleCallioLogHandler? = nil) {
        self.level = level
        self.handler = handler ?? { level, message in
            print("[PurpleCallio] [\(level)] \(message)")
        }
    }

    static let disabled = PurpleCallioLogger(level: .none)

    func isEnabled(_ messageLevel: PurpleCallioLogLevel) -> Bool {
        messageLevel != .none && level != .none && messageLevel <= level
    }

    func log(_ messageLevel: PurpleCallioLogLevel, _ message: @autoclosure () -> String) {
        guard isEnabled(messageLevel) else { return }
        handler(messageLevel, PurpleCallioLogRedactor.redact(message()))
    }

    func error(_ message: @autoclosure () -> String) { log(.error, message()) }
    func warning(_ message: @autoclosure () -> String) { log(.warning, message()) }
    func info(_ message: @autoclosure () -> String) { log(.info, message()) }
    func debug(_ message: @autoclosure () -> String) { log(.debug, message()) }
}
