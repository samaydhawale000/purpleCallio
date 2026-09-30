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
}
