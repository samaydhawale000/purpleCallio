package com.purplecallio.android

import com.purplecallio.android.internal.ApiException
import com.purplecallio.android.internal.CallAction
import com.purplecallio.android.internal.CallDetails
import com.purplecallio.android.internal.IceCandidateData
import com.purplecallio.android.internal.IceConnectionState
import com.purplecallio.android.internal.LocalAudioTrack
import com.purplecallio.android.internal.LocalCameraTrack
import com.purplecallio.android.internal.LocalScreenTrack
import com.purplecallio.android.internal.LocalTrack
import com.purplecallio.android.internal.LocalVideoTrack
import com.purplecallio.android.internal.MeetingPlatform
import com.purplecallio.android.internal.Payload
import com.purplecallio.android.internal.PurpleCallioApi
import com.purplecallio.android.internal.RtcEngine
import com.purplecallio.android.internal.RtcPeer
import com.purplecallio.android.internal.RtcPeerObserver
import com.purplecallio.android.internal.SessionDescriptionData
import com.purplecallio.android.internal.SignalingChannel
import com.purplecallio.android.internal.SignalingListener
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger

/** Shared, ordered log of everything the engine did across socket, REST and RTC. */
internal class Recorder {
    val entries: MutableList<String> = Collections.synchronizedList(ArrayList())
    fun add(e: String) {
        entries += e
    }

    fun snapshot(): List<String> = synchronized(entries) { entries.toList() }
    fun indexOf(e: String): Int = snapshot().indexOf(e)
    fun count(e: String): Int = snapshot().count { it == e }
    fun has(e: String): Boolean = snapshot().contains(e)
}

/** Counters of every resource acquired/released, shared by all fakes of one meeting. */
internal class ResourceCounters {
    val peersCreated = AtomicInteger()
    val peersClosed = AtomicInteger()
    val tracksCreated = AtomicInteger()
    val tracksDisposed = AtomicInteger()
    val capturesStarted = AtomicInteger()
    val capturesStopped = AtomicInteger()
    val enginesDisposed = AtomicInteger()
    val audioSessionsStarted = AtomicInteger()
    val audioSessionsStopped = AtomicInteger()
    val lifecycleRegistered = AtomicInteger()
    val lifecycleUnregistered = AtomicInteger()
    val screenServicesStarted = AtomicInteger()
    val screenServicesStopped = AtomicInteger()
    val socketsDisconnected = AtomicInteger()

    fun assertBalanced() {
        fun eq(name: String, a: AtomicInteger, b: AtomicInteger) =
            check(a.get() == b.get()) { "$name unbalanced: ${a.get()} acquired vs ${b.get()} released" }
        eq("peers", peersCreated, peersClosed)
        eq("tracks", tracksCreated, tracksDisposed)
        eq("audio sessions", audioSessionsStarted, audioSessionsStopped)
        eq("lifecycle observers", lifecycleRegistered, lifecycleUnregistered)
        eq("screen services", screenServicesStarted, screenServicesStopped)
        check(capturesStarted.get() <= capturesStopped.get()) {
            "captures still running: started=${capturesStarted.get()} stopped=${capturesStopped.get()}"
        }
    }
}

internal class FakeSignaling(private val rec: Recorder, private val counters: ResourceCounters) : SignalingChannel {
    override var listener: SignalingListener? = null
    private val handlers = LinkedHashMap<String, (Payload?) -> Unit>()
    var connected = false
        private set
    var disconnectCalled = false
        private set

    /** What the fake server answers to `authenticate`; null = never ack (timeout). */
    var authAck: (() -> Any?)? = { mapOf("success" to true, "role" to "CALLER") }

    /** Server-side events sent (before the ack) on each successful authenticate. */
    var onAuthenticate: (FakeSignaling) -> Unit = {}

    val emits = Collections.synchronizedList(ArrayList<Pair<String, Payload?>>())

    override val isConnected: Boolean get() = connected

    override fun connect() {
        rec.add("socket:connect")
        connected = true
        listener?.onConnect()
    }

    override fun emit(event: String, payload: Payload?) {
        if (!connected) {
            rec.add("dropped:$event")
            return
        }
        emits += event to payload
        rec.add("emit:$event")
    }

    /** Ack body for `join-call` (the real gateway always acks); null = never acks. */
    var joinCallAck: Map<String, Any?>? = mapOf("success" to true, "participants" to 2)

