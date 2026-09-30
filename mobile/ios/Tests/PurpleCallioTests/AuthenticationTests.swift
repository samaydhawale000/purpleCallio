import Foundation
import Testing
@testable import PurpleCallio

@MainActor
@Suite struct AuthenticationTests {
    @Test func authSuccessResolvesRingingWithCallIdFromConnected() async throws {
        let h = Harness()
        let (meeting, _) = try await h.join()
        #expect(meeting.callId == TestIDs.callId)
        #expect(meeting.role == .caller)
        #expect(meeting.callType == .video)
        #expect(meeting.connectionState == .ringing)
        #expect(h.api.detailsCallIds == [TestIDs.callId], "details must be fetched with the callId from `connected`")
        #expect(meeting.localParticipant.participantId == TestIDs.callerId)
        #expect(meeting.localParticipant.displayName == "Alice")
        #expect(meeting.remoteParticipant == nil, "remote participant appears only once accepted")
    }

    @Test func authenticateIsEmittedWithTokenAndAck() async throws {
        let h = Harness()
        _ = try await h.join()
        #expect(h.signaling.emittedNames.first == WireEvent.authenticate)
        #expect(h.signaling.payloads(WireEvent.authenticate).first??["token"] as? String == TestIDs.token)
    }

    @Test func authRejectedThrowsInvalidTokenAndCleansUp() async {
        let h = Harness()
        h.authBehavior = .reject
        do {
            _ = try await h.join()
            Issue.record("expected failure")
        } catch {
            assertError(error) { if case .invalidToken = $0 { return true }; return false }
        }
        h.assertNoResidue()
    }

    @Test func authTimeoutThrowsAuthenticationFailed() async {
        let h = Harness()
        h.authBehavior = .timeout
        do {
            _ = try await h.join()
            Issue.record("expected failure")
        } catch {
            assertError(error) { if case .authenticationFailed = $0 { return true }; return false }
        }
        #expect(h.signaling.disconnectCount == 1)
    }

    @Test func malformedAckThrowsAuthenticationFailed() async {
        let h = Harness()
        h.authBehavior = .malformed
        do {
            _ = try await h.join()
            Issue.record("expected failure")
        } catch {
            assertError(error) { if case .authenticationFailed = $0 { return true }; return false }
        }
    }

    @Test func connectTimeoutThrowsConnectionFailed() async {
        let h = Harness()
        h.autoConnect = false
        let client = h.makeClient()
        let task = Task { try await client.joinMeeting(token: TestIDs.token) }
        await waitUntil { h.signalings.first?.connectCount == 1 }
        h.scheduler.advance(by: 15)
        do {
            _ = try await task.value
            Issue.record("expected failure")
        } catch {
            assertError(error) { if case .connectionFailed = $0 { return true }; return false }
        }
        h.assertNoResidue()
    }

    @Test func emptyTokenThrowsInvalidToken() async {
        let h = Harness()
        do {
            _ = try await h.makeClient().joinMeeting(token: "  ")
            Issue.record("expected failure")
        } catch {
            assertError(error) { if case .invalidToken = $0 { return true }; return false }
        }
        #expect(h.signalings.isEmpty)
    }

    @Test func receiverTerminalEventBeforeAckThrowsMeetingEnded() async {
        let h = Harness()
        h.role = .receiver
        h.eventsBeforeAck = [(WireEvent.callMissed, ["callId": TestIDs.callId])]
        do {
            _ = try await h.join()
            Issue.record("expected failure")
        } catch {
            assertError(error) { if case .meetingEnded(.missed) = $0 { return true }; return false }
        }
        h.assertNoResidue()
    }

    @Test func detailsTerminalStatusThrowsMeetingEnded() async {
        let h = Harness()
        h.status = "ENDED"
        do {
            _ = try await h.join()
            Issue.record("expected failure")
        } catch {
            assertError(error) { if case .meetingEnded(.remoteEnded) = $0 { return true }; return false }
        }
        #expect(h.rtc.medias.count == 0, "no media is acquired for a call that is over")
    }

    @Test func receiverGetsIncomingCallBeforeJoinReturns() async throws {
        let h = Harness()
        h.role = .receiver
        let (meeting, delegate) = try await h.join()
        #expect(meeting.role == .receiver)
        #expect(meeting.connectionState == .ringing)
        #expect(meeting.incomingCall?.callerName == "Alice")
        #expect(meeting.incomingCall?.callType == .video)
        #expect(h.rtc.medias.count == 0, "receiver acquires media only on accept")
        await waitUntil { delegate.incoming.count == 1 }
    }
}
