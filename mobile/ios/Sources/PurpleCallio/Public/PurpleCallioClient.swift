import Foundation

/// Entry point. Holds configuration and creates meetings.
///
/// ```swift
/// let client = PurpleCallioClient(baseURL: URL(string: "https://<your-purplecallio-host>/api")!)
/// let meeting = try await client.joinMeeting(token: participantTokenFromYourBackend)
/// ```
///
/// The token is a **participant token** that your backend obtained from
/// `POST /calls` with its project API key. Never ship an API key in an app.
@MainActor
public final class PurpleCallioClient {
    public let baseURL: URL
    public let logLevel: PurpleCallioLogLevel
    public let iceServers: [PurpleCallioIceServer]
    public let overrideIceServers: Bool

    private let logger: PurpleCallioLogger
    private let environment: MeetingEnvironment
    /// Meetings are retained until they clean up (end, fail or are disposed), so a
    /// live call never depends on the app keeping its own reference.
    private var meetings: [PurpleCallioMeeting] = []

    /// - Parameters:
    ///   - baseURL: Your PurpleCallio REST API base, e.g. `https://<host>/api`. Required:
    ///     there is no default host. Socket.IO connects to the same host without `/api`.
    ///   - logLevel: Default `.none`. Logs are redacted (tokens, credentials, SDP ICE passwords).
    ///   - logHandler: Custom sink; defaults to `print`.
    ///   - iceServers: Extra STUN/TURN servers merged with the backend's `/turn/credentials`,
    ///     de-duplicated by URL.
    ///   - overrideIceServers: Use only `iceServers`.
    public convenience init(
        baseURL: URL,
        logLevel: PurpleCallioLogLevel = .none,
        logHandler: PurpleCallioLogHandler? = nil,
        iceServers: [PurpleCallioIceServer] = [],
        overrideIceServers: Bool = false
    ) {
        self.init(
            baseURL: baseURL, logLevel: logLevel, logHandler: logHandler,
            iceServers: iceServers, overrideIceServers: overrideIceServers,
            environment: .live
        )
    }

    init(
        baseURL: URL,
        logLevel: PurpleCallioLogLevel,
        logHandler: PurpleCallioLogHandler?,
        iceServers: [PurpleCallioIceServer],
        overrideIceServers: Bool,
        environment: MeetingEnvironment
    ) {
        self.baseURL = baseURL
        self.logLevel = logLevel
        self.iceServers = iceServers
        self.overrideIceServers = overrideIceServers
        self.environment = environment
        logger = PurpleCallioLogger(level: logLevel, handler: logHandler)
    }

    /// Connects, authenticates with the participant token and loads the call details.
    /// Resolves with the meeting in `ringing` (a CALLER has also acquired local media).
    ///
    /// Throws `invalidToken`, `authenticationFailed`, `connectionFailed`,
    /// `meetingEnded(reason)` when the call is already over, or `permissionDenied`
    /// (CALLER, microphone).
    public func joinMeeting(
        token: String,
        options: PurpleCallioJoinOptions = PurpleCallioJoinOptions()
    ) async throws -> PurpleCallioMeeting {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw PurpleCallioError.invalidToken }
        let meeting = PurpleCallioMeeting(
            token: trimmed,
            options: options,
            baseURL: baseURL,
            customIceServers: iceServers,
            overrideIceServers: overrideIceServers,
            logger: logger,
            environment: environment
        )
        meetings.append(meeting)
        meeting.onCleanup = { [weak self, weak meeting] in
            self?.meetings.removeAll { $0 === meeting }
        }
        try await meeting.start()
        return meeting
    }

    /// Disposes every meeting created by this client (no signaling).
    public func dispose() {
        let active = meetings
        meetings.removeAll()
        active.forEach { $0.dispose() }
    }

    /// Meetings that have not cleaned up yet (diagnostics).
    public var activeMeetingCount: Int { meetings.count }
}
