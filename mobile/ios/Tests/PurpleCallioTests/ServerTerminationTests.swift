import Foundation
import Testing
@testable import PurpleCallio

/// PROTOCOL.md "Server-side termination" and auth-error handling.
@MainActor
@Suite struct ServerTerminationTests {
    @Test func callExpiredEndsTheCallWithExpiredReason() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.joinCallerInCall()
        h.signaling.receive(WireEvent.callExpired, ["callId": TestIDs.callId])
        await waitUntil { meeting.connectionState == .disconnected }
        #expect(meeting.disconnectReason == .expired)
        #expect(!delegate.states.contains(.reconnecting))
        h.assertNoResidue()
    }

    @Test func serverCallEndedThenForcedDisconnectNeverReconnects() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.joinReceiverInCall()
        h.signaling.receive(WireEvent.callEndedDot, ["callId": TestIDs.callId])
        h.signaling.simulateClosed() // io server disconnect right after the broadcast
        await waitUntil { meeting.connectionState == .disconnected }
        #expect(meeting.disconnectReason == .remoteEnded)
        #expect(meeting.error == nil)
        #expect(!delegate.states.contains(.reconnecting))
        h.assertNoResidue()
    }

    @Test func callExpiredBeforeAuthAckFailsJoinWithMeetingEnded() async throws {
        let h = Harness()
        h.authBehavior = .reject
        h.eventsBeforeAck = [(WireEvent.callExpired, ["callId": TestIDs.callId])]
        await #expect {
            _ = try await h.join()
        } throws: { error in
            if case PurpleCallioError.meetingEnded(.expired) = error { return true }
            return false
        }
    }

    @Test func authErrorInvalidTokenIsTerminalAndStopsReconnecting() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        let disconnectsBefore = h.signaling.disconnectCount
        h.signaling.receive(WireEvent.authError, ["code": "TOKEN_EXPIRED"])
        await waitUntil { meeting.connectionState == .failed }
        assertError(meeting.error) { if case .invalidToken = $0 { return true }; return false }
        #expect(h.signaling.disconnectCount > disconnectsBefore, "reconnection disabled")
        h.assertNoResidue()
    }

    @Test func authErrorRateLimitedIsConnectionFailed() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        h.signaling.receive(WireEvent.authError, ["code": "SOCKET_RATE_LIMITED"])
        await waitUntil { meeting.connectionState == .failed }
        assertError(meeting.error) { if case .connectionFailed = $0 { return true }; return false }
    }

    @Test func refusedJoinCallAckFailsWithSignalingFailed() async throws {
        let h = Harness()
        let (meeting, _) = try await h.join()
        h.signaling.joinCallAck = ["success": false, "error": "PLAYGROUND_PARTICIPANT_LIMIT"]
        h.signaling.receive(WireEvent.callAccepted, ["callId": TestIDs.callId])
        await waitUntil { meeting.connectionState == .failed }
        assertError(meeting.error) { if case .signalingFailed = $0 { return true }; return false }
    }

    @Test func successfulJoinCallAckKeepsTheCallGoing() async throws {
        let h = Harness()
        let (meeting, _) = try await h.join()
        h.signaling.joinCallAck = ["success": true, "participants": 2]
        h.signaling.receive(WireEvent.callAccepted, ["callId": TestIDs.callId])
        await waitUntil { h.signaling.count(WireEvent.callStarted) == 1 }
        await settle()
        #expect(meeting.connectionState == .joining)
    }
}
