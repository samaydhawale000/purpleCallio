import Foundation

/// `GET /calls/:callId/details`. Only the fields the SDK needs. The response also
/// carries the participant `token` and a `hostedUrl` containing it, so the raw body
/// is never logged.
struct CallDetails: Equatable {
    let callId: String
    let type: PurpleCallioCallType
    let status: String
    let callerId: String
    let receiverId: String
    let callerName: String?
    let callerAvatar: String?
    let receiverName: String?
    let receiverAvatar: String?
    let participantId: String?

    /// Terminal server statuses mapped to the SDK's disconnect reasons.
    var terminalReason: PurpleCallioDisconnectReason? {
        switch status.uppercased() {
        case "ENDED": return .remoteEnded
        case "MISSED": return .missed
        case "REJECTED": return .rejected
        case "CANCELLED": return .cancelled
        case "BUSY": return .busy
        default: return nil
        }
    }

    var isAccepted: Bool { status.uppercased() == "ACCEPTED" }
}

enum TransportKind: String { case p2p = "P2P", turn = "TURN" }
enum IceOutcome: String { case success = "SUCCESS", failed = "FAILED" }

/// PurpleCallio REST API, authenticated with the participant token (`Authorization: Bearer`).
@MainActor
protocol PurpleCallioAPI: AnyObject {
    func turnCredentials() async throws -> [PurpleCallioIceServer]
    func details(callId: String) async throws -> CallDetails
    func accept(callId: String) async throws
    func reject(callId: String) async throws
    func cancel(callId: String) async throws
    func join(callId: String) async throws
    func leave(callId: String) async throws
    func end(callId: String) async throws
    func reportTransport(callId: String, transport: TransportKind, candidateType: String) async throws
    func reportIce(callId: String, outcome: IceOutcome, iceConnectionState: String, connectionState: String) async throws
    /// Fire-and-forget `POST end` for app termination (no awaiting possible).
    func endDetached(callId: String)
}

@MainActor
final class URLSessionPurpleCallioAPI: PurpleCallioAPI {
    private let baseURL: URL
    private let token: String
    private let session: URLSession
    private let logger: PurpleCallioLogger

    init(baseURL: URL, token: String, logger: PurpleCallioLogger, session: URLSession? = nil) {
        self.baseURL = baseURL
        self.token = token
        self.logger = logger
        if let session {
            self.session = session
        } else {
            // Ephemeral: no disk cache, cookie or credential persistence for token-bearing requests.
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 15
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            self.session = URLSession(configuration: configuration)
        }
    }

    deinit {
        session.finishTasksAndInvalidate()
    }

    func turnCredentials() async throws -> [PurpleCallioIceServer] {
        let data = try await send("GET", "/turn/credentials")
        return try Self.decodeIceServers(data)
    }

    func details(callId: String) async throws -> CallDetails {
        let data = try await send("GET", "/calls/\(Self.escape(callId))/details")
        return try Self.decodeDetails(data)
    }

    func accept(callId: String) async throws { _ = try await send("POST", "/calls/\(Self.escape(callId))/accept") }
    func reject(callId: String) async throws { _ = try await send("POST", "/calls/\(Self.escape(callId))/reject") }
    func cancel(callId: String) async throws { _ = try await send("POST", "/calls/\(Self.escape(callId))/cancel") }
    func join(callId: String) async throws { _ = try await send("POST", "/calls/\(Self.escape(callId))/join") }
    func leave(callId: String) async throws { _ = try await send("POST", "/calls/\(Self.escape(callId))/leave") }
    func end(callId: String) async throws { _ = try await send("POST", "/calls/\(Self.escape(callId))/end") }

    func reportTransport(callId: String, transport: TransportKind, candidateType: String) async throws {
        _ = try await send("POST", "/calls/\(Self.escape(callId))/webrtc-transport",
                           body: ["transport": transport.rawValue, "candidateType": candidateType])
    }

    func reportIce(callId: String, outcome: IceOutcome, iceConnectionState: String, connectionState: String) async throws {
        _ = try await send("POST", "/calls/\(Self.escape(callId))/webrtc-ice", body: [
            "outcome": outcome.rawValue,
            "iceConnectionState": iceConnectionState,
            "connectionState": connectionState,
        ])
    }

    func endDetached(callId: String) {
        guard let request = try? makeRequest("POST", "/calls/\(Self.escape(callId))/end", body: nil) else { return }
        session.dataTask(with: request).resume()
    }

    // MARK: - Transport

