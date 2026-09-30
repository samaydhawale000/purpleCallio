import Foundation
import Testing
@testable import PurpleCallio

@MainActor
@Suite struct MediaStateTests {
    private let mediaEvents = [
        WireEvent.cameraEnabled, WireEvent.cameraDisabled,
        WireEvent.microphoneEnabled, WireEvent.microphoneDisabled,
        WireEvent.screenShareStarted, WireEvent.screenShareStopped,
    ]

    private func mediaEmits(_ h: Harness) -> [String] {
        h.signaling.emittedNames.filter { mediaEvents.contains($0) }
    }

    @Test func defaultJoinEmitsNoMediaEvents() async throws {
        let h = Harness()
        _ = try await h.joinCallerInCall()
        #expect(mediaEmits(h) == [], "never emit an initial-state event")
    }

    @Test func microphoneMutedUnmutedMuted() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        #expect(meeting.isMicrophoneEnabled)

        try meeting.toggleMicrophone()
        #expect(!(meeting.isMicrophoneEnabled))
        #expect(!(h.media.isAudioEnabled), "track.isEnabled flips")
        try meeting.toggleMicrophone()
        #expect(meeting.isMicrophoneEnabled)
        #expect(h.media.isAudioEnabled)
        try meeting.toggleMicrophone()
        #expect(!(meeting.isMicrophoneEnabled))