    /** When true, join-call acks are held until [releaseJoinAck]. */
    var holdJoinAck = false
    private var heldJoinAck: (() -> Unit)? = null

    fun releaseJoinAck() {
        heldJoinAck?.invoke()
        heldJoinAck = null
    }

    override fun emitWithAck(event: String, payload: Payload, onAck: (Any?) -> Unit) {
        rec.add("emit:$event")
        emits += event to payload
        if (event == "join-call") {
            val ack = joinCallAck ?: return
            if (holdJoinAck) heldJoinAck = { onAck(ack) } else onAck(ack)
            return
        }
        if (event == "authenticate") {
            val ack = authAck ?: return
            val value = ack()
            if ((value as? Map<*, *>)?.get("success") == true) onAuthenticate(this)
            onAck(value)
        }
    }

    override fun on(event: String, handler: (Payload?) -> Unit) {
        handlers[event] = handler
    }

    override fun removeAllHandlers() {
        handlers.clear()
        listener = null
        rec.add("socket:removeHandlers")
    }

    override fun disconnect() {
        if (disconnectCalled) return
        disconnectCalled = true
        connected = false
        counters.socketsDisconnected.incrementAndGet()
        rec.add("socket:disconnect")
    }

    /** Server → client event. */
    fun server(event: String, payload: Payload? = null) {
        handlers[event]?.invoke(payload)
    }

    fun hasHandlers(): Boolean = handlers.isNotEmpty()

    /** Simulates a transport drop (socket.io will auto-reconnect). */
    fun drop(reason: String = "transport close") {
        connected = false
        listener?.onDisconnect(reason, reason == "io server disconnect")
    }

    /** Simulates socket.io's automatic reconnect. */
    fun reconnect() {
        connected = true
        listener?.onConnect()
    }

    fun emitted(event: String): List<Payload?> = synchronized(emits) { emits.filter { it.first == event }.map { it.second } }
    fun emitNames(): List<String> = synchronized(emits) { emits.map { it.first } }
}

internal class FakeApi(private val rec: Recorder) : PurpleCallioApi {
    var details = CallDetails(
        callId = "call-1", type = PurpleCallioCallType.VIDEO, status = "RINGING",
        callerId = "caller-1", receiverId = "receiver-1",
        callerName = "Alice", callerAvatar = "https://a/alice.png",
        receiverName = "Bob", receiverAvatar = null, participantId = "caller-1",
    )
    var turn: List<PurpleCallioIceServer> = listOf(PurpleCallioIceServer("stun:stun.example.com:3478"))
    var turnFails = false
    var detailsError: Throwable? = null
    val postErrors = HashMap<CallAction, Throwable>()
    val posts = Collections.synchronizedList(ArrayList<Pair<CallAction, Payload?>>())

    override suspend fun turnCredentials(token: String): List<PurpleCallioIceServer> {
        rec.add("api:turn")
        if (turnFails) throw java.io.IOException("boom")
        return turn
    }

    override suspend fun callDetails(callId: String, token: String): CallDetails {
        rec.add("api:details")
        detailsError?.let { throw it }
        return details
    }

    /** Called after a POST is recorded (e.g. to deliver a server event mid-request). */
    var onPost: (CallAction) -> Unit = {}
    /** Virtual-time latency per action. */
    val postDelayMs = HashMap<CallAction, Long>()

    override suspend fun post(callId: String, action: CallAction, token: String, body: Payload?) {
        rec.add("api:${action.path}")
        posts += action to body
        onPost(action)
        postDelayMs[action]?.let { kotlinx.coroutines.delay(it) }
        postErrors[action]?.let { throw it }
    }

    fun posted(action: CallAction): Int = synchronized(posts) { posts.count { it.first == action } }

    companion object {
        fun unauthorized() = ApiException(401, "HTTP 401")
    }
}

internal class FakeTrack(
    override val id: String,
    private val kind: String,
    private val rec: Recorder,
    private val counters: ResourceCounters,
) : LocalAudioTrack, LocalVideoTrack {
    var trackEnabled = true
    var disposed = false
    override val handle: Any = this
    override fun setEnabled(enabled: Boolean) {
        check(!disposed) { "$kind track used after dispose" }
        this.trackEnabled = enabled
        rec.add("rtc:$kind.enabled=$enabled")
    }

    override fun dispose() {
        if (disposed) return
        disposed = true
        counters.tracksDisposed.incrementAndGet()
        rec.add("rtc:$kind.dispose")
    }
}