    private func makeRequest(_ method: String, _ path: String, body: [String: Any]?) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw PurpleCallioError.connectionFailed(cause: PurpleCallioInternalError("Invalid URL for \(path)"))
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("purplecallio-ios/\(PurpleCallioSDK.version)", forHTTPHeaderField: "X-PurpleCallio-SDK")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return request
    }

    private func send(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> Data {
        let request = try makeRequest(method, path, body: body)
        logger.debug("\(method) \(path)")
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await withCheckedThrowingContinuation { continuation in
                session.dataTask(with: request) { data, response, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else if let response {
                        continuation.resume(returning: (data ?? Data(), response))
                    } else {
                        continuation.resume(throwing: PurpleCallioInternalError("Empty response"))
                    }
                }.resume()
            }
        } catch {
            logger.warning("\(method) \(path) network error: \(error.localizedDescription)")
            throw PurpleCallioError.connectionFailed(cause: error)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = Self.serverMessage(data)
            logger.warning("\(method) \(path) -> HTTP \(status)")
            // 401 = CallSessionGuard rejected the token. 403 means "wrong role"
            // (e.g. a caller calling /accept), which is not a token problem.
            if status == 401 { throw PurpleCallioError.invalidToken }
            throw PurpleCallioError.signalingFailed(
                cause: HTTPStatusError(method: method, path: path, statusCode: status, serverMessage: message)
            )
        }
        return data
    }

    private static func escape(_ component: String) -> String {
        component.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? component
    }

    // MARK: - Decoding (internal for tests)

    static func serverMessage(_ data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        if let message = object["message"] as? String { return PurpleCallioLogRedactor.redact(message) }
        if let messages = object["message"] as? [String] { return PurpleCallioLogRedactor.redact(messages.joined(separator: "; ")) }
        return nil
    }

    static func decodeIceServers(_ data: Data) throws -> [PurpleCallioIceServer] {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = object["iceServers"] as? [[String: Any]] else {
            throw PurpleCallioInternalError("Malformed /turn/credentials response")
        }
        return list.compactMap { entry in
            let urls: [String]
            if let single = entry["urls"] as? String { urls = [single] }
            else if let many = entry["urls"] as? [String] { urls = many }
            else if let single = entry["url"] as? String { urls = [single] }
            else { return nil }
            guard !urls.isEmpty else { return nil }
            let username = (entry["username"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let credential = (entry["credential"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return PurpleCallioIceServer(urls: urls, username: username, credential: credential)
        }
    }

    static func decodeDetails(_ data: Data) throws -> CallDetails {
        guard let o = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw PurpleCallioError.signalingFailed(cause: PurpleCallioInternalError("Malformed call details"))
        }
        func string(_ key: String) -> String? {
            guard let value = o[key] as? String, !value.isEmpty else { return nil }
            return value
        }
        guard let callId = string("callId"),
              let type = PurpleCallioCallType(wire: string("type")),
              let status = string("status"),
              let callerId = string("callerId"),
              let receiverId = string("receiverId") else {
            throw PurpleCallioError.signalingFailed(cause: PurpleCallioInternalError("Call details missing required fields"))
        }
        return CallDetails(
            callId: callId, type: type, status: status,
            callerId: callerId, receiverId: receiverId,
            callerName: string("callerName"), callerAvatar: string("callerAvatar"),
            receiverName: string("receiverName"), receiverAvatar: string("receiverAvatar"),
            participantId: string("participantId")
        )
    }
}

/// Merges the backend's ICE servers with custom ones (PROTOCOL.md / API.md).
enum IceServerResolver {
    /// - `override == true`: only `custom` (falls back to public STUN if empty).
    /// - otherwise: fetched (or the STUN fallback on any failure) + custom, de-duplicated by URL.
    @MainActor
    static func resolve(
        api: PurpleCallioAPI,
        custom: [PurpleCallioIceServer],
        override: Bool,
        logger: PurpleCallioLogger
    ) async -> [PurpleCallioIceServer] {
        if override {
            if custom.isEmpty {
                logger.warning("overrideIceServers is set but no iceServers were given; using public STUN")
                return [.fallbackStun]
            }
            return merge(custom, [])
        }
        let fetched: [PurpleCallioIceServer]
        do {
            let servers = try await api.turnCredentials()
            fetched = servers.isEmpty ? [.fallbackStun] : servers
        } catch {
            logger.info("TURN credentials unavailable, using public STUN")
            fetched = [.fallbackStun]
        }
        return merge(fetched, custom)
    }

    /// Keeps the first occurrence of every URL; drops entries left with no URLs.
    static func merge(_ primary: [PurpleCallioIceServer], _ secondary: [PurpleCallioIceServer]) -> [PurpleCallioIceServer] {
        var seen = Set<String>()
        var result: [PurpleCallioIceServer] = []
        for server in primary + secondary {
            let urls = server.urls.filter { url in
                let key = url.trimmingCharacters(in: .whitespaces).lowercased()
                guard !key.isEmpty, !seen.contains(key) else { return false }
                seen.insert(key)
                return true
            }
            guard !urls.isEmpty else { continue }
            result.append(PurpleCallioIceServer(urls: urls, username: server.username, credential: server.credential))
        }
        return result
    }
}