        #expect(mediaEmits(h) == [WireEvent.microphoneDisabled, WireEvent.microphoneEnabled, WireEvent.microphoneDisabled])
        #expect(h.signaling.payloads(WireEvent.microphoneDisabled).first??["callId"] as? String == TestIDs.callId)
        #expect(!(meeting.localParticipant.isMicrophoneEnabled))
        #expect(h.rtc.peers.count == 1, "no renegotiation")
        #expect(h.peer.offers.count == 1)
    }

    @Test func enableWhenAlreadyEnabledDoesNotEmit() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        try meeting.enableMicrophone()
        try await meeting.enableCamera()
        #expect(mediaEmits(h) == [])
        try meeting.disableMicrophone()
        try meeting.disableMicrophone()
        try await meeting.disableCamera()
        try await meeting.disableCamera()
        #expect(mediaEmits(h) == [WireEvent.microphoneDisabled, WireEvent.cameraDisabled])
    }

    @Test func joinMutedEmitsExactlyOneMicrophoneDisabledRightAfterJoinCall() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall(options: PurpleCallioJoinOptions(microphoneEnabled: false))
        #expect(!(meeting.isMicrophoneEnabled))
        #expect(!(h.media.isAudioEnabled))
        #expect(mediaEmits(h) == [WireEvent.microphoneDisabled])
        let names = h.signaling.emittedNames
        let join = names.firstIndex(of: WireEvent.joinCall)!
        #expect(names[join + 1] == WireEvent.microphoneDisabled, "right after join-call")
        #expect(!(names.contains(WireEvent.microphoneEnabled)))
        #expect(!(names.contains(WireEvent.cameraEnabled)))
    }

    @Test func receiverJoinWithCameraOffEmitsOneCameraDisabledAndNeverCaptures() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinReceiverInCall(options: PurpleCallioJoinOptions(cameraEnabled: false))
        #expect(!(meeting.isCameraEnabled))
        #expect(!(h.media.isCapturing), "camera hardware not used")
        #expect(h.media.startPositions == [])
        #expect(mediaEmits(h) == [WireEvent.cameraDisabled])
        let names = h.signaling.emittedNames
        #expect(names[names.firstIndex(of: WireEvent.joinCall)! + 1] == WireEvent.cameraDisabled)
    }

    @Test func toggleBeforeJoinCallDoesNotEmitButJoinCorrects() async throws {
        let h = Harness()
        let (meeting, _) = try await h.join()
        try meeting.disableMicrophone() // while ringing, not in the room yet
        #expect(mediaEmits(h) == [])
        h.signaling.receive(WireEvent.callAccepted, ["callId": TestIDs.callId])
        await waitUntil { h.signaling.count(WireEvent.callStarted) == 1 }
        #expect(mediaEmits(h) == [WireEvent.microphoneDisabled])
    }

    @Test func disableCameraStopsCaptureAndEnableRestartsIt() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        #expect(meeting.isCameraEnabled)
        #expect(h.media.isCapturing)
        #expect(h.media.isVideoEnabled)

        try await meeting.toggleCamera()
        #expect(!(meeting.isCameraEnabled))
        #expect(!(h.media.isVideoEnabled), "track disabled")
        #expect(!(h.media.isCapturing), "capture stopped: camera released")
        #expect(h.media.stopCount == 1)

        try await meeting.toggleCamera()
        #expect(meeting.isCameraEnabled)
        #expect(h.media.isCapturing)
        #expect(h.media.isVideoEnabled)
        #expect(h.media.startPositions == [.front, .front])
        #expect(mediaEmits(h) == [WireEvent.cameraDisabled, WireEvent.cameraEnabled])
    }

    @Test func cameraOperationsOnAudioCallThrowInvalidState() async throws {
        let h = Harness()
        h.callType = .audio
        let (meeting, _) = try await h.joinCallerInCall()
        #expect(!(h.media.hasVideo))
        for operation in [meeting.enableCamera, meeting.disableCamera, meeting.toggleCamera, meeting.switchCamera] {
            do { try await operation(); Issue.record("expected failure") } catch {
                assertError(error) { if case .invalidState = $0 { return true }; return false }
            }
        }
        #expect(mediaEmits(h) == [], "audio call joins emit no camera correction")
    }

    @Test func cameraStartFailureOnEnableThrowsAndKeepsState() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall(options: PurpleCallioJoinOptions(cameraEnabled: false))
        h.media.startError = PurpleCallioInternalError("camera busy")
        do { try await meeting.enableCamera(); Issue.record("expected failure") } catch {
            assertError(error) { if case .mediaInitializationFailed = $0 { return true }; return false }
        }
        #expect(!(meeting.isCameraEnabled))
        #expect(h.signaling.count(WireEvent.cameraEnabled) == 0)
    }

    @Test func switchCameraRestartsCaptureWithoutSignaling() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        let before = h.signaling.emits.count
        try await meeting.switchCamera()
        #expect(meeting.cameraPosition == .back)
        #expect(h.media.startPositions == [.front, .back])
        try await meeting.switchCamera()
        #expect(meeting.cameraPosition == .front)
        #expect(h.signaling.emits.count == before, "not a media-state change")
    }

    @Test func screenShareIsUnavailable() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        do { try await meeting.startScreenShare(); Issue.record("expected failure") } catch {
            assertError(error) { if case .screenShareUnavailable = $0 { return true }; return false }
        }
        try await meeting.stopScreenShare()
        #expect(!(meeting.isScreenSharing))
        #expect(mediaEmits(h) == [])
    }

    // MARK: Remote media

    @Test func remoteMediaFromDedicatedEventsIgnoringOwnParticipantId() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.joinCallerInCall()
        #expect(meeting.remoteParticipant?.isCameraEnabled == true)

        // Our own echo (the server broadcasts to the sender too) is ignored.
        h.signaling.receive(WireEvent.cameraDisabled, ["callId": TestIDs.callId, "participantId": TestIDs.callerId, "media": [:]])
        #expect(meeting.remoteParticipant?.isCameraEnabled == true)
        #expect(meeting.localParticipant.isCameraEnabled)

        h.signaling.receive(WireEvent.cameraDisabled, ["callId": TestIDs.callId, "participantId": TestIDs.receiverId])
        #expect(meeting.remoteParticipant?.isCameraEnabled == false)
        h.signaling.receive(WireEvent.microphoneDisabled, ["callId": TestIDs.callId, "participantId": TestIDs.receiverId])
        #expect(meeting.remoteParticipant?.isMicrophoneEnabled == false)
        h.signaling.receive(WireEvent.screenShareStarted, ["callId": TestIDs.callId, "participantId": TestIDs.receiverId])
        #expect(meeting.remoteParticipant?.isScreenSharing == true)
        h.signaling.receive(WireEvent.cameraEnabled, ["callId": TestIDs.callId, "participantId": TestIDs.receiverId])
        #expect(meeting.remoteParticipant?.isCameraEnabled == true)
        #expect(meeting.remoteParticipant?.isMicrophoneEnabled == false, "one field per event")

        // The stale `participant.updated` snapshot is not used.
        h.signaling.receive("participant.updated", [
            "callId": TestIDs.callId, "participantId": TestIDs.receiverId,
            "media": ["camera": false, "microphone": true, "screenShare": false],
        ])
        #expect(meeting.remoteParticipant?.isCameraEnabled == true)
        #expect(meeting.remoteParticipant?.isMicrophoneEnabled == false)
        #expect(delegate.updated.filter { !$0.isLocal }.count == 4)
    }

    @Test func audioCallRemoteDefaults() async throws {
        let h = Harness()
        h.callType = .audio
        let (meeting, _) = try await h.joinReceiverInCall()
        #expect(meeting.remoteParticipant?.isCameraEnabled == false)
        #expect(meeting.remoteParticipant?.isMicrophoneEnabled == true)
        #expect(meeting.remoteParticipant?.isScreenSharing == false)
    }

    @Test func remoteVideoTrackAttachesToRemoteParticipant() async throws {
        let h = Harness()
        let (meeting, delegate) = try await h.joinCallerInCall()
        let backend = h.peer.remoteVideo()
        #expect(meeting.remoteParticipant?.videoTrack?.trackId == backend.trackId)
        #expect(delegate.remoteTracks.count == 1)
        #expect(meeting.localParticipant.videoTrack?.isLocal == true)
    }

    // MARK: Platform

    @Test func backgroundStopsCaptureAndForegroundRestoresIt() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        let emitsBefore = h.signaling.emits.count
        h.lifecycle.send(.didEnterBackground)
        await waitUntil { !h.media.isCapturing }
        #expect(!(h.media.isVideoEnabled))
        #expect(meeting.isCameraEnabled, "user intent unchanged")
        #expect(h.media.isAudioEnabled, "audio keeps running")
        h.lifecycle.send(.willEnterForeground)
        await waitUntil { h.media.isCapturing }
        #expect(h.media.isVideoEnabled)
        #expect(h.signaling.emits.count == emitsBefore, "not a user toggle: no signaling")
    }

    @Test func foregroundDoesNotRestartCameraTheUserTurnedOff() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        try await meeting.disableCamera()
        h.lifecycle.send(.didEnterBackground)
        h.lifecycle.send(.willEnterForeground)
        await settle()
        #expect(!(h.media.isCapturing))
    }

    @Test func audioInterruptionPausesAndResumesAudio() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        #expect(h.audioSession.activations == [true], "videoChat configuration for VIDEO")
        h.audioSession.send(.interruptionBegan)
        #expect(!(h.media.isAudioEnabled))
        #expect(meeting.isMicrophoneEnabled, "not a user mute")
        h.audioSession.send(.interruptionEnded(shouldResume: true))
        #expect(h.media.isAudioEnabled)
        #expect(h.audioSession.reactivations == 1)
        #expect(mediaEmits(h) == [])
    }

    @Test func appTerminationEndsCallBestEffort() async throws {
        let h = Harness()
        let (meeting, _) = try await h.joinCallerInCall()
        h.lifecycle.send(.willTerminate)
        #expect(h.signaling.count(WireEvent.callEndedDot) == 1)
        #expect(h.signaling.count(WireEvent.callEndedDash) == 1)
        #expect(h.api.detachedEnds == 1)
        #expect(meeting.connectionState == .disconnected)
        h.assertNoResidue()
    }
}
