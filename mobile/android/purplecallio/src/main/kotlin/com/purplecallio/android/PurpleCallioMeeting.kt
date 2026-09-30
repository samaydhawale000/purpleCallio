package com.purplecallio.android

import android.content.Intent
import com.purplecallio.android.internal.ApiException
import com.purplecallio.android.internal.CallAction
import com.purplecallio.android.internal.CallDetails
import com.purplecallio.android.internal.IceCandidateData
import com.purplecallio.android.internal.IceConnectionState
import com.purplecallio.android.internal.IceServers
import com.purplecallio.android.internal.LocalAudioTrack
import com.purplecallio.android.internal.LocalCameraTrack
import com.purplecallio.android.internal.LocalScreenTrack
import com.purplecallio.android.internal.MeetingPlatform
import com.purplecallio.android.internal.Payload
import com.purplecallio.android.internal.PurpleCallioApi
import com.purplecallio.android.internal.RtcEngine
import com.purplecallio.android.internal.RtcPeer
import com.purplecallio.android.internal.RtcPeerObserver
import com.purplecallio.android.internal.SessionDescriptionData
import com.purplecallio.android.internal.SignalingChannel
import com.purplecallio.android.internal.SignalingListener
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.util.concurrent.TimeoutException
import kotlin.coroutines.resume

/** Timings from PROTOCOL.md (overridable only in tests). */
internal data class MeetingTimings(
    val authTimeoutMs: Long = 10_000,
    val joinTimeoutMs: Long = 20_000,
    val iceRestartDelayMs: Long = 3_000,
    val iceWatchdogMs: Long = 15_000,
)

internal data class MeetingConfig(
    val customIceServers: List<PurpleCallioIceServer> = emptyList(),
    val overrideIceServers: Boolean = false,
    val timings: MeetingTimings = MeetingTimings(),
)

/**
 * One 1:1 PurpleCallio call. Obtain one from [PurpleCallioClient.joinMeeting].
 *
 * All state is exposed as [StateFlow]s and every mutation happens on one
 * serialized coroutine context, so it is safe to call any method from any
 * thread. The meeting is not tied to an Activity: keep it in a ViewModel or
 * a service so it survives configuration changes.
 */
