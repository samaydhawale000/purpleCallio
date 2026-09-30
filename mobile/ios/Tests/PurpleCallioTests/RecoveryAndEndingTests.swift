import Foundation
import Testing
@testable import PurpleCallio

@MainActor
@Suite struct RecoveryTests {
    @Test func socketReconnectReauthenticatesAndRejoins() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.joinCallerInCall()
        h.signaling.receive(WireEvent.answer, ["answer": ["type": "answer", "sdp": "v=0 a"]])
        await waitUntil { h.peer.remoteDescriptions.count == 1 }
        h.peer.ice(.connected)
        #expect(meeting.connectionState == .connected)

        h.signaling.simulateDrop()
        #expect(meeting.connectionState == .reconnecting)
        try meeting.toggleMicrophone() // while offline: must not be emitted into the void
        #expect(h.signaling.count(WireEvent.microphoneDisabled) == 0)

        h.signaling.simulateConnect()
        await waitUntil { h.signaling.count(WireEvent.joinCall) == 2 }
        #expect(h.signaling.count(WireEvent.authenticate) == 2, "re-authenticated on reconnect")
        let names = h.signaling.emittedNames
        #expect(names.lastIndex(of: WireEvent.authenticate)! < names.lastIndex(of: WireEvent.joinCall)!)
        #expect(meeting.connectionState == .connected)
        #expect(h.signaling.count(WireEvent.microphoneDisabled) == 1, "state correction after re-join")
        #expect(h.signaling.count(WireEvent.offer) == 1, "answered offer is not re-sent")
        #expect(delegate.states.contains(.reconnecting))
    }

    @Test func callerReconnectWhileRingingRechecksDetailsAndProceedsIfAccepted() async throws {
        let h = Harness()
        let (meeting, _) = try await h.join()
        h.signaling.simulateDrop()
        #expect(meeting.connectionState == .reconnecting)
        h.status = "ACCEPTED" // call-accepted was emitted while we were offline
        h.signaling.simulateConnect()
        await waitUntil { h.signaling.count(WireEvent.callStarted) == 1 }
        #expect(h.signaling.count(WireEvent.joinCall) == 1)
    }

    @Test func reconnectDetectsCallEndedWhileOffline() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        h.signaling.simulateDrop()
        h.status = "ENDED"
        h.signaling.simulateConnect()
        await waitUntil { meeting.connectionState == .disconnected }
        #expect(meeting.disconnectReason == .remoteEnded)
    }

    @Test func reauthenticationRejectedFails() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        h.signaling.simulateDrop()
        h.signaling.authBehavior = .reject
        h.signaling.simulateConnect()
        await waitUntil { meeting.connectionState == .failed }
        assertError(meeting.error) { if case .invalidToken = $0 { return true }; return false }
        h.assertNoResidue()
    }

    @Test func callerRestartsIceThreeSecondsAfterDisconnected() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        h.peer.ice(.connected)
        h.peer.ice(.disconnected)
        #expect(meeting.connectionState == .reconnecting)
        h.scheduler.advance(by: 2.9)
        await settle()
        #expect(h.peer.offers == [false])
        h.scheduler.advance(by: 0.1)
        await waitUntil { h.signaling.count(WireEvent.offer) == 2 }
        #expect(h.peer.offers == [false, true], "createOffer(iceRestart: true)")

        h.peer.ice(.connected)
        #expect(meeting.connectionState == .connected)
        #expect(h.scheduler.activeTimers == 0, "watchdog cleared")
        h.scheduler.advance(by: 20)
        #expect(meeting.connectionState == .connected)
    }

    @Test func callerRestartsIceImmediatelyOnFailed() async throws {
        let h = Harness()
        _ = try await h.joinCallerInCall()
        h.peer.ice(.failed)
        h.scheduler.advance(by: 0)
        await waitUntil { h.peer.offers == [false, true] }
        #expect(h.api.iceReports == [.failed])
    }

    @Test func failedInsideDisconnectWindowRestartsImmediately() async throws {
        let h = Harness()
        _ = try await h.joinCallerInCall()
        h.peer.ice(.disconnected)
        h.scheduler.advance(by: 1)
        h.peer.ice(.failed)
        await waitUntil { h.peer.offers == [false, true] }
        h.scheduler.advance(by: 2.5)
        await settle()
        #expect(h.peer.offers == [false, true], "only one restart per window")
    }

    @Test func receiverNeverRestartsIce() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinReceiverInCall()
        h.peer.ice(.disconnected)
        h.scheduler.advance(by: 3)
        h.peer.ice(.failed)
        await settle()
        #expect(h.peer.offers == [])
        #expect(h.signaling.count(WireEvent.offer) == 0)
        #expect(meeting.connectionState == .reconnecting)
    }

    @Test func watchdogFailsCallAfterFifteenSeconds() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.joinCallerInCall()
        h.peer.ice(.connected)
        h.peer.ice(.disconnected)
        h.scheduler.advance(by: 14.9)
        #expect(meeting.connectionState == .reconnecting)
        h.peer.ice(.checking)
        h.scheduler.advance(by: 0.1)
        #expect(meeting.connectionState == .failed)
        assertError(meeting.error) { if case .webrtcFailed = $0 { return true }; return false }
        #expect(delegate.errors.count == 1)
        h.assertNoResidue()
    }

    @Test func sessionReplaced() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.joinCallerInCall()
        h.signaling.receive(WireEvent.sessionReplaced, ["callId": TestIDs.callId])
        #expect(meeting.connectionState == .disconnected)
        #expect(meeting.disconnectReason == .sessionReplaced)
        #expect(delegate.ended == [.sessionReplaced])
        #expect(h.api.calls.filter { $0 == "end" || $0 == "leave" } == [], "no hang-up: the other device owns the call")
        h.assertNoResidue()
    }
}