internal class FakeCameraTrack(
    initial: PurpleCallioCameraPosition,
    private val rec: Recorder,
    private val counters: ResourceCounters,
) : LocalCameraTrack {
    var trackEnabled = true
    var disposed = false
    override var position: PurpleCallioCameraPosition = initial
    override var isCapturing: Boolean = false
    override var onCaptureError: ((Throwable) -> Unit)? = null
    override val handle: Any = this
    override val id: String = "camera"

    override fun setEnabled(enabled: Boolean) {
        check(!disposed)
        this.trackEnabled = enabled
        rec.add("rtc:camera.enabled=$enabled")
    }

    override fun startCapture() {
        check(!disposed)
        if (isCapturing) return
        isCapturing = true
        counters.capturesStarted.incrementAndGet()
        rec.add("rtc:camera.startCapture")
    }

    override fun stopCapture() {
        if (!isCapturing) return
        isCapturing = false
        counters.capturesStopped.incrementAndGet()
        rec.add("rtc:camera.stopCapture")
    }

    override suspend fun switchCamera(): PurpleCallioCameraPosition {
        position = if (position == PurpleCallioCameraPosition.FRONT) PurpleCallioCameraPosition.BACK else PurpleCallioCameraPosition.FRONT
        rec.add("rtc:camera.switch=$position")
        return position
    }

    override fun dispose() {
        if (disposed) return
        stopCapture()
        disposed = true
        counters.tracksDisposed.incrementAndGet()
        rec.add("rtc:camera.dispose")
    }
}

internal class FakeScreenTrack(
    private val rec: Recorder,
    private val counters: ResourceCounters,
    val onStopped: () -> Unit,
) : LocalScreenTrack {
    var capturing = false
    var disposed = false
    override val handle: Any = this
    override val id: String = "screen"
    override fun setEnabled(enabled: Boolean) = Unit
    override fun startCapture() {
        capturing = true
        counters.capturesStarted.incrementAndGet()
        rec.add("rtc:screen.startCapture")
    }

    override fun stopCapture() {
        if (!capturing) return
        capturing = false
        counters.capturesStopped.incrementAndGet()
        rec.add("rtc:screen.stopCapture")
    }

    override fun dispose() {
        if (disposed) return
        disposed = true
        counters.tracksDisposed.incrementAndGet()
        rec.add("rtc:screen.dispose")
    }
}

internal class FakePeer(
    private val rec: Recorder,
    private val counters: ResourceCounters,
    val observer: RtcPeerObserver,
    val iceServers: List<PurpleCallioIceServer>,
) : RtcPeer {
    var closed = false
    val addedTracks = ArrayList<LocalTrack>()
    val addedCandidates = ArrayList<IceCandidateData>()
    val remoteDescriptions = ArrayList<SessionDescriptionData>()
    val localDescriptions = ArrayList<SessionDescriptionData>()
    var videoSenderTrack: LocalVideoTrack? = null
    var hasVideoSender = false
    var offersCreated = 0
    var iceRestarts = 0

    /** Candidates emitted by the fake ICE agent after setLocalDescription. */
    var candidatesOnLocalDescription: List<IceCandidateData> = emptyList()

    override fun addTrack(track: LocalTrack, streamId: String) {
        check(!closed)
        addedTracks += track
        if (track is LocalCameraTrack) {
            hasVideoSender = true
            videoSenderTrack = track
        }
        rec.add("rtc:addTrack:${track.id}")
    }

    override fun addVideoTransceiver(streamId: String) {
        hasVideoSender = true
        rec.add("rtc:addVideoTransceiver")
    }

    override suspend fun createOffer(iceRestart: Boolean): SessionDescriptionData {
        check(!closed)
        offersCreated++
        if (iceRestart) iceRestarts++
        rec.add("rtc:createOffer(iceRestart=$iceRestart)")
        return SessionDescriptionData("offer", "v=0 fake-offer-$offersCreated a=ice-pwd:secretpwd")
    }

    override suspend fun createAnswer(): SessionDescriptionData {
        check(!closed)
        rec.add("rtc:createAnswer")
        return SessionDescriptionData("answer", "v=0 fake-answer")
    }

    override suspend fun setLocalDescription(description: SessionDescriptionData) {
        check(!closed)
        localDescriptions += description
        rec.add("rtc:setLocal:${description.type}")
        candidatesOnLocalDescription.forEach { observer.onIceCandidate(it) }
    }

    override suspend fun setRemoteDescription(description: SessionDescriptionData) {
        check(!closed)
        remoteDescriptions += description
        rec.add("rtc:setRemote:${description.type}")
    }

    override fun addIceCandidate(candidate: IceCandidateData): Boolean {
        check(!closed)
        addedCandidates += candidate
        rec.add("rtc:addIceCandidate:${candidate.candidate}")
        return true
    }

    override fun replaceVideoTrack(track: LocalVideoTrack?): Boolean {
        if (!hasVideoSender) return false
        videoSenderTrack = track
        rec.add("rtc:replaceVideoTrack:${track?.id}")
        return true
    }

    override suspend fun selectedLocalCandidateType(): String = "host"

    override var iceConnectionState: IceConnectionState = IceConnectionState.NEW

    fun ice(state: IceConnectionState) {
        iceConnectionState = state
        observer.onIceConnectionStateChanged(state)
    }

    override fun close() {
        if (closed) return
        closed = true
        counters.peersClosed.incrementAndGet()
        rec.add("rtc:peer.close")
    }
}

