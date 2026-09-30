import Foundation
import Testing
@testable import PurpleCallio

@MainActor
@Suite struct CallFlowTests {
    // MARK: Caller

    @Test func callerWaitsForCallAcceptedThenJoinOfferCallStartedInOrder() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.join()
        #expect(h.rtc.medias.count == 1, "caller acquires media while ringing")
        await settle()
        #expect(h.signaling.emittedNames == [WireEvent.authenticate], "nothing is sent before call-accepted")
        #expect(h.rtc.peers.isEmpty)

        h.signaling.receive(WireEvent.callAccepted, ["callId": TestIDs.callId])
        await waitUntil { h.signaling.count(WireEvent.callStarted) == 1 }

        #expect(h.signaling.emittedNames == [
            WireEvent.authenticate, WireEvent.joinCall, WireEvent.offer, WireEvent.callStarted,
        ])
        #expect(h.signaling.payloads(WireEvent.joinCall).first??["callId"] as? String == TestIDs.callId)
        let offer = h.signaling.payloads(WireEvent.offer).first??["offer"] as? [String: Any]
        #expect(offer?["type"] as? String == "offer")
        #expect(offer?["sdp"] as? String == "v=0 fake-offer-1")
        #expect(h.peer.localDescriptions.first?.type == .offer)
        #expect(h.peer.addedMedia === h.media, "local tracks attached before the offer")
        #expect(h.log.index(of: "peer:addLocalMedia") < h.log.index(of: "createOffer"))
        #expect(h.log.index(of: "setLocal:offer") < h.log.index(of: "emit:offer"))
        #expect(meeting.connectionState == .joining)
        #expect(meeting.remoteParticipant?.participantId == TestIDs.receiverId)
        #expect(meeting.remoteParticipant?.displayName == "Bob")
        #expect(meeting.remoteParticipant?.isCameraEnabled == true, "VIDEO default")
        #expect(meeting.remoteParticipant?.isMicrophoneEnabled == true)
        #expect(delegate.joined == [TestIDs.receiverId])
        #expect(meeting.participants.count == 2)
    }

    @Test func callerWithAcceptedStatusProceedsWithoutCallAccepted() async throws {
        let h = Harness()
        h.status = "ACCEPTED"
        _ = try await h.join()
        await waitUntil { h.signaling.count(WireEvent.callStarted) == 1 }
        #expect(Array(h.signaling.emittedNames.dropFirst()) == [WireEvent.joinCall, WireEvent.offer, WireEvent.callStarted])
    }

    @Test func callerAnswerAppliedAndQueuedCandidatesFlushed() async throws {
        let h = Harness()
        _ = try await h.joinCallerInCall()
        let early1 = ["candidate": "candidate:1 early", "sdpMid": "0", "sdpMLineIndex": 0] as [String: Any]
        let early2 = ["candidate": "candidate:2 early", "sdpMid": "0", "sdpMLineIndex": 0] as [String: Any]
        h.signaling.receive(WireEvent.iceCandidate, ["candidate": early1])
        h.signaling.receive(WireEvent.iceCandidate, ["candidate": early2])
        await settle()
        #expect(h.peer.addedCandidates.isEmpty, "candidates are queued until the remote description is set")

        h.signaling.receive(WireEvent.answer, ["answer": ["type": "answer", "sdp": "v=0 remote-answer"]])
        await waitUntil { h.peer.addedCandidates.count == 2 }
        #expect(h.peer.remoteDescriptions.map(\.sdp) == ["v=0 remote-answer"])
        #expect(h.peer.addedCandidates.map(\.candidate) == ["candidate:1 early", "candidate:2 early"])
        #expect(h.log.index(of: "setRemote:answer") < h.log.index(of: "addCandidate:candidate:1 early"))

        h.signaling.receive(WireEvent.iceCandidate, ["candidate": ["candidate": "candidate:3 late", "sdpMid": "0", "sdpMLineIndex": 0]])
        await waitUntil { h.peer.addedCandidates.count == 3 }
    }

    @Test func localCandidateIsEmitted() async throws {
        let h = Harness()
        _ = try await h.joinCallerInCall()
        h.peer.localCandidate(IceCandidate(candidate: "candidate:9 local", sdpMid: "0", sdpMLineIndex: 0))
        let payload = h.signaling.payloads(WireEvent.iceCandidate).first??["candidate"] as? [String: Any]
        #expect(payload?["candidate"] as? String == "candidate:9 local")
        #expect(payload?["sdpMid"] as? String == "0")
        #expect(payload?["sdpMLineIndex"] as? Int == 0)
    }

    @Test func callerReceivesCallRejected() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.join()
        h.signaling.receive(WireEvent.callRejected, ["callId": TestIDs.callId])
        #expect(meeting.connectionState == .disconnected)
        #expect(meeting.disconnectReason == .rejected)
        #expect(delegate.ended == [.rejected])
        h.assertNoResidue()
    }

    @Test func callerLeaveWhileRingingCancels() async throws {
        let h = Harness()
        let (meeting, _) = try await h.join()
        await meeting.leave()
        #expect(h.api.calls == ["cancel"])
        #expect(h.signaling.count(WireEvent.callEndedDot) == 0)
        #expect(meeting.disconnectReason == .left)
        h.assertNoResidue()
    }

    @Test func callerCancelFailureFallsBackToEnd() async throws {
        let h = Harness()
        let (meeting, _) = try await h.join()
        h.api.failures["cancel"] = PurpleCallioError.signalingFailed(cause: nil)
        await meeting.leave()
        #expect(h.api.calls == ["cancel", "end"])
        #expect(meeting.disconnectReason == .left)
    }

    @Test func acceptAndRejectAreReceiverOnly() async throws {
        let h = Harness()
        let (meeting, _) = try await h.join()
        do { try await meeting.accept(); Issue.record("expected failure") } catch {
            assertError(error) { if case .invalidState = $0 { return true }; return false }
        }
        do { try await meeting.reject(); Issue.record("expected failure") } catch {
            assertError(error) { if case .invalidState = $0 { return true }; return false }
        }
    }

    // MARK: Receiver

    @Test func receiverAcceptOrderingMediaBeforeAccept() async throws {
        let h = Harness()
        h.role = .receiver
        let (meeting, delegate) = try await h.join()
        try await meeting.accept()

        let media = h.log.index(of: "media:acquired")
        let attach = h.log.index(of: "peer:addLocalMedia")
        let accept = h.log.index(of: "POST accept")
        let join = h.log.index(of: "POST join")
        let joinCall = h.log.index(of: "emit:join-call")
        let started = h.log.index(of: "emit:call.started")
        #expect(media < attach)
        #expect(attach < accept, "peer + local tracks exist before POST accept")
        #expect(accept < join)
        #expect(join < joinCall)
        #expect(joinCall < started)
        #expect(h.signaling.count(WireEvent.offer) == 0, "the receiver never offers")
        #expect(meeting.connectionState == .joining)
        #expect(meeting.incomingCall == nil)
        #expect(meeting.remoteParticipant?.participantId == TestIDs.callerId)
        #expect(meeting.remoteParticipant?.displayName == "Alice")
        #expect(delegate.joined == [TestIDs.callerId])
    }

    @Test func receiverAnswersOfferAfterFlushingEarlyCandidates() async throws {
        let h = Harness()
        _ = try await h.joinReceiverInCall()
        h.signaling.receive(WireEvent.iceCandidate, ["candidate": ["candidate": "candidate:1 early", "sdpMid": "0", "sdpMLineIndex": 0]])
        h.signaling.receive(WireEvent.offer, ["offer": ["type": "offer", "sdp": "v=0 remote-offer"]])
        await waitUntil { h.signaling.count(WireEvent.answer) == 1 }

        #expect(h.peer.remoteDescriptions.map(\.type) == [.offer])
        #expect(h.peer.addedCandidates.map(\.candidate) == ["candidate:1 early"])
        #expect(h.log.index(of: "setRemote:offer") < h.log.index(of: "addCandidate:candidate:1 early"))
        #expect(h.log.index(of: "addCandidate:candidate:1 early") < h.log.index(of: "createAnswer"))
        #expect(h.log.index(of: "setLocal:answer") < h.log.index(of: "emit:answer"))
        let answer = h.signaling.payloads(WireEvent.answer).first??["answer"] as? [String: Any]
        #expect(answer?["type"] as? String == "answer")
        #expect(answer?["sdp"] as? String == "v=0 fake-answer-1")

        // Renegotiation (ICE restart) offers are answered the same way.
        h.signaling.receive(WireEvent.offer, ["offer": ["type": "offer", "sdp": "v=0 restart-offer"]])
        await waitUntil { h.signaling.count(WireEvent.answer) == 2 }
    }

    @Test func receiverReject() async throws {
        let h = Harness()
        h.role = .receiver
        let (meeting, delegate) = try await h.join()
        try await meeting.reject()
        #expect(h.api.calls == ["reject"])
        #expect(meeting.disconnectReason == .rejected)
        #expect(delegate.ended == [.rejected])
        #expect(h.signaling.count(WireEvent.callEndedDot) == 0)
        #expect(h.rtc.medias.isEmpty)
        h.assertNoResidue()
    }

    @Test func receiverLeaveWhileRingingRejects() async throws {
        let h = Harness()
        h.role = .receiver
        let (meeting, _) = try await h.join()
        await meeting.leave()
        #expect(h.api.calls == ["reject"])
        #expect(meeting.disconnectReason == .left)
    }

    @Test func receiverSeesCallerCancel() async throws {
        let h = Harness()
        h.role = .receiver
        let (meeting, _) = try await h.join()
        h.signaling.receive(WireEvent.callCancelled, ["callId": TestIDs.callId])
        #expect(meeting.disconnectReason == .cancelled)
        h.assertNoResidue()
    }

    @Test func duplicateIncomingCallAfterAcceptIsIgnored() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.joinReceiverInCall()
        h.signaling.receive(WireEvent.incomingCall, ["callId": TestIDs.callId, "callerId": TestIDs.callerId, "type": "VIDEO"])
        await settle()
        #expect(meeting.incomingCall == nil)
        #expect(delegate.incoming.count <= 1)
    }

    // MARK: Permissions

    @Test func receiverMicrophoneDeniedStaysRingingAndDoesNotAccept() async throws {
        let h = Harness()
        h.role = .receiver
        h.permissions.denied = [.microphone]
        let (meeting, _) = try await h.join()
        do { try await meeting.accept(); Issue.record("expected failure") } catch {
            assertError(error) { if case .permissionDenied(.microphone) = $0 { return true }; return false }
        }
        #expect(meeting.connectionState == .ringing)
        #expect(!(h.api.calls.contains("accept")))
        #expect(h.rtc.livePeers == 0)
    }

    @Test func callerMicrophoneDeniedFailsJoin() async {
        let h = Harness()
        h.permissions.denied = [.microphone]
        do { _ = try await h.join(); Issue.record("expected failure") } catch {
            assertError(error) { if case .permissionDenied(.microphone) = $0 { return true }; return false }
        }
        h.assertNoResidue()
    }

    @Test func cameraDeniedContinuesAudioOnlyAndReportsIt() async throws {
        let h = Harness()
        h.permissions.denied = [.camera]
        let (meeting, delegate) = try await h.join()
        #expect(!(meeting.isCameraEnabled))
        #expect(h.media.startPositions == [], "camera never started")
        await waitUntil { !delegate.errors.isEmpty }
        assertError(delegate.errors.first) { if case .permissionDenied(.camera) = $0 { return true }; return false }
        #expect(meeting.connectionState == .ringing, "not fatal")

        h.signaling.receive(WireEvent.callAccepted, ["callId": TestIDs.callId])
        await waitUntil { h.signaling.count(WireEvent.callStarted) == 1 }
        #expect(h.signaling.count(WireEvent.cameraDisabled) == 1, "tell billing / the remote the camera is off")
        #expect(h.signaling.count(WireEvent.cameraEnabled) == 0)
    }
}
