package com.purplecallio.android

import android.content.Context
import com.purplecallio.android.internal.MeetingPlatform
import com.purplecallio.android.internal.PurpleCallioApi
import com.purplecallio.android.internal.RtcEngine
import com.purplecallio.android.internal.SignalingChannel
import com.purplecallio.android.internal.android.AndroidMeetingPlatform
import com.purplecallio.android.internal.net.HttpPurpleCallioApi
import com.purplecallio.android.internal.net.SocketIoSignalingChannel
import com.purplecallio.android.internal.rtc.WebRtcEngine
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import java.util.concurrent.CopyOnWriteArrayList

/** Everything one meeting needs; swapped for fakes in JVM tests. */
internal class MeetingDependencies(
    val signaling: SignalingChannel,
    val api: PurpleCallioApi,
    val rtc: RtcEngine,
    val platform: MeetingPlatform,
    val dispatcher: CoroutineDispatcher,
)

internal fun interface MeetingDependenciesFactory {
    fun create(logger: Logger): MeetingDependencies
}

internal data class ClientConfig(
    val baseUrl: String,
    val logLevel: PurpleCallioLogLevel,
    val logSink: PurpleCallioLogSink,
    val meetingConfig: MeetingConfig,
)

/**
 * Entry point of the SDK. Create one per app (or per call screen) and call
 * [joinMeeting] with a **participant token** that your backend obtained from
 * `POST /calls`. Never put a PurpleCallio API key in an app.
 */
class PurpleCallioClient internal constructor(
    private val config: ClientConfig,
    private val factory: MeetingDependenciesFactory,
) {
    /**
     * @param context any context; the application context is retained.
     * @param baseUrl PurpleCallio API origin, used for REST and Socket.IO.
     * @param logLevel SDK log verbosity (default [PurpleCallioLogLevel.NONE]).
     * @param iceServers extra STUN/TURN servers, merged with `/turn/credentials` and de-duplicated by URL.
     * @param overrideIceServers use only [iceServers] and skip `/turn/credentials`.
     * @param logSink where log lines go (already redacted). Defaults to logcat.
     */
    @JvmOverloads
    constructor(
        context: Context,
        baseUrl: String = DEFAULT_BASE_URL,
        logLevel: PurpleCallioLogLevel = PurpleCallioLogLevel.NONE,
        iceServers: List<PurpleCallioIceServer> = emptyList(),
        overrideIceServers: Boolean = false,
        logSink: PurpleCallioLogSink = PurpleCallioLogSink.ANDROID,
    ) : this(
        ClientConfig(baseUrl.trimEnd('/'), logLevel, logSink, MeetingConfig(iceServers, overrideIceServers)),
        androidFactory(context.applicationContext, baseUrl.trimEnd('/')),
    )

    private val logger = Logger(config.logLevel, config.logSink)
    private val meetings = CopyOnWriteArrayList<PurpleCallioMeeting>()

    @Volatile
    private var disposed = false

    /**
     * Connects, authenticates with [token] and loads the call details.
     * Returns the meeting in RINGING (a receiver sees [PurpleCallioMeeting.incomingCall]).
     *
     * @throws PurpleCallioError.InvalidToken invalid or expired token.
     * @throws PurpleCallioError.MeetingEnded the call is already over.
     * @throws PurpleCallioError.PermissionDenied CALLER without RECORD_AUDIO (or CAMERA for a video call with the camera on).
     * @throws PurpleCallioError.ConnectionFailed the server could not be reached.
     */
    suspend fun joinMeeting(
        token: String,
        options: PurpleCallioJoinOptions = PurpleCallioJoinOptions(),
    ): PurpleCallioMeeting {
        if (disposed) throw PurpleCallioError.InvalidState("PurpleCallioClient was disposed")
        if (token.isBlank()) throw PurpleCallioError.InvalidToken()
        val deps = factory.create(logger)
        val meeting = PurpleCallioMeeting(
            token = token,
            options = options,
            config = config.meetingConfig,
            signaling = deps.signaling,
            api = deps.api,
            rtc = deps.rtc,
            platform = deps.platform,
            dispatcher = deps.dispatcher,
            log = logger,
            onTerminated = { meetings.remove(it) },
        )
        meetings += meeting
        try {
            meeting.start()
        } catch (t: Throwable) {
            meetings.remove(meeting)
            throw t
        }
        return meeting
    }

    /** Test hook: meetings not yet terminated. */
    internal val activeMeetingCount: Int get() = meetings.size

    /** Disposes every meeting created by this client (no signaling). */
    fun dispose() {
        disposed = true
        meetings.toList().forEach { it.dispose() }
        meetings.clear()
    }

    companion object {
        const val DEFAULT_BASE_URL: String = "https://api.purplecallio.com"

        /** SDK version. */
        const val VERSION: String = BuildConfig.SDK_VERSION

        @OptIn(ExperimentalCoroutinesApi::class)
        internal fun engineDispatcher(): CoroutineDispatcher = Dispatchers.Default.limitedParallelism(1)

        private fun androidFactory(context: Context, baseUrl: String) = MeetingDependenciesFactory { logger ->
            MeetingDependencies(
                signaling = SocketIoSignalingChannel(baseUrl, logger),
                api = HttpPurpleCallioApi(baseUrl, logger),
                rtc = WebRtcEngine(context, logger),
                platform = AndroidMeetingPlatform(context, logger),
                dispatcher = engineDispatcher(),
            )
        }
    }
}
