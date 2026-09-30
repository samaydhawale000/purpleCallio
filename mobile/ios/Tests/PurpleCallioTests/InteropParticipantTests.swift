import Foundation
import Testing
@testable import PurpleCallio

/// A real call participant for cross-client interop runs (for example against the
/// hosted web call page). Uses the production Socket.IO, REST and WebRTC stack;
/// nothing is faked. Disabled unless `PURPLECALLIO_TOKEN` is set.
///
/// Environment:
/// - `PURPLECALLIO_TOKEN`: participant token (never printed)
/// - `PURPLECALLIO_BASE_URL`: API origin, e.g. http://localhost:3005
/// - `PURPLECALLIO_INTEROP_MEDIA`: `live` to capture devices (needs camera and
///   microphone permission for the terminal); default `receiveOnly`
/// - `PURPLECALLIO_HANGUP_AFTER_SECONDS`: leave this long after ICE connects
///
/// - `PURPLECALLIO_INTEROP_OUT`: optional file that receives the status lines live
///
/// Prints `STATE <state>`, `ICE <state>` and `INBOUND_BYTES <n>` lines on stdout.
@MainActor
@Suite struct InteropParticipantTests {
    static let env = ProcessInfo.processInfo.environment

    @Test(.enabled(if: env["PURPLECALLIO_TOKEN"] != nil))
    func interopParticipant() async throws {
        let env = Self.env
        let baseURL = URL(string: env["PURPLECALLIO_BASE_URL"] ?? "http://localhost:3005")!
        let receiveOnly = env["PURPLECALLIO_INTEROP_MEDIA"] != "live"
        let hangUpAfter = env["PURPLECALLIO_HANGUP_AFTER_SECONDS"].flatMap(Double.init)

        let client = PurpleCallioClient(
            baseURL: baseURL, logLevel: .info,
            logHandler: { level, message in
                FileHandle.standardError.write(Data("[sdk \(level)] \(message)\n".utf8))
            },
            iceServers: [], overrideIceServers: false,
            environment: .live(receiveOnlyMedia: receiveOnly)
        )
        defer { client.dispose() }

        let meeting = try await client.joinMeeting(token: env["PURPLECALLIO_TOKEN"]!)
        var lastState = ""
        var lastIce = ""
        var connectedAt: Date?

        func report() async {
            let state = "\(meeting.connectionState)"
            if state != lastState { lastState = state; emit("STATE \(state)") }
            if let diag = await meeting.diagnostics() {
                if diag.ice != lastIce { lastIce = diag.ice; emit("ICE \(diag.ice)") }
                emit("INBOUND_BYTES \(diag.inboundBytes)")
            }
        }

        await report()
        if meeting.role == .receiver {
            let deadline = Date().addingTimeInterval(30)
            while meeting.incomingCall == nil, meeting.connectionState == .ringing, Date() < deadline {
                try await Task.sleep(nanoseconds: 100_000_000)
            }
            try await meeting.accept()
        }

        let deadline = Date().addingTimeInterval(90)
        while Date() < deadline {
            await report()
            if meeting.connectionState == .disconnected || meeting.connectionState == .failed { break }
            if meeting.connectionState == .connected, connectedAt == nil { connectedAt = Date() }
            if let hangUpAfter, let connectedAt, Date().timeIntervalSince(connectedAt) >= hangUpAfter {
                emit("HANGUP")
                await meeting.leave()
                await report()
                break
            }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        emit("END reason=\(meeting.disconnectReason.map { "\($0)" } ?? "none") error=\(meeting.error.map { "\($0)" } ?? "none")")
        #expect(meeting.connectionState == .disconnected)
        #expect(meeting.error == nil)
    }

    /// Status lines go to stdout and, when `PURPLECALLIO_INTEROP_OUT` is set, are
    /// appended to that file immediately (`swift test` buffers the test's stdout).
    private func emit(_ line: String) {
        let data = Data((line + "\n").utf8)
        FileHandle.standardOutput.write(data)
        if let path = Self.env["PURPLECALLIO_INTEROP_OUT"] {
            if !FileManager.default.fileExists(atPath: path) { FileManager.default.createFile(atPath: path, contents: nil) }
            if let handle = FileHandle(forWritingAtPath: path) {
                handle.seekToEndOfFile(); handle.write(data); handle.closeFile()
            }
        }
    }
}