class PurpleCallioMeeting internal constructor(
    private val token: String,
    private val options: PurpleCallioJoinOptions,
    private val config: MeetingConfig,
    private val signaling: SignalingChannel,
    private val api: PurpleCallioApi,
    private val rtc: RtcEngine,
    private val platform: MeetingPlatform,
    private val dispatcher: CoroutineDispatcher,
    private val log: Logger,
    private val onTerminated: (PurpleCallioMeeting) -> Unit = {},
) {
    private val supervisor = SupervisorJob()
    private val scope = CoroutineScope(
        supervisor + dispatcher + CoroutineExceptionHandler { _, t ->
            log.e(t) { "Unhandled error in meeting engine" }
        },
    )
    private val timings = config.timings

    // ------------------------------------------------------------ public state

    private val _connectionState = MutableStateFlow(PurpleCallioConnectionState.IDLE)
    private val _disconnectReason = MutableStateFlow<PurpleCallioDisconnectReason?>(null)
    private val _error = MutableStateFlow<PurpleCallioError?>(null)
    private val _incomingCall = MutableStateFlow<PurpleCallioIncomingCall?>(null)
    private val _microphoneEnabled = MutableStateFlow(options.microphoneEnabled)
    private val _cameraEnabled = MutableStateFlow(false)
    private val _screenSharing = MutableStateFlow(false)
    private val _cameraPosition = MutableStateFlow(options.cameraPosition)
    private val _localParticipant = MutableStateFlow(
        PurpleCallioParticipant("", null, null, PurpleCallioRole.CALLER, true, options.microphoneEnabled, false, false, null),
    )
    private val _remoteParticipant = MutableStateFlow<PurpleCallioParticipant?>(null)
    private val _participants = MutableStateFlow(listOf(_localParticipant.value))
    private val _events = MutableSharedFlow<PurpleCallioEvent>(extraBufferCapacity = 256)

    /** `idle, connecting, ringing, joining, connected, reconnecting, disconnected, failed`. */
    val connectionState: StateFlow<PurpleCallioConnectionState> = _connectionState.asStateFlow()

    /** Set when [connectionState] is DISCONNECTED. */
    val disconnectReason: StateFlow<PurpleCallioDisconnectReason?> = _disconnectReason.asStateFlow()

    /** The last error (set when [connectionState] is FAILED, and for non-fatal errors). */
    val error: StateFlow<PurpleCallioError?> = _error.asStateFlow()

    /** RECEIVER only: the ringing call, from the server's `incoming-call`. */
    val incomingCall: StateFlow<PurpleCallioIncomingCall?> = _incomingCall.asStateFlow()

    val isMicrophoneEnabled: StateFlow<Boolean> = _microphoneEnabled.asStateFlow()
    val isCameraEnabled: StateFlow<Boolean> = _cameraEnabled.asStateFlow()
    val isScreenSharing: StateFlow<Boolean> = _screenSharing.asStateFlow()
    val cameraPosition: StateFlow<PurpleCallioCameraPosition> = _cameraPosition.asStateFlow()

    /** Always present. */
    val localParticipant: StateFlow<PurpleCallioParticipant> = _localParticipant.asStateFlow()

    /** Present once the call is accepted; null before that and after they leave. */
    val remoteParticipant: StateFlow<PurpleCallioParticipant?> = _remoteParticipant.asStateFlow()

    /** `[local] + [remote?]`. */
    val participants: StateFlow<List<PurpleCallioParticipant>> = _participants.asStateFlow()

    /** Hot stream of [PurpleCallioEvent]s (not replayed; use the StateFlows for current state). */
    val events: SharedFlow<PurpleCallioEvent> = _events.asSharedFlow()

    /** From the server's `connected` event. Valid once [PurpleCallioClient.joinMeeting] returned. */
    val callId: String get() = _callId ?: ""

    /** Valid once [PurpleCallioClient.joinMeeting] returned. */
    val role: PurpleCallioRole get() = _role ?: PurpleCallioRole.CALLER

    /** Valid once [PurpleCallioClient.joinMeeting] returned. */
    val callType: PurpleCallioCallType get() = _callType ?: PurpleCallioCallType.AUDIO

    // ------------------------------------------------------------ engine state (engine context only)

    private var _callId: String? = null
    private var _role: PurpleCallioRole? = null
    private var _callType: PurpleCallioCallType? = null
    private var selfParticipantId: String? = null
    private var details: CallDetails? = null
    private var iceServers: List<PurpleCallioIceServer> = IceServers.FALLBACK

    private val firstAuth = CompletableDeferred<Unit>()
    private var authJob: Job? = null
    private var lastConnectError: Throwable? = null
    private var socketDown = false
    private var stateBeforeReconnect: PurpleCallioConnectionState? = null

    private var callerAcceptedSignal = false
    private var ringingReady = false
    private var callSetupStarted = false
    private var accepting = false
    private var inRoom = false

    /**
     * offer/answer/ice-candidate held until this socket has emitted `join-call`:
     * the gateway silently drops signaling from sockets that are not in the room
     * (PROTOCOL.md). The receiver's answer can be ready before its `join-call`.
     */
    private val pendingSignals = ArrayList<Pair<String, Payload>>()

    private fun emitSignal(event: String, payload: Payload) {
        if (inRoom && signaling.isConnected) signaling.emit(event, payload) else pendingSignals += event to payload
    }

    private fun flushPendingSignals() {
        if (pendingSignals.isEmpty()) return
        val queued = pendingSignals.toList()
        pendingSignals.clear()
        log.d { "Sending ${queued.size} signaling message(s) held until join-call" }
        queued.forEach { (event, payload) -> signaling.emit(event, payload) }
    }
    private var joinedOnce = false

    private var audioTrack: LocalAudioTrack? = null
    private var cameraTrack: LocalCameraTrack? = null
    private var screenTrack: LocalScreenTrack? = null
    private var mediaAcquired = false
    private var audioSessionStarted = false
    private var screenServiceStarted = false
    private var inForeground = true
    private var lifecycleHandle: AutoCloseable? = null

    private var peer: RtcPeer? = null
    private val negotiation = Mutex()
    private var remoteDescriptionSet = false
    private val pendingCandidates = ArrayList<IceCandidateData>()
    private var iceState = IceConnectionState.NEW
    private var restartJob: Job? = null
    private var watchdogJob: Job? = null
    private var pendingIceRestart = false
    private var transportReported = false
    private var iceSuccessReported = false
    private var iceFailureReported = false

    private var remotePresent = false
    private var remoteCamera = false
    private var remoteMicrophone = true
    private var remoteScreenShare = false
    private var remoteVideo: PurpleCallioVideoTrack? = null

    private var ending = false
    private var terminated = false
    private var leaveDeferred: Deferred<Unit>? = null
    private val terminatedSignal = CompletableDeferred<Unit>()

    private val callIdPayload: Payload get() = mapOf("callId" to callId)

    // ================================================================ join

    /** Connects, authenticates and loads details. Called by [PurpleCallioClient.joinMeeting]. */
    internal suspend fun start() {
        try {
            withContext(dispatcher) { startOnEngine() }
        } catch (t: Throwable) {
            val error = when (t) {
                is PurpleCallioError -> t
                is CancellationException -> null
                else -> PurpleCallioError.ConnectionFailed(t)
            }
            withContext(NonCancellable + dispatcher) {
                when {
                    error is PurpleCallioError.MeetingEnded ->
                        terminate(PurpleCallioConnectionState.DISCONNECTED, error.reason, null, Hangup.NONE)
                    error != null -> terminate(PurpleCallioConnectionState.FAILED, null, error, Hangup.NONE)
                    else -> terminate(PurpleCallioConnectionState.DISCONNECTED, PurpleCallioDisconnectReason.LEFT, null, Hangup.NONE)
                }
            }
            throw error ?: t
        }
    }

    private suspend fun startOnEngine() {
        if (token.isBlank()) throw PurpleCallioError.InvalidToken()
        setState(PurpleCallioConnectionState.CONNECTING)
        registerSignalingHandlers()
        log.i { "Connecting to signaling" }
        signaling.connect()

        try {
            withTimeout(timings.joinTimeoutMs) { firstAuth.await() }
        } catch (e: TimeoutCancellationException) {
            throw PurpleCallioError.ConnectionFailed(lastConnectError ?: TimeoutException("Could not connect and authenticate in time"))
        }
        ensureLive()
        val id = _callId ?: throw PurpleCallioError.AuthenticationFailed("server did not send 'connected'")

        val loaded: CallDetails = coroutineScope {
            val ice = async { resolveIceServers() }
            val d = try {
                api.callDetails(id, token)
            } catch (e: Throwable) {
                throw mapApiError(e)
            }
            iceServers = ice.await()
            d
        }
        ensureLive()
        details = loaded
        _callType = loaded.type
        if (selfParticipantId == null) selfParticipantId = loaded.participantId
        _cameraEnabled.value = loaded.type == PurpleCallioCallType.VIDEO && options.cameraEnabled
        publishLocal()

        terminalReasonForStatus(loaded.status)?.let { throw PurpleCallioError.MeetingEnded(it) }

        lifecycleHandle = platform.observeAppLifecycle(
            onBackground = { scope.launch { onAppBackground() } },
            onForeground = { scope.launch { onAppForeground() } },
        )

        if (role == PurpleCallioRole.CALLER) {
            platform.startAudioSession(callType == PurpleCallioCallType.VIDEO)
            audioSessionStarted = true
            acquireLocalMedia()
            ensureLive()
            setState(PurpleCallioConnectionState.RINGING)
            ringingReady = true
            if (loaded.status == "ACCEPTED" || callerAcceptedSignal) {
                scope.launch { proceedAsCaller() }
            }
        } else {
            if (_incomingCall.value == null && (loaded.status == "RINGING" || loaded.status == "INITIATED")) {
                setIncomingCall(
                    PurpleCallioIncomingCall(id, loaded.callerId, loaded.callerName, loaded.callerAvatar, loaded.type),
                )
            }
            setState(PurpleCallioConnectionState.RINGING)
            ringingReady = true
            if (loaded.status == "ACCEPTED") {
                // A receiver that already accepted (e.g. app restart) cannot resume
                // a peer connection; it has to accept again from the ringing state.
                log.w { "Call is already ACCEPTED; receiver must accept() again to rejoin" }
            }
        }
        log.i { "Joined signaling as $role for a ${callType.name} call; state=${_connectionState.value}" }
    }

    private suspend fun resolveIceServers(): List<PurpleCallioIceServer> {
        if (config.overrideIceServers) return IceServers.merge(config.customIceServers, emptyList(), true)
        val backend = try {
            api.turnCredentials(token).ifEmpty { IceServers.FALLBACK }
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            log.w { "TURN credentials unavailable, falling back to public STUN: ${e.message}" }
            IceServers.FALLBACK
        }
        return IceServers.merge(config.customIceServers, backend, false)
    }

    // ================================================================ signaling

    private fun registerSignalingHandlers() {
        signaling.listener = object : SignalingListener {
            override fun onConnect() {
                scope.launch { onSocketConnected() }
            }

            override fun onDisconnect(reason: String, serverInitiated: Boolean) {
                scope.launch { onSocketDisconnected(reason, serverInitiated) }
            }

            override fun onConnectError(cause: Throwable?) {
                scope.launch {
                    lastConnectError = cause
                    log.w { "Signaling connect error: ${cause?.message}" }
                }
            }
        }

        fun on(event: String, handler: suspend (Payload?) -> Unit) {
            signaling.on(event) { payload ->
                scope.launch {
                    if (ending || terminated) return@launch
                    try {
                        handler(payload)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Throwable) {
                        log.e(e) { "Error handling '$event'" }
                    }
                }
            }
        }

        on("connected") { p ->
            p ?: return@on
            (p["callId"] as? String)?.let { _callId = it }
            (p["participantId"] as? String)?.let { selfParticipantId = it }
            parseRole(p["role"])?.let { _role = it }
            publishLocal()
        }
        on("incoming-call") { p ->
            val id = p?.get("callId") as? String ?: _callId ?: return@on
            setIncomingCall(
                PurpleCallioIncomingCall(
                    callId = id,
                    callerId = p?.get("callerId") as? String,
                    callerName = p?.get("callerName") as? String,
                    callerAvatar = p?.get("callerAvatar") as? String,
                    type = parseCallType(p?.get("type")) ?: _callType ?: PurpleCallioCallType.AUDIO,
                ),
            )
        }
        on("call-accepted") { onCallAccepted() }
        on("call-rejected") { remoteEnded(PurpleCallioDisconnectReason.REJECTED) }
        on("call-cancelled") { remoteEnded(PurpleCallioDisconnectReason.CANCELLED) }
        on("call-missed") { remoteEnded(PurpleCallioDisconnectReason.MISSED) }
        on("call-busy") { remoteEnded(PurpleCallioDisconnectReason.BUSY) }
        on("call-ended") { remoteEnded(PurpleCallioDisconnectReason.REMOTE_ENDED) }
        // Server-side termination (PROTOCOL.md): broadcast, then a forced disconnect.
        on("call.ended") { remoteEnded(PurpleCallioDisconnectReason.REMOTE_ENDED) }
        on("call.expired") { remoteEnded(PurpleCallioDisconnectReason.EXPIRED) }
        on("session-replaced") { remoteEnded(PurpleCallioDisconnectReason.SESSION_REPLACED) }
        on("auth-error") { p -> onAuthError(p?.get("code") as? String) }
        on("offer") { p -> handleOffer(p) }
        on("answer") { p -> handleAnswer(p) }
        on("ice-candidate") { p -> handleRemoteCandidate(p) }
        on("participant.joined") { p -> onParticipantJoined(p?.get("participantId") as? String) }
        on("participant.left") { p -> onParticipantLeft(p?.get("participantId") as? String) }
        on("camera.enabled") { p -> onRemoteMedia(p, camera = true) }
        on("camera.disabled") { p -> onRemoteMedia(p, camera = false) }
        on("microphone.enabled") { p -> onRemoteMedia(p, microphone = true) }
        on("microphone.disabled") { p -> onRemoteMedia(p, microphone = false) }
        on("screenShare.started") { p -> onRemoteMedia(p, screenShare = true) }
        on("screenShare.stopped") { p -> onRemoteMedia(p, screenShare = false) }
        // participant.updated is intentionally ignored: its media snapshot is stale (PROTOCOL.md).
    }

    private fun onSocketConnected() {
        if (ending || terminated) return
        log.d { "Socket connected; authenticating" }
        authJob?.cancel()
        authJob = scope.launch { authenticate() }
    }

    private suspend fun authenticate() {
        val ack: Any? = try {
            withTimeout(timings.authTimeoutMs) {
                suspendCancellableCoroutine { cont ->
                    signaling.emitWithAck("authenticate", mapOf("token" to token)) { a ->
                        if (cont.isActive) cont.resume(a)
                    }
                }
            }
        } catch (e: TimeoutCancellationException) {
            onAuthFailed(PurpleCallioError.AuthenticationFailed("no response to 'authenticate' within ${timings.authTimeoutMs} ms"))
            return
        }
        if (ending || terminated) return
        val map = ack as? Map<*, *>
        if (map?.get("success") != true) {
            onAuthFailed(PurpleCallioError.InvalidToken())
            return
        }
        parseRole(map["role"])?.let { _role = it }
        if (!firstAuth.isCompleted) {
            log.i { "Authenticated as $_role" }
            firstAuth.complete(Unit)
        } else {
            onReauthenticated()
        }
    }

    /**
     * `auth-error` precedes a server-side disconnect and is terminal: stop
     * socket.io from reconnecting (retries count against the per-IP limit).
     */
    private suspend fun onAuthError(code: String?) {
        log.w { "Server rejected the socket: ${code ?: "UNKNOWN"}" }
        val error = when (code) {
            "INVALID_TOKEN", "TOKEN_EXPIRED" -> PurpleCallioError.InvalidToken()
            else -> PurpleCallioError.ConnectionFailed(IllegalStateException("server rejected the connection: ${code ?: "UNKNOWN"}"))
        }
        signaling.disconnect()
        onAuthFailed(error)
    }

    private suspend fun onAuthFailed(error: PurpleCallioError) {
        log.e { "Authentication failed: ${error.message}" }
        if (!firstAuth.isCompleted) {
            firstAuth.completeExceptionally(error)
        } else {
            terminate(PurpleCallioConnectionState.FAILED, null, error, Hangup.NONE)
        }
    }

    private suspend fun onReauthenticated() {
        log.i { "Re-authenticated after reconnect" }
        socketDown = false
        if (joinedOnce) {
            // The server removed us from the room when the socket dropped.
            emitJoinCall()
            if (role == PurpleCallioRole.CALLER && (pendingIceRestart || !isIceUp())) {
                pendingIceRestart = false
                scope.launch { iceRestart() }
            }
            val next = when {
                isIceUp() -> PurpleCallioConnectionState.CONNECTED
                watchdogJob?.isActive == true -> PurpleCallioConnectionState.RECONNECTING
                else -> PurpleCallioConnectionState.JOINING
            }
            setState(next)
        } else {
            setState(stateBeforeReconnect ?: PurpleCallioConnectionState.RINGING)
            // call-accepted (or a terminal event) may have been missed while we were offline.
            if (role == PurpleCallioRole.CALLER && !callSetupStarted) {
                val d = try {
                    api.callDetails(callId, token)
                } catch (e: Throwable) {
                    if (e is CancellationException) throw e
                    null
                }
                ensureLive()
                if (d != null) {
                    terminalReasonForStatus(d.status)?.let { remoteEnded(it); return }
                    if (d.status == "ACCEPTED") scope.launch { proceedAsCaller() }
                }
            }
        }
        stateBeforeReconnect = null
    }

    private suspend fun onSocketDisconnected(reason: String, serverInitiated: Boolean) {
        inRoom = false
        authJob?.cancel()
        if (ending || terminated) return
        log.w { "Socket disconnected: $reason (serverInitiated=$serverInitiated)" }
        if (!firstAuth.isCompleted) return // still joining; the join timeout decides
        if (serverInitiated) {
            // Only session-replaced is expected to do this, and it arrives first.
            terminate(
                PurpleCallioConnectionState.FAILED, null,
                PurpleCallioError.ConnectionFailed(IllegalStateException("server closed the connection")), Hangup.NONE,
            )
            return
        }
        socketDown = true
        val current = _connectionState.value
        if (current != PurpleCallioConnectionState.RECONNECTING && !current.isTerminal) {
            stateBeforeReconnect = current
            setState(PurpleCallioConnectionState.RECONNECTING)
        }
    }

    private fun setIncomingCall(call: PurpleCallioIncomingCall) {
        if (_incomingCall.value == call) return
        _incomingCall.value = call
        emitEvent(PurpleCallioEvent.IncomingCall(call))
    }

    private fun onCallAccepted() {
        if (_role == PurpleCallioRole.RECEIVER) return
        callerAcceptedSignal = true
        if (ringingReady) scope.launch { proceedAsCaller() }
    }

    // ================================================================ caller

    private suspend fun proceedAsCaller() {
        if (callSetupStarted || ending || terminated) return
        callSetupStarted = true
        try {
            log.i { "Call accepted; joining room and sending offer" }
            markRemotePresent()
            setState(PurpleCallioConnectionState.JOINING)
            createPeerWithLocalTracks()
            emitJoinCall()
            negotiation.withLock {
                val pc = peer ?: return
                val offer = pc.createOffer(iceRestart = false)
                ensureLive()
                pc.setLocalDescription(offer)
                ensureLive()
                emitSignal("offer", mapOf("offer" to offer.toPayload()))
            }
            emitSignal("call.started", callIdPayload)
        } catch (e: CancellationException) {
            throw e
        } catch (e: PurpleCallioError) {
            fail(e)
        } catch (e: Throwable) {
            fail(PurpleCallioError.WebrtcFailed(e))
        }
    }

    // ================================================================ receiver

    /**
     * RECEIVER, in RINGING: acquires media, then accepts. Throws
     * [PurpleCallioError.PermissionDenied] (the meeting stays RINGING so you
     * can request the permission and call again).
     */
    suspend fun accept() {
        runOp {
            if (role != PurpleCallioRole.RECEIVER) throw PurpleCallioError.InvalidState("Only the receiver can accept")
            if (_connectionState.value != PurpleCallioConnectionState.RINGING || accepting || callSetupStarted) {
                throw PurpleCallioError.InvalidState("accept() is only valid while ringing (state=${_connectionState.value})")
            }
            accepting = true
            try {
                if (!audioSessionStarted) {
                    platform.startAudioSession(callType == PurpleCallioCallType.VIDEO)
                    audioSessionStarted = true
                }
                acquireLocalMedia()
            } catch (e: Throwable) {
                accepting = false
                releaseLocalMedia()
                if (audioSessionStarted) {
                    platform.stopAudioSession()
                    audioSessionStarted = false
                }
                throw e
            }
            callSetupStarted = true
            try {
                // Media and peer connection BEFORE accept: the offer can arrive right after it.
                createPeerWithLocalTracks()
                markRemotePresent()
                setState(PurpleCallioConnectionState.JOINING)
                postOrThrow(CallAction.ACCEPT)
                ensureLive()
                postOrThrow(CallAction.JOIN)
                ensureLive()
                emitJoinCall()
                emitSignal("call.started", callIdPayload)
                log.i { "Accepted call" }
            } catch (e: Throwable) {
                if (e is PurpleCallioError.MeetingEnded || terminated) throw e
                val error = e as? PurpleCallioError ?: PurpleCallioError.WebrtcFailed(e)
                fail(error)
                throw error
            } finally {
                accepting = false
            }
        }
    }

    /** RECEIVER, in RINGING: declines. Ends in DISCONNECTED(REJECTED). */
    suspend fun reject() {
        runOp {
            if (role != PurpleCallioRole.RECEIVER) throw PurpleCallioError.InvalidState("Only the receiver can reject")
            if (_connectionState.value != PurpleCallioConnectionState.RINGING || callSetupStarted) {
                throw PurpleCallioError.InvalidState("reject() is only valid while ringing (state=${_connectionState.value})")
            }
            terminate(PurpleCallioConnectionState.DISCONNECTED, PurpleCallioDisconnectReason.REJECTED, null, Hangup.REJECT)
        }
    }

    // ================================================================ negotiation

    private fun createPeerWithLocalTracks() {
        if (peer != null) return
        val pc = rtc.createPeer(iceServers, peerObserver)
        peer = pc
        audioTrack?.let { pc.addTrack(it, STREAM_ID) }
        val cam = cameraTrack
        if (cam != null) {
            pc.addTrack(cam, STREAM_ID)
        } else if (callType == PurpleCallioCallType.VIDEO && role == PurpleCallioRole.CALLER) {
            // Keep a video sender so remote video, a later camera and screen share still work.
            pc.addVideoTransceiver(STREAM_ID)
        }
    }

    private val peerObserver = object : RtcPeerObserver {
        override fun onIceCandidate(candidate: IceCandidateData) {
            scope.launch {
                if (ending || terminated) return@launch
                emitSignal("ice-candidate", mapOf("candidate" to candidate.toPayload()))
            }
        }

        override fun onIceConnectionStateChanged(state: IceConnectionState) {
            scope.launch { onIceState(state) }
        }

        override fun onRemoteVideoTrack(handle: Any, id: String) {
            scope.launch {
                if (ending || terminated) return@launch
                val track = PurpleCallioVideoTrack(handle, id)
                remoteVideo = track
                publishRemote()
                _remoteParticipant.value?.let { emitEvent(PurpleCallioEvent.RemoteTrackAdded(it, track)) }
            }
        }
    }

    private suspend fun handleOffer(p: Payload?) {
        val offer = parseDescription(p?.get("offer")) ?: return
        negotiation.withLock {
            val pc = peer ?: run {
                log.w { "Offer received before the peer connection exists; ignoring" }
                return
            }
            try {
                pc.setRemoteDescription(offer)
                ensureLive()
                remoteDescriptionSet = true
                flushPendingCandidates(pc)
                val answer = pc.createAnswer()
                ensureLive()
                pc.setLocalDescription(answer)
                ensureLive()
                emitSignal("answer", mapOf("answer" to answer.toPayload()))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                fail(PurpleCallioError.WebrtcFailed(e))
            }
        }
    }

    private suspend fun handleAnswer(p: Payload?) {
        val answer = parseDescription(p?.get("answer")) ?: return
        negotiation.withLock {
            val pc = peer ?: return
            try {
                pc.setRemoteDescription(answer)
                ensureLive()
                remoteDescriptionSet = true
                flushPendingCandidates(pc)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                fail(PurpleCallioError.WebrtcFailed(e))
            }
        }
    }

    private fun handleRemoteCandidate(p: Payload?) {
        val c = parseCandidate(p?.get("candidate")) ?: return
        val pc = peer
        if (pc == null || !remoteDescriptionSet) {
            pendingCandidates += c
            return
        }
        if (!pc.addIceCandidate(c)) log.w { "addIceCandidate rejected a candidate" }
    }

    private fun flushPendingCandidates(pc: RtcPeer) {
        if (pendingCandidates.isEmpty()) return
        val queued = pendingCandidates.toList()
        pendingCandidates.clear()
        log.d { "Flushing ${queued.size} queued ICE candidate(s)" }
        for (c in queued) if (!pc.addIceCandidate(c)) log.w { "addIceCandidate (flushed) rejected a candidate" }
    }

    // ================================================================ ICE recovery

    private fun isIceUp(): Boolean = iceState == IceConnectionState.CONNECTED || iceState == IceConnectionState.COMPLETED

    private fun onIceState(state: IceConnectionState) {
        if (ending || terminated) return
        iceState = state
        log.d { "ICE state: $state" }
        when (state) {
            IceConnectionState.CONNECTED, IceConnectionState.COMPLETED -> {
                restartJob?.cancel()
                restartJob = null
                watchdogJob?.cancel()
                watchdogJob = null
                if (!socketDown) setState(PurpleCallioConnectionState.CONNECTED)
                reportIceSuccess()
            }
            IceConnectionState.DISCONNECTED -> onIceTrouble(failed = false)
            IceConnectionState.FAILED -> {
                reportIceOutcome("FAILED")
                onIceTrouble(failed = true)
            }
            else -> Unit
        }
    }

    private fun onIceTrouble(failed: Boolean) {
        val s = _connectionState.value
        if (s != PurpleCallioConnectionState.JOINING && s != PurpleCallioConnectionState.CONNECTED &&
            s != PurpleCallioConnectionState.RECONNECTING
        ) return
        if (s == PurpleCallioConnectionState.CONNECTED) setState(PurpleCallioConnectionState.RECONNECTING)

        if (watchdogJob == null) {
            watchdogJob = scope.launch {
                delay(timings.iceWatchdogMs)
                watchdogJob = null
                if (!isIceUp() && !ending && !terminated) {
                    log.e { "ICE did not recover within ${timings.iceWatchdogMs} ms" }
                    fail(PurpleCallioError.WebrtcFailed(TimeoutException("ICE did not reconnect within ${timings.iceWatchdogMs} ms")))
                }
            }
        }

        // Only the CALLER restarts ICE, to avoid offer glare.
        if (role != PurpleCallioRole.CALLER) return
        if (failed) {
            restartJob?.cancel()
            restartJob = scope.launch { iceRestart() }
        } else if (restartJob?.isActive != true) {
            restartJob = scope.launch {
                delay(timings.iceRestartDelayMs)
                iceRestart()
            }
        }
    }

    private suspend fun iceRestart() {
        if (role != PurpleCallioRole.CALLER || ending || terminated) return
        val pc = peer ?: return
        if (isIceUp()) return
        if (!inRoom) {
            pendingIceRestart = true
            return
        }
        negotiation.withLock {
            try {
                log.i { "Restarting ICE" }
                val offer = pc.createOffer(iceRestart = true)
                ensureLive()
                pc.setLocalDescription(offer)
                ensureLive()
                emitSignal("offer", mapOf("offer" to offer.toPayload()))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                log.w(e) { "ICE restart failed" }
            }
        }
    }

    private fun reportIceSuccess() {
        reportIceOutcome("SUCCESS")
        if (transportReported) return
        transportReported = true
        val pc = peer ?: return
        scope.launch {
            val type = try {
                pc.selectedLocalCandidateType()
            } catch (e: Throwable) {
                if (e is CancellationException) throw e
                null
            } ?: return@launch
            postQuietly(
                CallAction.WEBRTC_TRANSPORT,
                mapOf("transport" to if (type == "relay") "TURN" else "P2P", "candidateType" to type),
            )
        }
    }

    private fun reportIceOutcome(outcome: String) {
        if (outcome == "SUCCESS") {
            if (iceSuccessReported) return
            iceSuccessReported = true
        } else {
            if (iceFailureReported) return
            iceFailureReported = true
        }
        val ice = iceState.name.lowercase()
        scope.launch {
            postQuietly(CallAction.WEBRTC_ICE, mapOf("outcome" to outcome, "iceConnectionState" to ice, "connectionState" to ice))
        }
    }

    // ================================================================ room / media events

    /** Incremented per join-call so a late ack from a previous socket is ignored. */
    private var joinAttempt = 0
    private var joinAckTimeout: Job? = null

    private fun emitJoinCall() {
        joinedOnce = true
        val attempt = ++joinAttempt
        // The gateway adds the socket to the room only after re-checking the
        // call in the database, and relays offer/answer/ICE and media events
        // only from sockets in the room. So nothing that needs the room is sent
        // until the ack arrives (PROTOCOL.md).
        signaling.emitWithAck("join-call", callIdPayload) { ack ->
            scope.launch { onJoinCallAck(attempt, ack) }
        }
        // A server that never acks must not stall the call.
        joinAckTimeout?.cancel()
        joinAckTimeout = scope.launch {
            delay(timings.authTimeoutMs)
            if (attempt == joinAttempt && !inRoom) {
                log.w { "No join-call ack within ${timings.authTimeoutMs} ms; continuing" }
                onJoinCallAck(attempt, null)
            }
        }
    }

    private suspend fun onJoinCallAck(attempt: Int, ack: Any?) {
        if (attempt != joinAttempt || inRoom || ending || terminated) return
        if (ack != null) joinAckTimeout?.cancel()
        val map = ack as? Map<*, *>
        if (map?.get("success") == false) {
            // Refused (e.g. PLAYGROUND_PARTICIPANT_LIMIT, CALL_ENDED): we are not in
            // the room, so fail without hanging up (no POST end for the other side).
            val reason = map["error"] as? String ?: "join-call refused"
            terminate(
                PurpleCallioConnectionState.FAILED, null,
                PurpleCallioError.SignalingFailed(IllegalStateException(reason)), Hangup.NONE,
            )
            return
        }
        inRoom = true
        flushPendingSignals()
        // The server's billing defaults at join are VIDEO → camera on, mic on.
        // Only tell it where we differ, once, now that we are in the room.
        if (!_microphoneEnabled.value) emitMedia("microphone.disabled")
        if (callType == PurpleCallioCallType.VIDEO && !_cameraEnabled.value) emitMedia("camera.disabled")
        if (_screenSharing.value) emitMedia("screenShare.started")
    }

    private fun emitMedia(event: String) {
        if (!inRoom) return
        log.d { "Emitting $event" }
        signaling.emit(event, callIdPayload)
    }

    private fun onParticipantJoined(participantId: String?) {
        if (participantId == null || participantId == selfParticipantId) return
        if (!joinedOnce || remotePresent) return
        if (participantId != remoteParticipantId()) return
        // The remote re-joined (e.g. after a socket reconnect): reset to call-type defaults.
        remoteCamera = callType == PurpleCallioCallType.VIDEO
        remoteMicrophone = true
        remoteScreenShare = false
        markRemotePresent()
    }

    private fun onParticipantLeft(participantId: String?) {
        if (participantId == null || participantId == selfParticipantId) return
        if (!remotePresent) return
        val last = _remoteParticipant.value
        remotePresent = false
        publishRemote()
        log.i { "Remote participant left (the call continues; they may reconnect)" }
        last?.let { emitEvent(PurpleCallioEvent.ParticipantLeft(it)) }
    }

    private fun onRemoteMedia(p: Payload?, camera: Boolean? = null, microphone: Boolean? = null, screenShare: Boolean? = null) {
        val pid = p?.get("participantId") as? String
        if (pid == null || pid == selfParticipantId) return
        camera?.let { remoteCamera = it }
        microphone?.let { remoteMicrophone = it }
        screenShare?.let { remoteScreenShare = it }
        publishRemote()
        _remoteParticipant.value?.let { emitEvent(PurpleCallioEvent.ParticipantUpdated(it)) }
    }

    private fun markRemotePresent() {
        if (remotePresent) return
        if (!joinedOnce) {
            remoteCamera = callType == PurpleCallioCallType.VIDEO
            remoteMicrophone = true
            remoteScreenShare = false
        }
        remotePresent = true
        publishRemote()
        _remoteParticipant.value?.let { emitEvent(PurpleCallioEvent.ParticipantJoined(it)) }
    }

    private fun remoteParticipantId(): String? {
        val d = details ?: return null
        return if (role == PurpleCallioRole.CALLER) d.receiverId else d.callerId
    }

    // ================================================================ local media

    private fun acquireLocalMedia() {
        if (mediaAcquired) return
        if (!platform.hasPermission(PurpleCallioPermissionKind.MICROPHONE)) {
            throw PurpleCallioError.PermissionDenied(PurpleCallioPermissionKind.MICROPHONE)
        }
        val video = callType == PurpleCallioCallType.VIDEO
        if (video && _cameraEnabled.value && !platform.hasPermission(PurpleCallioPermissionKind.CAMERA)) {
            throw PurpleCallioError.PermissionDenied(PurpleCallioPermissionKind.CAMERA)
        }
        val audio = try {
            rtc.createAudioTrack()
        } catch (e: Throwable) {
            throw PurpleCallioError.MediaInitializationFailed(e)
        }
        audio.setEnabled(_microphoneEnabled.value)
        audioTrack = audio
        if (video) {
            var cam: LocalCameraTrack? = null
            try {
                cam = rtc.createCameraTrack(_cameraPosition.value)
                cam.onCaptureError = { t -> scope.launch { onCameraError(t) } }
                cam.setEnabled(_cameraEnabled.value)
                if (_cameraEnabled.value && inForeground) cam.startCapture()
                cameraTrack = cam
                _cameraPosition.value = cam.position
            } catch (e: Throwable) {
                // PROTOCOL: if video capture fails, fall back to audio only.
                log.w(e) { "Camera unavailable; continuing audio-only" }
                cam?.dispose()
                cameraTrack = null
                _cameraEnabled.value = false
                reportNonFatal(PurpleCallioError.MediaInitializationFailed(e))
            }
        }
        mediaAcquired = true
        publishLocal()
    }

    private fun releaseLocalMedia() {
        cameraTrack?.let {
            it.stopCapture()
            it.dispose()
        }
        cameraTrack = null
        audioTrack?.dispose()
        audioTrack = null
        mediaAcquired = false
        publishLocal()
    }

    private fun onCameraError(t: Throwable) {
        if (ending || terminated) return
        log.w(t) { "Camera error" }
        reportNonFatal(PurpleCallioError.MediaInitializationFailed(t))
        if (_cameraEnabled.value) {
            cameraTrack?.setEnabled(false)
            cameraTrack?.stopCapture()
            _cameraEnabled.value = false
            publishLocal()
            emitMedia("camera.disabled")
        }
    }

    suspend fun enableMicrophone(): Unit = runOp { setMicrophone(true) }
    suspend fun disableMicrophone(): Unit = runOp { setMicrophone(false) }

    /** Flips the current microphone state. */
    suspend fun toggleMicrophone(): Unit = runOp { setMicrophone(!_microphoneEnabled.value) }

    /** Throws [PurpleCallioError.InvalidState] on AUDIO calls. */
    suspend fun enableCamera(): Unit = runOp { setCamera(true) }
    suspend fun disableCamera(): Unit = runOp { setCamera(false) }

    /** Flips the current camera state. Throws [PurpleCallioError.InvalidState] on AUDIO calls. */
    suspend fun toggleCamera(): Unit = runOp {
        requireVideoCall()
        setCamera(!_cameraEnabled.value)
    }

    private fun setMicrophone(on: Boolean) {
        requireNotTerminal()
        if (_microphoneEnabled.value == on) return
        if (on && mediaAcquired && !platform.hasPermission(PurpleCallioPermissionKind.MICROPHONE)) {
            throw PurpleCallioError.PermissionDenied(PurpleCallioPermissionKind.MICROPHONE)
        }
        audioTrack?.setEnabled(on)
        _microphoneEnabled.value = on
        publishLocal()
        emitMedia(if (on) "microphone.enabled" else "microphone.disabled")
    }

    private fun setCamera(on: Boolean) {
        requireNotTerminal()
        requireVideoCall()
        if (_cameraEnabled.value == on) return
        if (on) {
            if (mediaAcquired) {
                if (!platform.hasPermission(PurpleCallioPermissionKind.CAMERA)) {
                    throw PurpleCallioError.PermissionDenied(PurpleCallioPermissionKind.CAMERA)
                }
                val pc = peer
                val cam = cameraTrack ?: createCameraLate().also { late ->
                    if (pc != null && !_screenSharing.value && !pc.replaceVideoTrack(late)) {
                        cameraTrack = null
                        late.dispose()
                        throw PurpleCallioError.InvalidState("No video sender in this call (the camera failed to start earlier)")
                    }
                }
                cam.setEnabled(true)
                if (!_screenSharing.value && inForeground && !cam.isCapturing) {
                    try {
                        cam.startCapture()
                    } catch (e: Throwable) {
                        cam.setEnabled(false)
                        throw PurpleCallioError.MediaInitializationFailed(e)
                    }
                }
            }
        } else {
            cameraTrack?.setEnabled(false)
            // Release the camera hardware, not just the track.
            cameraTrack?.stopCapture()
        }
        _cameraEnabled.value = on
        publishLocal()
        emitMedia(if (on) "camera.enabled" else "camera.disabled")
    }

    private fun createCameraLate(): LocalCameraTrack {
        val cam = try {
            rtc.createCameraTrack(_cameraPosition.value)
        } catch (e: Throwable) {
            throw PurpleCallioError.MediaInitializationFailed(e)
        }
        cam.onCaptureError = { t -> scope.launch { onCameraError(t) } }
        cameraTrack = cam
        return cam
    }

    /** Front ↔ back. Needs a camera track. No signaling event. */
    suspend fun switchCamera(): Unit = runOp {
        requireNotTerminal()
        requireVideoCall()
        val cam = cameraTrack ?: throw PurpleCallioError.InvalidState("No camera track to switch")
        val position = try {
            cam.switchCamera()
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            throw PurpleCallioError.MediaInitializationFailed(e)
        }
        ensureLive()
        _cameraPosition.value = position
        publishLocal()
    }

    // ================================================================ screen share

    /**
     * Starts sharing the screen in place of the camera (no renegotiation).
     *
     * Pass the result of the `MediaProjectionManager.createScreenCaptureIntent()`
     * activity (`resultCode`, `data`). The SDK starts its own foreground service
     * of type `mediaProjection` (mandatory on Android 14+) before capturing.
     * Each consent Intent can be used once. Throws
     * [PurpleCallioError.ScreenShareUnavailable] for AUDIO calls or declined consent.
     */
    suspend fun startScreenShare(resultCode: Int, data: Intent) {
        startScreenShareInternal(resultCode, data)
    }

    internal suspend fun startScreenShareInternal(resultCode: Int, consentData: Any): Unit = runOp {
        requireNotTerminal()
        if (callType == PurpleCallioCallType.AUDIO) {
            throw PurpleCallioError.ScreenShareUnavailable("screen share is not available in AUDIO calls")
        }
        if (_screenSharing.value) return@runOp
        if (!platform.isScreenCaptureConsentGranted(resultCode)) {
            throw PurpleCallioError.ScreenShareUnavailable("the user declined screen capture")
        }
        val pc = peer
        val s = _connectionState.value
        if (pc == null || (s != PurpleCallioConnectionState.JOINING && s != PurpleCallioConnectionState.CONNECTED &&
                s != PurpleCallioConnectionState.RECONNECTING)
        ) {
            throw PurpleCallioError.InvalidState("Screen share requires an active call (state=$s)")
        }
        try {
            platform.startScreenShareService()
            screenServiceStarted = true
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            throw PurpleCallioError.ScreenShareUnavailable("could not start the screen-share foreground service: ${e.message}")
        }
        ensureLive()
        val track = try {
            rtc.createScreenTrack(consentData) { scope.launch { stopScreenShareOnEngine(byUser = false) } }
                .also { it.startCapture() }
        } catch (e: Throwable) {
            stopScreenService()
            throw PurpleCallioError.ScreenShareUnavailable("screen capture failed: ${e.message}")
        }
        if (!pc.replaceVideoTrack(track)) {
            track.stopCapture()
            track.dispose()
            stopScreenService()
            throw PurpleCallioError.ScreenShareUnavailable("this call has no video sender")
        }
        // The camera is not needed while the screen is being sent.
        cameraTrack?.stopCapture()
        screenTrack = track
        _screenSharing.value = true
        publishLocal()
        emitMedia("screenShare.started")
        log.i { "Screen share started" }
    }

    /** Stops sharing and puts the camera track back. No-op when not sharing. */
    suspend fun stopScreenShare(): Unit = runOp { stopScreenShareOnEngine(byUser = true) }

    private fun stopScreenShareOnEngine(byUser: Boolean) {
        if (!_screenSharing.value || ending || terminated) return
        val cam = cameraTrack
        peer?.replaceVideoTrack(cam)
        screenTrack?.let {
            it.stopCapture()
            it.dispose()
        }
        screenTrack = null
        stopScreenService()
        if (cam != null && _cameraEnabled.value && inForeground && !cam.isCapturing) {
            try {
                cam.startCapture()
            } catch (e: Throwable) {
                onCameraError(e)
            }
        }
        _screenSharing.value = false
        publishLocal()
        emitMedia("screenShare.stopped")
        log.i { if (byUser) "Screen share stopped" else "Screen share ended by the system" }
    }

    private fun stopScreenService() {
        if (screenServiceStarted) {
            screenServiceStarted = false
            platform.stopScreenShareService()
        }
    }

    // ================================================================ lifecycle

    private fun onAppBackground() {
        if (ending || terminated) return
        inForeground = false
        val cam = cameraTrack ?: return
        if (cam.isCapturing) {
            log.i { "App in background: pausing camera capture (audio continues)" }
            cam.stopCapture()
        }
    }

    private fun onAppForeground() {
        if (ending || terminated) return
        inForeground = true
        val cam = cameraTrack ?: return
        if (_cameraEnabled.value && !_screenSharing.value && !cam.isCapturing) {
            log.i { "App in foreground: resuming camera capture" }
            try {
                cam.startCapture()
            } catch (e: Throwable) {
                onCameraError(e)
            }
        }
    }

    // ================================================================ ending

    /**
     * Always valid and idempotent. Ringing caller → cancel; ringing receiver →
     * reject; in call → hang up. Then full cleanup. Ends in DISCONNECTED(LEFT).
     */
    suspend fun leave() {
        val d = withContext(dispatcher) {
            if (terminated) return@withContext null
            leaveDeferred ?: scope.async(NonCancellable) {
                val hangup = when {
                    callSetupStarted || joinedOnce -> Hangup.HANGUP
                    _connectionState.value == PurpleCallioConnectionState.RINGING && role == PurpleCallioRole.CALLER -> Hangup.CANCEL
                    _connectionState.value == PurpleCallioConnectionState.RINGING && role == PurpleCallioRole.RECEIVER -> Hangup.REJECT
                    stateBeforeReconnect == PurpleCallioConnectionState.RINGING ->
                        if (role == PurpleCallioRole.CALLER) Hangup.CANCEL else Hangup.REJECT
                    else -> Hangup.NONE
                }
                terminate(PurpleCallioConnectionState.DISCONNECTED, PurpleCallioDisconnectReason.LEFT, null, hangup)
            }.also { leaveDeferred = it }
        }
        d?.await()
        // Another path (remote end, dispose) may be finishing the meeting: wait for it.
        terminatedSignal.await()
    }

    /** Releases everything without signaling (use [leave] for a graceful end). Idempotent. */
    fun dispose() {
        scope.launch(NonCancellable) {
            terminate(PurpleCallioConnectionState.DISCONNECTED, PurpleCallioDisconnectReason.LEFT, null, Hangup.NONE)
        }
    }

    /** Test hook: coroutines (timers, handlers) still alive in the engine scope. */
    internal val activeJobCount: Int get() = supervisor.children.count { it.isActive }

    /** Suspends until the meeting reached a terminal state and released everything. */
    internal suspend fun awaitTerminated() = terminatedSignal.await()

    private suspend fun remoteEnded(reason: PurpleCallioDisconnectReason) {
        log.i { "Call ended by server/remote: $reason" }
        terminate(PurpleCallioConnectionState.DISCONNECTED, reason, null, Hangup.NONE)
    }

    private suspend fun fail(error: PurpleCallioError) {
        if (ending || terminated) return
        // A failed in-call meeting still hangs up so the call is closed (and billed) correctly.
        val hangup = if (joinedOnce) Hangup.HANGUP else Hangup.NONE
        terminate(PurpleCallioConnectionState.FAILED, null, error, hangup)
    }

    private enum class Hangup { NONE, HANGUP, CANCEL, REJECT }

    private suspend fun terminate(
        state: PurpleCallioConnectionState,
        reason: PurpleCallioDisconnectReason?,
        error: PurpleCallioError?,
        hangup: Hangup,
    ) {
        if (ending || terminated) return
        ending = true
        withContext(NonCancellable) {
            val id = _callId
            if (id != null) {
                when (hangup) {
                    Hangup.HANGUP -> {
                        if (inRoom || signaling.isConnected) {
                            signaling.emit("call.ended", callIdPayload)
                            signaling.emit("call-ended")
                        }
                        postQuietly(CallAction.LEAVE)
                        postQuietly(CallAction.END)
                    }
                    Hangup.CANCEL -> postQuietly(CallAction.CANCEL)
                    Hangup.REJECT -> postQuietly(CallAction.REJECT)
                    Hangup.NONE -> Unit
                }
            }
            cleanup()
        }
        terminated = true
        if (!firstAuth.isCompleted) {
            firstAuth.completeExceptionally(
                error ?: PurpleCallioError.MeetingEnded(reason ?: PurpleCallioDisconnectReason.LEFT),
            )
        }
        if (state == PurpleCallioConnectionState.FAILED) {
            _error.value = error
            error?.let { emitEvent(PurpleCallioEvent.Error(it)) }
            setState(PurpleCallioConnectionState.FAILED)
        } else {
            _disconnectReason.value = reason
            setState(PurpleCallioConnectionState.DISCONNECTED)
            emitEvent(PurpleCallioEvent.Ended(reason ?: PurpleCallioDisconnectReason.LEFT))
        }
        log.i { "Meeting terminated: state=$state reason=$reason" }
        terminatedSignal.complete(Unit)
        try {
            onTerminated(this)
        } catch (_: Throwable) {
        }
    }

    /** Deterministic release of everything this meeting owns. */
    private fun cleanup() {
        restartJob?.cancel()
        restartJob = null
        watchdogJob?.cancel()
        watchdogJob = null
        authJob?.cancel()
        authJob = null
        signaling.removeAllHandlers()
        try {
            lifecycleHandle?.close()
        } catch (_: Throwable) {
        }
        lifecycleHandle = null

        safely("close peer") { peer?.close() }
        peer = null
        safely("stop screen capture") {
            screenTrack?.stopCapture()
            screenTrack?.dispose()
        }
        screenTrack = null
        stopScreenService()
        safely("stop camera") {
            cameraTrack?.stopCapture()
            cameraTrack?.dispose()
        }
        cameraTrack = null
        safely("dispose microphone") { audioTrack?.dispose() }
        audioTrack = null
        safely("dispose rtc engine") { rtc.dispose() }
        if (audioSessionStarted) {
            audioSessionStarted = false
            safely("restore audio") { platform.stopAudioSession() }
        }
        safely("disconnect socket") { signaling.disconnect() }

        pendingCandidates.clear()
        inRoom = false
        pendingSignals.clear()
        joinAckTimeout?.cancel()
        joinAckTimeout = null
        remotePresent = false
        remoteVideo = null
        _screenSharing.value = false
        publishLocal()
        publishRemote()
    }

    private inline fun safely(what: String, block: () -> Unit) {
        try {
            block()
        } catch (t: Throwable) {
            log.w(t) { "Cleanup step failed: $what" }
        }
    }

    // ================================================================ helpers

    /** Runs a public operation on the engine context; survives caller cancellation mid-step. */
    private suspend fun <T> runOp(block: suspend () -> T): T = withContext(dispatcher) { block() }

    private fun requireNotTerminal() {
        if (ending || terminated) {
            throw PurpleCallioError.MeetingEnded(_disconnectReason.value ?: PurpleCallioDisconnectReason.LEFT)
        }
    }

    private fun requireVideoCall() {
        if (callType != PurpleCallioCallType.VIDEO) {
            throw PurpleCallioError.InvalidState("Camera is not available in an AUDIO call")
        }
    }

    /** Throws when the meeting ended while we were suspended. */
    private fun ensureLive() {
        if (ending || terminated) {
            throw PurpleCallioError.MeetingEnded(_disconnectReason.value ?: PurpleCallioDisconnectReason.LEFT)
        }
    }

    private suspend fun postOrThrow(action: CallAction) {
        try {
            api.post(callId, action, token)
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            throw mapApiError(e)
        }
    }

    private suspend fun postQuietly(action: CallAction, body: Payload? = null) {
        val id = _callId ?: return
        try {
            api.post(id, action, token, body)
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            log.w { "POST ${action.path} failed: ${e.message}" }
        }
    }

    private fun mapApiError(e: Throwable): PurpleCallioError = when (e) {
        is PurpleCallioError -> e
        is ApiException -> if (e.status == 401) PurpleCallioError.InvalidToken() else PurpleCallioError.SignalingFailed(e)
        is java.io.IOException -> PurpleCallioError.ConnectionFailed(e)
        else -> PurpleCallioError.SignalingFailed(e)
    }

    private fun reportNonFatal(error: PurpleCallioError) {
        _error.value = error
        emitEvent(PurpleCallioEvent.Error(error))
    }

    private fun setState(state: PurpleCallioConnectionState) {
        if (_connectionState.value == state) return
        if (_connectionState.value.isTerminal) return
        _connectionState.value = state
        emitEvent(PurpleCallioEvent.ConnectionStateChanged(state))
    }

    private fun emitEvent(event: PurpleCallioEvent) {
        if (!_events.tryEmit(event)) log.w { "Event buffer full; dropped ${event::class.simpleName}" }
    }

    private fun publishLocal() {
        val d = details
        val r = _role ?: PurpleCallioRole.CALLER
        val video = when {
            _screenSharing.value -> screenTrack?.let { PurpleCallioVideoTrack(it.handle, it.id) }
            else -> cameraTrack?.let { PurpleCallioVideoTrack(it.handle, it.id) }
        }
        val local = PurpleCallioParticipant(
            participantId = selfParticipantId ?: "",
            displayName = if (r == PurpleCallioRole.CALLER) d?.callerName else d?.receiverName,
            avatarUrl = if (r == PurpleCallioRole.CALLER) d?.callerAvatar else d?.receiverAvatar,
            role = r,
            isLocal = true,
            isMicrophoneEnabled = _microphoneEnabled.value,
            isCameraEnabled = _cameraEnabled.value,
            isScreenSharing = _screenSharing.value,
            videoTrack = video,
        )
        if (_localParticipant.value != local) _localParticipant.value = local
        publishParticipants()
    }

    private fun publishRemote() {
        val d = details
        val remote = if (!remotePresent || d == null) {
            null
        } else {
            val remoteIsCaller = role == PurpleCallioRole.RECEIVER
            PurpleCallioParticipant(
                participantId = (if (remoteIsCaller) d.callerId else d.receiverId) ?: "",
                displayName = if (remoteIsCaller) d.callerName else d.receiverName,
                avatarUrl = if (remoteIsCaller) d.callerAvatar else d.receiverAvatar,
                role = if (remoteIsCaller) PurpleCallioRole.CALLER else PurpleCallioRole.RECEIVER,
                isLocal = false,
                isMicrophoneEnabled = remoteMicrophone,
                isCameraEnabled = remoteCamera,
                isScreenSharing = remoteScreenShare,
                videoTrack = remoteVideo,
            )
        }
        if (_remoteParticipant.value != remote) _remoteParticipant.value = remote
        publishParticipants()
    }

    private fun publishParticipants() {
        val list = listOfNotNull(_localParticipant.value, _remoteParticipant.value)
        if (_participants.value != list) _participants.value = list
    }

    private fun terminalReasonForStatus(status: String): PurpleCallioDisconnectReason? = when (status) {
        "ENDED" -> PurpleCallioDisconnectReason.REMOTE_ENDED
        "MISSED" -> PurpleCallioDisconnectReason.MISSED
        "REJECTED" -> PurpleCallioDisconnectReason.REJECTED
        "CANCELLED" -> PurpleCallioDisconnectReason.CANCELLED
        "BUSY" -> PurpleCallioDisconnectReason.BUSY
        else -> null
    }

    override fun toString(): String = "PurpleCallioMeeting(callId=$_callId, role=$_role, state=${_connectionState.value})"

    internal companion object {
        const val STREAM_ID = "purplecallio"

        fun parseRole(v: Any?): PurpleCallioRole? = when (v) {
            "CALLER" -> PurpleCallioRole.CALLER
            "RECEIVER" -> PurpleCallioRole.RECEIVER
            else -> null
        }

        fun parseCallType(v: Any?): PurpleCallioCallType? = when (v) {
            "VIDEO" -> PurpleCallioCallType.VIDEO
            "AUDIO" -> PurpleCallioCallType.AUDIO
            else -> null
        }

        fun parseDescription(v: Any?): SessionDescriptionData? {
            val m = v as? Map<*, *> ?: return null
            val type = m["type"] as? String ?: return null
            val sdp = m["sdp"] as? String ?: return null
            return SessionDescriptionData(type, sdp)
        }

        fun parseCandidate(v: Any?): IceCandidateData? {
            val m = v as? Map<*, *> ?: return null
            val candidate = m["candidate"] as? String ?: return null
            if (candidate.isEmpty()) return null // end-of-candidates marker
            val index = (m["sdpMLineIndex"] as? Number)?.toInt() ?: 0
            return IceCandidateData(candidate, m["sdpMid"] as? String, index)
        }

        fun SessionDescriptionData.toPayload(): Payload = mapOf("type" to type, "sdp" to sdp)

        fun IceCandidateData.toPayload(): Payload =
            mapOf("candidate" to candidate, "sdpMid" to sdpMid, "sdpMLineIndex" to sdpMLineIndex)
    }
}
