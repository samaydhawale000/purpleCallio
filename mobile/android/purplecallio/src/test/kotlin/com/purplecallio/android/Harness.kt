package com.purplecallio.android

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent

const val TOKEN = "tok-SECRET-123"

/** One meeting wired to fakes on the test scheduler (virtual time). */
@OptIn(ExperimentalCoroutinesApi::class)
internal class Harness(
    val test: TestScope,
    val role: PurpleCallioRole = PurpleCallioRole.CALLER,
    val options: PurpleCallioJoinOptions = PurpleCallioJoinOptions(),
    callType: PurpleCallioCallType = PurpleCallioCallType.VIDEO,
    status: String = "RINGING",
    val callId: String = "call-1",
    config: MeetingConfig = MeetingConfig(),
    val logger: Logger = Logger.NONE,
) {
    val rec = Recorder()
    val counters = ResourceCounters()
    val signaling = FakeSignaling(rec, counters)
    val api = FakeApi(rec)
    val rtc = FakeRtc(rec, counters)
    val platform = FakePlatform(rec, counters)
    val dispatcher = StandardTestDispatcher(test.testScheduler)

    val selfId = if (role == PurpleCallioRole.CALLER) "caller-1" else "receiver-1"
    val remoteId = if (role == PurpleCallioRole.CALLER) "receiver-1" else "caller-1"

    val meeting = PurpleCallioMeeting(
        token = TOKEN,
        options = options,
        config = config,
        signaling = signaling,
        api = api,
        rtc = rtc,
        platform = platform,
        dispatcher = dispatcher,
        log = logger,
    )

    init {
        api.details = api.details.copy(callId = callId, type = callType, status = status, participantId = selfId)
        signaling.authAck = { mapOf("success" to true, "role" to role.name) }
        signaling.onAuthenticate = { s ->
            s.server("connected", mapOf("callId" to callId, "participantId" to selfId, "role" to role.name))
            if (role == PurpleCallioRole.RECEIVER && status == "RINGING") {
                s.server(
                    "incoming-call",
                    mapOf("callId" to callId, "callerId" to "caller-1", "callerName" to "Alice", "callerAvatar" to null, "type" to callType.name),
                )
            }
        }
    }

    suspend fun join(): PurpleCallioMeeting {
        meeting.start()
        return meeting
    }

    /** Server → client event, then run everything that became runnable. */
    fun server(event: String, payload: Map<String, Any?>? = null) {
        signaling.server(event, payload)
        test.runCurrent()
    }

    /** Brings a caller all the way to CONNECTED. */
    suspend fun connectAsCaller() {
        join()
        server("call-accepted", mapOf("callId" to callId))
        server("answer", mapOf("answer" to mapOf("type" to "answer", "sdp" to "v=0 remote-answer")))
        rtc.peer.ice(com.purplecallio.android.internal.IceConnectionState.CONNECTED)
        test.runCurrent()
    }

    /** Brings a receiver all the way to CONNECTED. */
    suspend fun connectAsReceiver() {
        join()
        meeting.accept()
        server("offer", mapOf("offer" to mapOf("type" to "offer", "sdp" to "v=0 remote-offer")))
        rtc.peer.ice(com.purplecallio.android.internal.IceConnectionState.CONNECTED)
        test.runCurrent()
    }

    fun emits(): List<String> = signaling.emitNames()
}
