package com.purplecallio.android

import com.purplecallio.android.internal.IceCandidateData
import com.purplecallio.android.internal.IceConnectionState
import com.purplecallio.android.internal.net.HttpPurpleCallioApi
import com.purplecallio.android.internal.net.SocketIoSignalingChannel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Real PurpleCallio server, real Socket.IO and REST clients from the SDK; only
 * WebRTC is faked (org.webrtc needs an Android runtime). Skipped unless
 * PURPLECALLIO_E2E_BASE_URL and PURPLECALLIO_E2E_API_KEY are set.
 *
 * The API key is used only to create the call, standing in for the customer's
 * backend. The SDK itself only ever receives participant tokens.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RealServerIntegrationTest {
    private val baseUrl = System.getenv("PURPLECALLIO_E2E_BASE_URL")
    private val apiKey = System.getenv("PURPLECALLIO_E2E_API_KEY")

    // Unique per run: the server returns the existing active call for a repeated (caller, receiver) pair.
    private val runId = System.currentTimeMillis().toString(36)

    private class Side(role: String, baseUrl: String, token: String) {
        val rec = Recorder()
        val counters = ResourceCounters()
        val rtc = FakeRtc(rec, counters).apply {
            candidatesForNewPeers = listOf(IceCandidateData("candidate:$role 1 udp 1 10.0.0.1 9 typ host", "0", 0))
        }
        val platform = FakePlatform(rec, counters)
        val meeting = PurpleCallioMeeting(
            token = token,
            options = PurpleCallioJoinOptions(),
            config = MeetingConfig(),
            signaling = SocketIoSignalingChannel(baseUrl, Logger.NONE),
            api = HttpPurpleCallioApi(baseUrl, Logger.NONE),
            rtc = rtc,
            platform = platform,
            dispatcher = Dispatchers.Default.limitedParallelism(1),
            log = Logger(PurpleCallioLogLevel.DEBUG, PurpleCallioLogSink { _, _, m, _ -> println("[$role] $m") }),
        )
    }

    private fun createCall(): Pair<String, String> {
        val body = JSONObject(mapOf("callerId" to "android-e2e-caller-$runId", "receiverId" to "android-e2e-receiver-$runId", "type" to "VIDEO"))
        val request = Request.Builder().url("$baseUrl/calls")
            .header("x-api-key", apiKey)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        OkHttpClient().newCall(request).execute().use { res ->
            check(res.isSuccessful) { "create call failed: HTTP ${res.code}" }
            val json = JSONObject(res.body!!.string())
            return json.getString("callerToken") to json.getString("receiverToken")
        }
    }

    private suspend fun until(what: String, timeoutMs: Long = 10_000, check: () -> Boolean) {
        try {
            withTimeout(timeoutMs) { while (!check()) delay(50) }
        } catch (e: Exception) {
            throw AssertionError("timed out waiting for: $what", e)
        }
    }

    @Test fun fullCallThroughTheRealServer() = runBlocking {
        assumeTrue("set PURPLECALLIO_E2E_BASE_URL / PURPLECALLIO_E2E_API_KEY", !baseUrl.isNullOrBlank() && !apiKey.isNullOrBlank())
        val (callerToken, receiverToken) = createCall()
        val caller = Side("caller", baseUrl, callerToken)
        val receiver = Side("receiver", baseUrl, receiverToken)

        caller.meeting.start()
        assertEquals(PurpleCallioRole.CALLER, caller.meeting.role)
        assertEquals(PurpleCallioConnectionState.RINGING, caller.meeting.connectionState.value)

        receiver.meeting.start()
        assertEquals(PurpleCallioRole.RECEIVER, receiver.meeting.role)
        until("incoming call") { receiver.meeting.incomingCall.value != null }
        assertEquals("android-e2e-caller-$runId", receiver.meeting.incomingCall.value!!.callerId)

        receiver.meeting.accept() // real POST /accept → server emits call-accepted to the caller

        until("offer relayed to receiver") { receiver.rtc.peers.firstOrNull()?.remoteDescriptions?.any { it.type == "offer" } == true }
        val offer = receiver.rtc.peer.remoteDescriptions.first { it.type == "offer" }
        assertEquals(caller.rtc.peer.localDescriptions.first { it.type == "offer" }.sdp, offer.sdp)
        until("answer relayed to caller") { caller.rtc.peer.remoteDescriptions.any { it.type == "answer" } }
        until("candidates relayed both ways") {
            caller.rtc.peer.addedCandidates.any { it.candidate.startsWith("candidate:receiver") } &&
                receiver.rtc.peer.addedCandidates.any { it.candidate.startsWith("candidate:caller") }
        }

        caller.rtc.peer.ice(IceConnectionState.CONNECTED)
        receiver.rtc.peer.ice(IceConnectionState.CONNECTED)
        until("both connected") {
            caller.meeting.connectionState.value == PurpleCallioConnectionState.CONNECTED &&
                receiver.meeting.connectionState.value == PurpleCallioConnectionState.CONNECTED
        }
        assertNotNull(caller.meeting.remoteParticipant.value)

        // Media state relayed by the real room broadcast, filtered by participantId.
        caller.meeting.toggleMicrophone()
        until("receiver sees caller muted") { receiver.meeting.remoteParticipant.value?.isMicrophoneEnabled == false }
        assertTrue("own broadcast ignored", caller.meeting.localParticipant.value.isMicrophoneEnabled.not())
        receiver.meeting.toggleCamera()
        until("caller sees receiver camera off") { caller.meeting.remoteParticipant.value?.isCameraEnabled == false }

        caller.meeting.leave()
        assertEquals(PurpleCallioDisconnectReason.LEFT, caller.meeting.disconnectReason.value)
        until("receiver sees remote hang-up") { receiver.meeting.connectionState.value == PurpleCallioConnectionState.DISCONNECTED }
        assertEquals(PurpleCallioDisconnectReason.REMOTE_ENDED, receiver.meeting.disconnectReason.value)
        assertFalse(receiver.meeting.connectionState.value == PurpleCallioConnectionState.FAILED)

        caller.meeting.awaitTerminated()
        receiver.meeting.awaitTerminated()
        caller.counters.assertBalanced()
        receiver.counters.assertBalanced()
    }

    @Test fun invalidTokenIsRejectedByTheRealServer() = runBlocking {
        assumeTrue(!baseUrl.isNullOrBlank() && !apiKey.isNullOrBlank())
        val side = Side("bogus", baseUrl, "definitely-not-a-valid-token")
        try {
            side.meeting.start()
            throw AssertionError("expected InvalidToken")
        } catch (e: PurpleCallioError.InvalidToken) {
            // expected: auth-error INVALID_TOKEN / { success: false }
        }
        side.counters.assertBalanced()
    }
}
