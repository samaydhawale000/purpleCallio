import Foundation
import Testing
@testable import PurpleCallio

@MainActor
@Suite struct SignalingGateTests {
    // Race found against the real server: the caller's offer can arrive while the
    // receiver is still in POST join, before its join-call. The gateway drops
    // signaling from sockets not in the room, so the answer and candidates must
    // be held until join-call.
    @Test func receiverHoldsAnswerAndCandidatesUntilJoinCall() async throws {
        let h = Harness()
        h.role = .receiver
        let (meeting, _) = try await h.join()
        h.api.onRecord = { name in
            guard name == "accept" else { return }
            h.signaling.receive(WireEvent.offer, ["offer": ["type": "offer", "sdp": "v=0 early-offer"]])
        }
        h.api.holds["join"] = {
            await waitUntil { h.signaling.emittedNames.contains(WireEvent.answer) || h.peer.localDescriptions.contains { $0.type == .answer } }
            h.peer.localCandidate(IceCandidate(candidate: "candidate:local", sdpMid: "0", sdpMLineIndex: 0))
        }
        try await meeting.accept()
        await waitUntil { h.signaling.emittedNames.contains(WireEvent.answer) }
        let names = h.signaling.emittedNames
        let joinCall = try #require(names.firstIndex(of: WireEvent.joinCall))
        #expect(joinCall < names.firstIndex(of: WireEvent.answer)!, "answer after join-call: \(names)")
        #expect(joinCall < names.firstIndex(of: WireEvent.iceCandidate)!, "candidate after join-call: \(names)")
    }

    // join-call completes asynchronously on the gateway (it re-checks the call
    // in the database first), so an offer sent right after emitting it can be
    // dropped. Nothing that needs the room goes out before the ack.
    @Test func callerOfferAndCallStartedWaitForTheJoinCallAck() async throws {
        let h = Harness()
        let (_, _) = try await h.join(options: PurpleCallioJoinOptions(microphoneEnabled: false))
        h.signaling.holdJoinAck = true
        h.signaling.receive(WireEvent.callAccepted, ["callId": TestIDs.callId])
        await waitUntil { h.peer.localDescriptions.contains { $0.type == .offer } }
        await settle()
        #expect(h.signaling.emittedNames.contains(WireEvent.joinCall))
        #expect(!h.signaling.emittedNames.contains(WireEvent.offer), "offer held until the ack")
        #expect(!h.signaling.emittedNames.contains(WireEvent.callStarted), "call.started held until the ack")
        #expect(!h.signaling.emittedNames.contains(WireEvent.microphoneDisabled), "media correction held until the ack")
        h.signaling.releaseJoinAck()
        await waitUntil { h.signaling.emittedNames.contains(WireEvent.callStarted) }
        let names = h.signaling.emittedNames
        #expect(names.firstIndex(of: WireEvent.offer)! < names.firstIndex(of: WireEvent.callStarted)!)
        #expect(names.contains(WireEvent.microphoneDisabled))
    }
}
