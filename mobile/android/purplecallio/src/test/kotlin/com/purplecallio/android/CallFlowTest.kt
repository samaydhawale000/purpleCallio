package com.purplecallio.android

import com.purplecallio.android.internal.IceCandidateData
import com.purplecallio.android.internal.IceConnectionState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AuthenticationTest {
    @Test fun authenticatesWithAckAndTakesCallIdFromConnected() = runTest {
        val h = Harness(this, callId = "call-from-server")
        h.join()
        assertEquals("call-from-server", h.meeting.callId)
        assertEquals(PurpleCallioConnectionState.RINGING, h.meeting.connectionState.value)
        assertEquals(mapOf("token" to TOKEN), h.signaling.emitted("authenticate").single())
    }

    @Test fun rejectedAckThrowsInvalidToken() = runTest {
        val h = Harness(this)
        h.signaling.authAck = { mapOf("success" to false) }
        try {
            h.join(); fail("expected InvalidToken")
        } catch (e: PurpleCallioError.InvalidToken) {
            // expected
        }
        assertEquals(PurpleCallioConnectionState.FAILED, h.meeting.connectionState.value)
        h.counters.assertBalanced()
    }

    @Test fun missingAckTimesOutAsAuthenticationFailed() = runTest {
        val h = Harness(this)
        h.signaling.authAck = null
        try {
            h.join(); fail("expected a failure")
        } catch (e: PurpleCallioError) {
            assertTrue("got $e", e is PurpleCallioError.AuthenticationFailed || e is PurpleCallioError.ConnectionFailed)
        }
    }

    @Test fun authErrorTokenExpiredIsTerminalAndDisconnects() = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        h.server("auth-error", mapOf("code" to "TOKEN_EXPIRED"))
        assertEquals(PurpleCallioConnectionState.FAILED, h.meeting.connectionState.value)
        assertTrue(h.meeting.error.value is PurpleCallioError.InvalidToken)
        assertTrue(h.signaling.disconnectCalled)
        h.counters.assertBalanced()
    }

    @Test fun authErrorRateLimitedIsConnectionFailed() = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        h.server("auth-error", mapOf("code" to "SOCKET_RATE_LIMITED"))
        assertTrue(h.meeting.error.value is PurpleCallioError.ConnectionFailed)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class CallFlowTest {
    @Test fun callerWaitsForAcceptThenJoinOfferCallStartedInOrder() = runTest {
        val h = Harness(this)
        h.join()
        runCurrent()
        assertFalse(h.rec.has("emit:join-call"))
        assertFalse(h.rec.has("emit:offer"))
        h.server("call-accepted", mapOf("callId" to "call-1"))
        val join = h.rec.indexOf("emit:join-call")
        val offer = h.rec.indexOf("emit:offer")
        val started = h.rec.indexOf("emit:call.started")
        assertTrue("order: ${h.rec.snapshot()}", join in 0 until offer && offer < started)
        assertEquals(PurpleCallioConnectionState.JOINING, h.meeting.connectionState.value)
    }

    @Test fun callerProceedsImmediatelyWhenCallAlreadyAccepted() = runTest {
        val h = Harness(this, status = "ACCEPTED")
        h.join()
        runCurrent()
        assertTrue(h.rec.has("emit:offer"))
        assertEquals(1, h.signaling.emitted("call.started").size)
    }

    @Test fun receiverAcquiresMediaBeforeAcceptThenJoinsInOrder() = runTest {
        val h = Harness(this, role = PurpleCallioRole.RECEIVER)
        h.join()
        assertNotNull(h.meeting.incomingCall.value)
        h.meeting.accept()
        runCurrent()
        val s = h.rec.snapshot()
        val media = s.indexOf("rtc:createAudioTrack")
        val accept = s.indexOf("api:accept")
        val join = s.indexOf("api:join")
        val joinCall = s.indexOf("emit:join-call")
        val started = s.indexOf("emit:call.started")
        assertTrue("order: $s", media in 0 until accept && accept < join && join < joinCall && joinCall < started)
        assertFalse("receiver never offers", h.rec.has("emit:offer"))
    }

    @Test fun receiverAnswersOfferAndFlushesEarlyCandidates() = runTest {
        val h = Harness(this, role = PurpleCallioRole.RECEIVER)
        h.join()
        h.meeting.accept()
        runCurrent()
        val candidate = mapOf("candidate" to mapOf("candidate" to "candidate:1 early", "sdpMid" to "0", "sdpMLineIndex" to 0))
        h.server("ice-candidate", candidate)
        assertTrue("queued until remote description", h.rtc.peer.addedCandidates.isEmpty())
        h.server("offer", mapOf("offer" to mapOf("type" to "offer", "sdp" to "v=0 remote")))
        assertEquals(listOf("candidate:1 early"), h.rtc.peer.addedCandidates.map(IceCandidateData::candidate))
        assertEquals("answer", (h.signaling.emitted("answer").single()?.get("answer") as Map<*, *>)["type"])
    }

    /**
     * Race found against the real server: the caller's offer can arrive while
     * the receiver is still in POST /join, i.e. before its join-call. The
     * gateway drops signaling from sockets not yet in the room, so the answer
     * (and candidates) must be held until join-call.
     */
    @Test fun receiverHoldsAnswerAndCandidatesUntilJoinCall() = runTest {
        val h = Harness(this, role = PurpleCallioRole.RECEIVER)
        h.rtc.candidatesForNewPeers = listOf(IceCandidateData("candidate:local", "0", 0))
        h.join()
        h.api.onPost = { action ->
            if (action == com.purplecallio.android.internal.CallAction.ACCEPT) {
                h.signaling.server("offer", mapOf("offer" to mapOf("type" to "offer", "sdp" to "v=0 early-offer")))
            }
        }
        h.api.postDelayMs[com.purplecallio.android.internal.CallAction.JOIN] = 1_000
        h.meeting.accept()
        runCurrent()
        val names = h.emits()
        val joinCall = names.indexOf("join-call")
        assertTrue("answer sent: $names", names.contains("answer"))
        assertTrue("answer after join-call: $names", joinCall in 0 until names.indexOf("answer"))
        assertTrue("candidate after join-call: $names", joinCall < names.indexOf("ice-candidate"))
    }

    /**
     * The gateway's join-call re-checks the call in the database before adding
     * the socket to the room, so an offer sent right after emitting join-call
     * can still be dropped. Nothing that needs the room goes out before the ack.
     */
    @Test fun callerOfferWaitsForTheJoinCallAck() = runTest {
        val h = Harness(this, options = PurpleCallioJoinOptions(microphoneEnabled = false))
        h.join()
        h.signaling.holdJoinAck = true
        h.server("call-accepted", mapOf("callId" to "call-1"))
        assertTrue(h.emits().contains("join-call"))
        assertFalse("offer held until the ack: ${h.emits()}", h.emits().contains("offer"))
        assertFalse("media correction held until the ack", h.emits().contains("microphone.disabled"))
        h.signaling.releaseJoinAck()
        runCurrent()
        val names = h.emits()
        assertTrue(names.indexOf("join-call") < names.indexOf("offer"))
        assertTrue(names.contains("microphone.disabled"))
    }

    @Test fun joinCallWithoutAnAckProceedsAfterTheTimeout() = runTest {
        val h = Harness(this)
        h.join()
        h.signaling.joinCallAck = null // an old server that never acks
        h.server("call-accepted", mapOf("callId" to "call-1"))
        assertFalse(h.emits().contains("offer"))
        advanceTimeBy(10_100); runCurrent()
        assertTrue(h.emits().contains("offer"))
    }

    @Test fun rejectPostsRejectAndEndsRejected() = runTest {
        val h = Harness(this, role = PurpleCallioRole.RECEIVER)
        h.join()
        h.meeting.reject()
        runCurrent()
        assertEquals(1, h.api.posted(com.purplecallio.android.internal.CallAction.REJECT))
        assertEquals(PurpleCallioDisconnectReason.REJECTED, h.meeting.disconnectReason.value)
        h.counters.assertBalanced()
    }

    @Test fun ringingCallerLeaveCancels() = runTest {
        val h = Harness(this)
        h.join()
        h.meeting.leave()
        assertEquals(1, h.api.posted(com.purplecallio.android.internal.CallAction.CANCEL))
        assertEquals(0, h.api.posted(com.purplecallio.android.internal.CallAction.END))
        assertEquals(PurpleCallioDisconnectReason.LEFT, h.meeting.disconnectReason.value)
        h.counters.assertBalanced()
    }

    @Test fun iceConnectedMeansConnected() = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        assertEquals(PurpleCallioConnectionState.CONNECTED, h.meeting.connectionState.value)
        assertNotNull(h.meeting.remoteParticipant.value)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class MediaStateTest {
    @Test fun toggleFlipsAndRedundantEnableEmitsNothing() = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        assertTrue(h.meeting.isMicrophoneEnabled.value)
        h.meeting.enableMicrophone() // already on
        runCurrent()
        assertEquals(0, h.signaling.emitted("microphone.enabled").size)
        h.meeting.toggleMicrophone() // unmuted → muted
        runCurrent()
        assertFalse(h.meeting.isMicrophoneEnabled.value)
        assertFalse(h.rtc.audio!!.trackEnabled)
        h.meeting.toggleMicrophone() // muted → unmuted
        runCurrent()
        assertTrue(h.meeting.isMicrophoneEnabled.value)
        h.meeting.toggleMicrophone()
        runCurrent()
        assertEquals(listOf("microphone.disabled", "microphone.enabled", "microphone.disabled"),
            h.emits().filter { it.startsWith("microphone.") })
    }

    @Test fun toggleCameraActuallyTogglesAndReleasesCapture() = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        assertTrue(h.meeting.isCameraEnabled.value)
        h.meeting.toggleCamera()
        runCurrent()
        assertFalse(h.meeting.isCameraEnabled.value)
        assertFalse(h.rtc.camera!!.isCapturing)
        h.meeting.toggleCamera()
        runCurrent()
        assertTrue(h.meeting.isCameraEnabled.value)
        assertTrue(h.rtc.camera!!.isCapturing)
        assertEquals(listOf("camera.disabled", "camera.enabled"), h.emits().filter { it.startsWith("camera.") })
    }

    @Test fun joiningMutedEmitsOnlyDisabledOnceAfterJoinCall() = runTest {
        val h = Harness(this, options = PurpleCallioJoinOptions(microphoneEnabled = false, cameraEnabled = false))
        h.connectAsCaller()
        val names = h.emits()
        assertEquals(1, names.count { it == "microphone.disabled" })
        assertEquals(1, names.count { it == "camera.disabled" })
        assertTrue(names.indexOf("join-call") < names.indexOf("microphone.disabled"))
        assertFalse(names.any { it.endsWith(".enabled") })
    }

    @Test fun joiningWithDefaultsEmitsNoMediaEvents() = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        assertFalse(h.emits().any { it.startsWith("camera.") || it.startsWith("microphone.") })
    }

    @Test fun switchCameraFlipsPositionWithoutSignaling() = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        val before = h.emits().size
        h.meeting.switchCamera()
        runCurrent()
        assertEquals(PurpleCallioCameraPosition.BACK, h.meeting.cameraPosition.value)
        assertEquals(before, h.emits().size)
    }

    @Test fun remoteMediaEventsIgnoreOwnParticipantId() = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        h.server("microphone.disabled", mapOf("callId" to "call-1", "participantId" to h.selfId))
        assertTrue(h.meeting.remoteParticipant.value!!.isMicrophoneEnabled)
        h.server("microphone.disabled", mapOf("callId" to "call-1", "participantId" to h.remoteId))
        assertFalse(h.meeting.remoteParticipant.value!!.isMicrophoneEnabled)
        h.server("camera.disabled", mapOf("callId" to "call-1", "participantId" to h.remoteId))
        assertFalse(h.meeting.remoteParticipant.value!!.isCameraEnabled)
    }

    @Test fun cameraOperationsOnAudioCallThrowInvalidState() = runTest {
        val h = Harness(this, callType = PurpleCallioCallType.AUDIO)
        h.connectAsCaller()
        try {
            h.meeting.toggleCamera(); fail("expected InvalidState")
        } catch (e: PurpleCallioError.InvalidState) {
            // expected
        }
    }

    @Test fun microphonePermissionDeniedIsTyped() = runTest {
        val h = Harness(this)
        h.platform.granted.remove(PurpleCallioPermissionKind.MICROPHONE)
        try {
            h.join(); fail("expected PermissionDenied")
        } catch (e: PurpleCallioError.PermissionDenied) {
            assertEquals(PurpleCallioPermissionKind.MICROPHONE, e.kind)
        }
        h.counters.assertBalanced()
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class RecoveryTest {
    @Test fun socketDropReconnectsReauthenticatesAndRejoins() = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        h.signaling.drop()
        runCurrent()
        assertEquals(PurpleCallioConnectionState.RECONNECTING, h.meeting.connectionState.value)
        h.signaling.reconnect()
        runCurrent()
        assertEquals(2, h.signaling.emitted("authenticate").size)
        assertEquals(2, h.signaling.emitted("join-call").size)
        val names = h.emits()
        assertTrue(names.lastIndexOf("authenticate") < names.lastIndexOf("join-call"))
        assertEquals(PurpleCallioConnectionState.CONNECTED, h.meeting.connectionState.value)
    }

    @Test fun callerRestartsIceThreeSecondsAfterDisconnected() = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        h.rtc.peer.ice(IceConnectionState.DISCONNECTED)
        runCurrent()
        assertEquals(PurpleCallioConnectionState.RECONNECTING, h.meeting.connectionState.value)
        advanceTimeBy(2_900); runCurrent()
        assertEquals(0, h.rtc.peer.iceRestarts)
        advanceTimeBy(200); runCurrent()
        assertEquals(1, h.rtc.peer.iceRestarts)
        h.rtc.peer.ice(IceConnectionState.CONNECTED)
        runCurrent()
        assertEquals(PurpleCallioConnectionState.CONNECTED, h.meeting.connectionState.value)
    }

    @Test fun receiverNeverRestartsIce() = runTest {
        val h = Harness(this, role = PurpleCallioRole.RECEIVER)
        h.connectAsReceiver()
        h.rtc.peer.ice(IceConnectionState.FAILED)
        advanceTimeBy(5_000); runCurrent()
        assertEquals(0, h.rtc.peer.iceRestarts)
    }

    @Test fun watchdogFailsAfterFifteenSeconds() = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        h.rtc.peer.ice(IceConnectionState.FAILED)
        advanceTimeBy(14_900); runCurrent()
        assertEquals(PurpleCallioConnectionState.RECONNECTING, h.meeting.connectionState.value)
        advanceTimeBy(200); runCurrent()
        assertEquals(PurpleCallioConnectionState.FAILED, h.meeting.connectionState.value)
        h.counters.assertBalanced()
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class EndingTest {
    private fun ended(reasonEvent: String, payload: Map<String, Any?>?, expected: PurpleCallioDisconnectReason) = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        h.server(reasonEvent, payload)
        h.signaling.drop("io server disconnect") // the server force-disconnects right after
        runCurrent()
        assertEquals(PurpleCallioConnectionState.DISCONNECTED, h.meeting.connectionState.value)
        assertEquals(expected, h.meeting.disconnectReason.value)
        assertNull(h.meeting.error.value)
        assertEquals("no hang-up on a remote end", 0, h.api.posted(com.purplecallio.android.internal.CallAction.END))
        h.counters.assertBalanced()
    }

    @Test fun remoteHangupDash() = ended("call-ended", null, PurpleCallioDisconnectReason.REMOTE_ENDED)
    @Test fun serverCallEndedDot() = ended("call.ended", mapOf("callId" to "call-1"), PurpleCallioDisconnectReason.REMOTE_ENDED)
    @Test fun serverCallExpired() = ended("call.expired", mapOf("callId" to "call-1"), PurpleCallioDisconnectReason.EXPIRED)
    @Test fun sessionReplaced() = ended("session-replaced", mapOf("callId" to "call-1"), PurpleCallioDisconnectReason.SESSION_REPLACED)

    @Test fun leaveInCallHangsUpAndReleasesEverything() = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        h.meeting.leave()
        val s = h.rec.snapshot()
        assertTrue(s.indexOf("emit:call.ended") in 0 until s.indexOf("emit:call-ended"))
        assertTrue(s.indexOf("api:leave") < s.indexOf("api:end"))
        assertEquals(PurpleCallioDisconnectReason.LEFT, h.meeting.disconnectReason.value)
        assertTrue(h.signaling.disconnectCalled)
        assertFalse(h.signaling.hasHandlers())
        assertTrue(h.rtc.peer.closed)
        h.counters.assertBalanced()
        h.meeting.leave() // idempotent
        assertEquals(1, h.api.posted(com.purplecallio.android.internal.CallAction.END))
    }

    @Test fun participantLeftDoesNotEndTheCall() = runTest {
        val h = Harness(this)
        h.connectAsCaller()
        h.server("participant.left", mapOf("callId" to "call-1", "participantId" to h.remoteId))
        assertFalse(h.meeting.connectionState.value.isTerminal)
    }

    @Test fun refusedJoinCallFailsWithoutEndingTheCall() = runTest {
        val h = Harness(this)
        h.join()
        h.signaling.joinCallAck = mapOf("success" to false, "error" to "PLAYGROUND_PARTICIPANT_LIMIT")
        h.server("call-accepted", mapOf("callId" to "call-1"))
        runCurrent()
        assertEquals(PurpleCallioConnectionState.FAILED, h.meeting.connectionState.value)
        assertTrue(h.meeting.error.value is PurpleCallioError.SignalingFailed)
        assertEquals(0, h.api.posted(com.purplecallio.android.internal.CallAction.END))
        h.counters.assertBalanced()
    }

    @Test fun joinLeaveJoinLeaveLeavesNoResidue() = runTest {
        repeat(2) {
            val h = Harness(this)
            h.connectAsCaller()
            h.meeting.leave()
            runCurrent()
            h.counters.assertBalanced()
            assertEquals(0, h.meeting.activeJobCount)
        }
    }
}

class SupportTest {
    @Test fun iceServersMergeCustomFirstAndDeduplicate() {
        val custom = listOf(PurpleCallioIceServer("turn:mine.example:3478", "u", "p"))
        val backend = listOf(PurpleCallioIceServer("TURN:mine.example:3478"), PurpleCallioIceServer("stun:stun.l.google.com:19302"))
        val merged = com.purplecallio.android.internal.IceServers.merge(custom, backend, false)
        assertEquals(listOf("turn:mine.example:3478", "stun:stun.l.google.com:19302"), merged.flatMap { it.urls })
        assertEquals("p", merged.first().credential)
        assertEquals(custom, com.purplecallio.android.internal.IceServers.merge(custom, backend, true))
    }

    @Test fun debugLoggingNeverContainsTheToken() = kotlinx.coroutines.test.runTest {
        val lines = ArrayList<String>()
        val logger = Logger(PurpleCallioLogLevel.DEBUG, PurpleCallioLogSink { _, _, m, _ -> lines += m })
        val h = Harness(this, logger = logger)
        h.connectAsCaller()
        h.meeting.leave()
        assertTrue(lines.isNotEmpty())
        assertTrue(lines.none { it.contains(TOKEN) })
    }
}
