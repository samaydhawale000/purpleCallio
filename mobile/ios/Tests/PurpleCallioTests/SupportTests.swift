import Foundation
import Testing
@testable import PurpleCallio

@Suite struct RedactionTests {
    @Test func redactsTokensCredentialsAndSdpSecrets() {
        let input = """
        GET /x?token=abc.def-123&x=1 Authorization: Bearer eyJhbGciOi.payload.sig \
        {"token":"tok_1","callerToken":"ct_2","receiverToken": "rt_3","credential":"pw/+="} \
        x-api-key: pk_live_999 password=hunter2
        a=ice-ufrag:F7gI
        a=ice-pwd:x9cml/YzichV2+XlhiMu8g
        """
        let output = PurpleCallioLogRedactor.redact(input)
        for secret in ["abc.def-123", "eyJhbGciOi", "tok_1", "ct_2", "rt_3", "pw/+=", "pk_live_999", "hunter2", "F7gI", "x9cml"] {
            #expect(!(output.contains(secret)), "leaked \(secret) in: \(output)")
        }
        #expect(output.contains("&x=1"), "non-secret context kept")
        #expect(output.contains("[REDACTED]"))
    }

    @Test func loggerRespectsLevelAndRedacts() {
        final class Box: @unchecked Sendable { var lines: [(PurpleCallioLogLevel, String)] = [] }
        let box = Box()
        let logger = PurpleCallioLogger(level: .warning) { box.lines.append(($0, $1)) }
        logger.debug("debug token=secret1")
        logger.info("info")
        logger.warning("warn Bearer secret2")
        logger.error("error token=secret3")
        #expect(box.lines.map(\.0) == [.warning, .error])
        #expect(!(box.lines.contains { $0.1.contains("secret") }))

        let silent = PurpleCallioLogger(level: .none) { _, _ in Issue.record("none logs nothing") }
        silent.error("x")
    }
}

@MainActor
@Suite struct LoggingIntegrationTests {
    @Test func fullFlowAtDebugNeverLogsTheToken() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        h.signaling.receive(WireEvent.answer, ["answer": ["type": "answer", "sdp": "v=0\na=ice-pwd:SECRETPWD"]])
        h.peer.ice(.connected)
        await meeting.leave()
        await settle()
        #expect(!(h.logs.isEmpty), "debug logging produced output")
        #expect(!(h.logs.contains { $0.1.contains(TestIDs.token) || $0.1.contains("SECRETPWD") }))
    }
}

@MainActor
@Suite struct IceServerTests {
    @Test func mergeDeduplicatesByUrl() {
        let merged = IceServerResolver.merge(
            [PurpleCallioIceServer(url: "stun:stun.l.google.com:19302"),
             PurpleCallioIceServer(urls: ["turn:t.example:3478", "turns:t.example:5349"], username: "u", credential: "c")],
            [PurpleCallioIceServer(url: "STUN:stun.l.google.com:19302"),
             PurpleCallioIceServer(urls: ["turn:t.example:3478", "turn:mine.example:3478"], username: "m", credential: "n")]
        )
        #expect(merged.map(\.urls) == [
            ["stun:stun.l.google.com:19302"],
            ["turn:t.example:3478", "turns:t.example:5349"],
            ["turn:mine.example:3478"],
        ])
        #expect(merged[2].username == "m")
    }

    @Test func fetchedServersMergedWithCustomAndPassedToPeer() async throws {
        let h = Harness()
        h.turnResult = .success([
            PurpleCallioIceServer(url: "stun:stun.l.google.com:19302"),
            PurpleCallioIceServer(url: "turn:backend.example:3478", username: "1:pc", credential: "x"),
        ])
        h.customIceServers = [PurpleCallioIceServer(url: "turn:backend.example:3478"), PurpleCallioIceServer(url: "stun:custom.example")]
        _ = try await h.joinCallerInCall()
        #expect(h.peer.iceServers.flatMap(\.urls) == ["stun:stun.l.google.com:19302", "turn:backend.example:3478", "stun:custom.example"])
        #expect(h.peer.iceServers[1].credential == "x")
    }

    @Test func fallsBackToPublicStunWhenTurnFetchFails() async throws {
        let h = Harness()
        h.turnResult = .failure(PurpleCallioError.invalidToken)
        _ = try await h.joinCallerInCall()
        #expect(h.peer.iceServers.flatMap(\.urls) == ["stun:stun.l.google.com:19302"])
    }

    @Test func overrideUsesOnlyCustomServers() async throws {
        let h = Harness()
        h.customIceServers = [PurpleCallioIceServer(url: "turn:only.example:3478", username: "a", credential: "b")]
        h.overrideIceServers = true
        _ = try await h.joinCallerInCall()
        #expect(h.peer.iceServers.flatMap(\.urls) == ["turn:only.example:3478"])
        #expect(!(h.log.entries.contains("GET turn")))
    }

    @Test func decodeTurnCredentialsStringOrArrayUrls() throws {
        let json = """
        {"iceServers":[{"urls":"stun:stun.l.google.com:19302"},
          {"urls":["turn:a:3478","turns:a:5349"],"username":"123:pc","credential":"s3cr3t"},
          {"urls":"turn:b:3478","username":"","credential":""}]}
        """
        let servers = try URLSessionPurpleCallioAPI.decodeIceServers(Data(json.utf8))
        #expect(servers.count == 3)
        #expect(servers[1].urls == ["turn:a:3478", "turns:a:5349"])
        #expect(servers[1].credential == "s3cr3t")
        #expect(servers[2].username == nil)
    }

    @Test func decodeDetails() throws {
        let json = """
        {"callId":"c1","type":"VIDEO","status":"RINGING","callerId":"a","receiverId":"b",
         "callerName":"Alice","callerAvatar":null,"receiverName":null,"receiverAvatar":null,
         "participantId":"a","token":"secret","hostedUrl":"https://x/call?token=secret","expiresAt":null,
         "branding":{"companyName":"Acme"}}
        """
        let details = try URLSessionPurpleCallioAPI.decodeDetails(Data(json.utf8))
        #expect(details.type == .video)
        #expect(details.callerName == "Alice")
        #expect(details.receiverName == nil)
        #expect(details.terminalReason == nil)
        #expect(CallDetails(callId: "c", type: .audio, status: "MISSED", callerId: "a", receiverId: "b",
                                   callerName: nil, callerAvatar: nil, receiverName: nil, receiverAvatar: nil,
                                   participantId: nil).terminalReason == .missed)
    }

    @Test func wirePayloadRoundTrip() {
        let candidate = IceCandidate(wire: ["candidate": "candidate:1", "sdpMid": NSNull(), "sdpMLineIndex": 1])
        #expect(candidate?.sdpMid == nil)
        #expect(candidate?.sdpMLineIndex == 1)
        #expect(SessionDescription(wire: ["type": "bogus", "sdp": "x"]) == nil)
        #expect(SessionDescription(wire: ["type": "answer", "sdp": "x"])?.type == .answer)
    }
}