internal class FakeRtc(private val rec: Recorder, private val counters: ResourceCounters) : RtcEngine {
    val peers = ArrayList<FakePeer>()
    var audio: FakeTrack? = null
    var camera: FakeCameraTrack? = null
    var screen: FakeScreenTrack? = null
    var cameraFails = false
    var disposed = false

    val peer: FakePeer get() = peers.last()

    /** Candidates every new peer "gathers" after setLocalDescription. */
    var candidatesForNewPeers: List<IceCandidateData> = emptyList()

    override fun createPeer(iceServers: List<PurpleCallioIceServer>, observer: RtcPeerObserver): RtcPeer {
        check(!disposed)
        counters.peersCreated.incrementAndGet()
        rec.add("rtc:createPeer")
        return FakePeer(rec, counters, observer, iceServers).also {
            it.candidatesOnLocalDescription = candidatesForNewPeers
            peers += it
        }
    }

    override fun createAudioTrack(): LocalAudioTrack {
        counters.tracksCreated.incrementAndGet()
        rec.add("rtc:createAudioTrack")
        return FakeTrack("audio", "audio", rec, counters).also { audio = it }
    }

    override fun createCameraTrack(position: PurpleCallioCameraPosition): LocalCameraTrack {
        if (cameraFails) throw IllegalStateException("No camera available")
        counters.tracksCreated.incrementAndGet()
        rec.add("rtc:createCameraTrack")
        return FakeCameraTrack(position, rec, counters).also { camera = it }
    }

    override fun createScreenTrack(consentData: Any, onStopped: () -> Unit): LocalScreenTrack {
        counters.tracksCreated.incrementAndGet()
        rec.add("rtc:createScreenTrack")
        return FakeScreenTrack(rec, counters, onStopped).also { screen = it }
    }

    override fun dispose() {
        if (disposed) return
        disposed = true
        counters.enginesDisposed.incrementAndGet()
        rec.add("rtc:engine.dispose")
    }
}

internal class FakePlatform(private val rec: Recorder, private val counters: ResourceCounters) : MeetingPlatform {
    val granted = HashSet(PurpleCallioPermissionKind.values().toList())
    var onBackground: (() -> Unit)? = null
    var onForeground: (() -> Unit)? = null

    override fun hasPermission(kind: PurpleCallioPermissionKind): Boolean = kind in granted

    override fun startAudioSession(video: Boolean) {
        counters.audioSessionsStarted.incrementAndGet()
        rec.add("platform:audio.start(video=$video)")
    }

    override fun stopAudioSession() {
        counters.audioSessionsStopped.incrementAndGet()
        rec.add("platform:audio.stop")
    }

    override fun observeAppLifecycle(onBackground: () -> Unit, onForeground: () -> Unit): AutoCloseable {
        counters.lifecycleRegistered.incrementAndGet()
        this.onBackground = onBackground
        this.onForeground = onForeground
        return AutoCloseable {
            counters.lifecycleUnregistered.incrementAndGet()
            this.onBackground = null
            this.onForeground = null
        }
    }

    override fun isScreenCaptureConsentGranted(resultCode: Int): Boolean = resultCode == -1

    override suspend fun startScreenShareService() {
        counters.screenServicesStarted.incrementAndGet()
        rec.add("platform:screenService.start")
    }

    override fun stopScreenShareService() {
        counters.screenServicesStopped.incrementAndGet()
        rec.add("platform:screenService.stop")
    }
}