@MainActor
@Suite struct EndingTests {
    @Test func remoteHangupCallEnded() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.joinCallerInCall()
        h.signaling.receive(WireEvent.callEndedDash)
        #expect(meeting.disconnectReason == .remoteEnded)
        #expect(delegate.ended == [.remoteEnded])
        h.assertNoResidue()
    }

    @Test func remoteHangupDotEvent() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinReceiverInCall()
        h.signaling.receive(WireEvent.callEndedDot, ["callId": TestIDs.callId])
        #expect(meeting.disconnectReason == .remoteEnded)
    }

    @Test func participantLeftRemovesRemoteButDoesNotEndCall() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.joinCallerInCall()
        h.signaling.receive(WireEvent.participantLeft, ["callId": TestIDs.callId, "participantId": TestIDs.callerId])
        #expect(meeting.remoteParticipant != nil, "own participant.left is ignored")
        h.signaling.receive(WireEvent.participantLeft, ["callId": TestIDs.callId, "participantId": TestIDs.receiverId])
        #expect(meeting.remoteParticipant == nil)
        #expect(delegate.left == [TestIDs.receiverId])
        #expect(meeting.participants.count == 1)
        #expect(meeting.connectionState == .joining, "the call continues")
        h.signaling.receive(WireEvent.participantJoined, ["callId": TestIDs.callId, "participantId": TestIDs.receiverId, "participants": 2])
        #expect(meeting.remoteParticipant?.participantId == TestIDs.receiverId)
        #expect(delegate.joined == [TestIDs.receiverId, TestIDs.receiverId])
    }

    @Test func hangupEmitsBothEndEventsThenLeaveThenEnd() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.joinCallerInCall()
        await meeting.leave()
        let endedDot = h.log.index(of: "emit:call.ended")
        let endedDash = h.log.index(of: "emit:call-ended")
        let leave = h.log.index(of: "POST leave")
        let end = h.log.index(of: "POST end")
        #expect(endedDot < endedDash)
        #expect(endedDash < leave)
        #expect(leave < end)
        #expect(end < h.log.index(of: "peer:close"))
        #expect(h.signaling.payloads(WireEvent.callEndedDot).first??["callId"] as? String == TestIDs.callId)
        #expect(h.signaling.payloads(WireEvent.callEndedDash).first! == nil, "call-ended has no payload")
        #expect(meeting.connectionState == .disconnected)
        #expect(meeting.disconnectReason == .left)
        #expect(delegate.ended == [.left])
    }

    @Test func cleanupReleasesEverything() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        let localTrack = try #require(meeting.localParticipant.videoTrack)
        let renderer = NSObject()
        localTrack.addRenderer(renderer)
        #expect(h.media.backend?.renderers.count == 1)
        let remoteBackend = h.peer.remoteVideo()
        let remoteTrack = try #require(meeting.remoteParticipant?.videoTrack)
        remoteTrack.addRenderer(renderer)
        h.peer.ice(.disconnected) // arm the watchdog + restart timers
        #expect(h.scheduler.activeTimers > 0)

        await meeting.leave()

        #expect(h.peer.closed)
        #expect(h.media.released)
        #expect(!(h.media.isCapturing))
        #expect(h.media.backend?.renderers.count == 0, "renderers released")
        #expect(remoteBackend.renderers.count == 0)
        #expect(localTrack.isInvalidated)
        #expect(remoteTrack.isInvalidated)
        #expect(meeting.localParticipant.videoTrack == nil)
        #expect(meeting.remoteParticipant?.videoTrack == nil)
        #expect(h.signaling.removeAllHandlersCount == 1)
        #expect(h.signaling.disconnectCount == 1)
        #expect(h.audioSession.deactivations == 1)
        h.assertNoResidue()

        // Late events after cleanup are inert.
        h.peer.ice(.connected)
        h.signaling.receive(WireEvent.offer, ["offer": ["type": "offer", "sdp": "x"]])
        #expect(meeting.connectionState == .disconnected)
    }

    @Test func leaveIsIdempotentAndConcurrentSafe() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.joinCallerInCall()
        async let first: Void = meeting.leave()
        async let second: Void = meeting.leave()
        _ = await (first, second)
        await meeting.leave()
        meeting.dispose()
        #expect(h.api.count("end") == 1)
        #expect(h.api.count("leave") == 1)
        #expect(h.signaling.count(WireEvent.callEndedDot) == 1)
        #expect(delegate.ended == [.left])
    }

    @Test func disposeIsIdempotentAndDoesNotSignal() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.joinCallerInCall()
        let emits = h.signaling.emits.count
        meeting.dispose()
        meeting.dispose()
        await meeting.leave()
        #expect(h.signaling.emits.count == emits)
        #expect(h.api.calls == [])
        #expect(meeting.disconnectReason == .left)
        #expect(delegate.ended == [.left])
        h.assertNoResidue()
    }

    @Test func operationsAfterEndThrowInvalidState() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        await meeting.leave()
        #expect(throws: (any Error).self) { try meeting.toggleMicrophone() }
        do { try await meeting.enableCamera(); Issue.record("expected failure") } catch {
            assertError(error) { if case .invalidState = $0 { return true }; return false }
        }
    }

    @Test func joinLeaveJoinLeaveWithFreshMeetingsLeavesNoResidue() async throws {
        let h = Harness()
        let client = h.makeClient()
        for round in 0..<2 {
            let (meeting, _) = try await h.join(client: client)
            h.signaling.receive(WireEvent.callAccepted, ["callId": TestIDs.callId])
            await waitUntil { h.signaling.count(WireEvent.callStarted) == 1 }
            h.peer.ice(.connected)
            #expect(meeting.connectionState == .connected, "round \(round)")
            await meeting.leave()
            h.assertNoResidue()
            #expect(client.activeMeetingCount == 0)
        }
        #expect(h.rtc.peers.count == 2)
        #expect(h.signalings.count == 2)
        #expect(h.signalings[1].count(WireEvent.joinCall) == 1, "no listener or state carried over")
    }

    @Test func clientDisposeDisposesMeetings() async throws {
        let h = Harness()
        let client = h.makeClient()
        let (meeting, _) = try await h.join(client: client)
        #expect(client.activeMeetingCount == 1)
        client.dispose()
        #expect(meeting.connectionState == .disconnected)
        #expect(client.activeMeetingCount == 0)
        h.assertNoResidue()
    }

    @Test func clientKeepsLiveMeetingAliveUntilItEnds() async throws {
        let h = Harness()
        let client = h.makeClient()
        weak var weakMeeting: PurpleCallioMeeting?
        do {
            let meeting = try await client.joinMeeting(token: TestIDs.token)
            weakMeeting = meeting
        }
        // The app dropped its reference; the call must keep working.
        h.signaling.receive(WireEvent.callAccepted, ["callId": TestIDs.callId])
        await waitUntil { h.signaling.count(WireEvent.callStarted) == 1 }
        #expect(weakMeeting != nil)
        h.signaling.receive(WireEvent.callEndedDash)
        #expect(client.activeMeetingCount == 0, "released once it ended")
        h.assertNoResidue()
    }
}
