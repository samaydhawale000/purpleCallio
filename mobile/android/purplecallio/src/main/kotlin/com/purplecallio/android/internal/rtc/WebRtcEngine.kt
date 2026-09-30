package com.purplecallio.android.internal.rtc

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.os.Build
import android.util.DisplayMetrics
import android.view.WindowManager
import com.purplecallio.android.Logger
import com.purplecallio.android.PurpleCallioCameraPosition
import com.purplecallio.android.PurpleCallioIceServer
import com.purplecallio.android.internal.IceCandidateData
import com.purplecallio.android.internal.IceConnectionState
import com.purplecallio.android.internal.LocalAudioTrack
import com.purplecallio.android.internal.LocalCameraTrack
import com.purplecallio.android.internal.LocalScreenTrack
import com.purplecallio.android.internal.LocalTrack
import com.purplecallio.android.internal.LocalVideoTrack
import com.purplecallio.android.internal.RtcEngine
import com.purplecallio.android.internal.RtcPeer
import com.purplecallio.android.internal.RtcPeerObserver
import com.purplecallio.android.internal.SessionDescriptionData
import kotlinx.coroutines.suspendCancellableCoroutine
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera1Enumerator
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraEnumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Process-wide shared EGL context, reference counted (engines + video views). */
internal object SharedEgl {
    private var egl: EglBase? = null
    private var refs = 0

    @Synchronized
    fun acquire(): EglBase {
        val e = egl ?: EglBase.create().also { egl = it }
        refs++
        return e
    }

    @Synchronized
    fun release() {
        if (refs == 0) return
        refs--
        if (refs == 0) {
            egl?.release()
            egl = null
        }
    }

    @get:Synchronized
    val referenceCount: Int get() = refs
}

private object WebRtcInit {
    private val done = AtomicBoolean(false)

    fun ensure(context: Context) {
        if (done.compareAndSet(false, true)) {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context)
                    .setEnableInternalTracer(false)
                    .createInitializationOptions(),
            )
        }
    }
}

/** [RtcEngine] on stream-webrtc-android: one PeerConnectionFactory per meeting. */
internal class WebRtcEngine(
    context: Context,
    private val log: Logger,
) : RtcEngine {
    private val context = context.applicationContext
    private var egl: EglBase? = null
    private var adm: JavaAudioDeviceModule? = null
    private var factoryInstance: PeerConnectionFactory? = null
    private var disposed = false

    private val factory: PeerConnectionFactory
        get() {
            check(!disposed) { "RTC engine disposed" }
            factoryInstance?.let { return it }
            WebRtcInit.ensure(context)
            val e = SharedEgl.acquire().also { egl = it }
            val module = JavaAudioDeviceModule.builder(context)
                .setUseHardwareAcousticEchoCanceler(true)
                .setUseHardwareNoiseSuppressor(true)
                .setAudioRecordErrorCallback(object : JavaAudioDeviceModule.AudioRecordErrorCallback {
                    override fun onWebRtcAudioRecordInitError(p0: String?) = log.e { "Audio record init error: $p0" }
                    override fun onWebRtcAudioRecordStartError(
                        p0: JavaAudioDeviceModule.AudioRecordStartErrorCode?,
                        p1: String?,
                    ) = log.e { "Audio record start error: $p0 $p1" }
                    override fun onWebRtcAudioRecordError(p0: String?) = log.e { "Audio record error: $p0" }
                })
                .setAudioTrackErrorCallback(object : JavaAudioDeviceModule.AudioTrackErrorCallback {
                    override fun onWebRtcAudioTrackInitError(p0: String?) = log.e { "Audio track init error: $p0" }
                    override fun onWebRtcAudioTrackStartError(
                        p0: JavaAudioDeviceModule.AudioTrackStartErrorCode?,
                        p1: String?,
                    ) = log.e { "Audio track start error: $p0 $p1" }
                    override fun onWebRtcAudioTrackError(p0: String?) = log.e { "Audio track error: $p0" }
                })
                .createAudioDeviceModule()
            adm = module
            val f = PeerConnectionFactory.builder()
                .setAudioDeviceModule(module)
                .setVideoEncoderFactory(DefaultVideoEncoderFactory(e.eglBaseContext, true, true))
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(e.eglBaseContext))
                .createPeerConnectionFactory()
            factoryInstance = f
            return f
        }

    private val eglBase: EglBase get() = factory.let { egl!! }

    override fun createPeer(iceServers: List<PurpleCallioIceServer>, observer: RtcPeerObserver): RtcPeer {
        val servers = iceServers.map { s ->
            PeerConnection.IceServer.builder(s.urls)
                .setUsername(s.username ?: "")
                .setPassword(s.credential ?: "")
                .createIceServer()
        }
        val config = PeerConnection.RTCConfiguration(servers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
        }
        val peer = WebRtcPeer(observer, log)
        val pc = factory.createPeerConnection(config, peer.pcObserver)
            ?: throw IllegalStateException("createPeerConnection returned null")
        peer.attach(pc)
        return peer
    }

    override fun createAudioTrack(): LocalAudioTrack {
        val source = factory.createAudioSource(MediaConstraints())
        val track = factory.createAudioTrack("pc-audio-${UUID.randomUUID()}", source)
        return WebRtcAudioTrack(track, source)
    }

    override fun createCameraTrack(position: PurpleCallioCameraPosition): LocalCameraTrack =
        WebRtcCameraTrack(context, factory, eglBase, position, log)

    override fun createScreenTrack(consentData: Any, onStopped: () -> Unit): LocalScreenTrack {
        val intent = consentData as? Intent ?: throw IllegalArgumentException("consent data must be the MediaProjection Intent")
        return WebRtcScreenTrack(context, factory, eglBase, intent, onStopped)
    }

    override fun dispose() {
        if (disposed) return
        disposed = true
        factoryInstance?.dispose()
        factoryInstance = null
        adm?.release()
        adm = null
        if (egl != null) {
            egl = null
            SharedEgl.release()
        }
    }
}

private class WebRtcAudioTrack(val track: AudioTrack, val source: AudioSource) : LocalAudioTrack {
    private var disposed = false
    override val handle: Any get() = track
    override val id: String = track.id()
    override fun setEnabled(enabled: Boolean) {
        if (!disposed) track.setEnabled(enabled)
    }

    override fun dispose() {
        if (disposed) return
        disposed = true
        track.dispose()
        source.dispose()
    }
}

private class WebRtcCameraTrack(
    private val context: Context,
    factory: PeerConnectionFactory,
    private val egl: EglBase,
    initial: PurpleCallioCameraPosition,
    private val log: Logger,
) : LocalCameraTrack {
    private val enumerator: CameraEnumerator =
        if (Camera2Enumerator.isSupported(context)) Camera2Enumerator(context) else Camera1Enumerator(true)
    private val source: VideoSource = factory.createVideoSource(false)
    private val track: VideoTrack = factory.createVideoTrack("pc-camera-${UUID.randomUUID()}", source)
    private var helper: SurfaceTextureHelper? = null
    private var capturer: CameraVideoCapturer? = null
    private var deviceName: String
    private var disposed = false

    override var position: PurpleCallioCameraPosition = initial
        private set
    override var isCapturing: Boolean = false
        private set
    override var onCaptureError: ((Throwable) -> Unit)? = null
    override val handle: Any get() = track
    override val id: String = track.id()

    private val events = object : CameraVideoCapturer.CameraEventsHandler {
        override fun onCameraError(error: String?) {
            onCaptureError?.invoke(RuntimeException("Camera error: $error"))
        }

        override fun onCameraDisconnected() {
            onCaptureError?.invoke(RuntimeException("Camera disconnected"))
        }

        override fun onCameraFreezed(error: String?) = log.w { "Camera frozen: $error" }
        override fun onCameraOpening(name: String?) = log.d { "Opening camera $name" }
        override fun onFirstFrameAvailable() = log.d { "First camera frame" }
        override fun onCameraClosed() = log.d { "Camera closed" }
    }

    init {
        val names = enumerator.deviceNames.toList()
        if (names.isEmpty()) {
            track.dispose()
            source.dispose()
            throw IllegalStateException("No camera available")
        }
        deviceName = pick(initial) ?: names.first()
        position = if (enumerator.isFrontFacing(deviceName)) PurpleCallioCameraPosition.FRONT else PurpleCallioCameraPosition.BACK
        try {
            createCapturer()
        } catch (t: Throwable) {
            releaseCapturer()
            track.dispose()
            source.dispose()
            throw t
        }
    }

    private fun pick(p: PurpleCallioCameraPosition): String? = enumerator.deviceNames.firstOrNull {
        if (p == PurpleCallioCameraPosition.FRONT) enumerator.isFrontFacing(it) else enumerator.isBackFacing(it)
    }

    private fun createCapturer() {
        val c = enumerator.createCapturer(deviceName, events)
            ?: throw IllegalStateException("Could not create a capturer for camera $deviceName")
        val h = SurfaceTextureHelper.create("PurpleCallioCamera", egl.eglBaseContext)
            ?: throw IllegalStateException("Could not create SurfaceTextureHelper")
        c.initialize(h, context, source.capturerObserver)
        capturer = c
        helper = h
    }

    private fun releaseCapturer() {
        stopCapture()
        capturer?.dispose()
        capturer = null
        helper?.dispose()
        helper = null
    }

    override fun setEnabled(enabled: Boolean) {
        if (!disposed) track.setEnabled(enabled)
    }

    override fun startCapture() {
        check(!disposed) { "camera track disposed" }
        if (isCapturing) return
        (capturer ?: throw IllegalStateException("no capturer")).startCapture(1280, 720, 30)
        isCapturing = true
    }

    override fun stopCapture() {
        if (!isCapturing) return
        isCapturing = false
        try {
            capturer?.stopCapture()
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    override suspend fun switchCamera(): PurpleCallioCameraPosition {
        val target = if (position == PurpleCallioCameraPosition.FRONT) PurpleCallioCameraPosition.BACK else PurpleCallioCameraPosition.FRONT
        val targetName = pick(target) ?: throw IllegalStateException("No ${target.name.lowercase()} camera")
        val c = capturer ?: throw IllegalStateException("no capturer")
        if (isCapturing) {
            val front = suspendCancellableCoroutine { cont ->
                c.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
                    override fun onCameraSwitchDone(isFrontCamera: Boolean) {
                        if (cont.isActive) cont.resume(isFrontCamera)
                    }

                    override fun onCameraSwitchError(errorDescription: String?) {
                        if (cont.isActive) cont.resumeWithException(IllegalStateException("switchCamera failed: $errorDescription"))
                    }
                }, targetName)
            }
            deviceName = targetName
            position = if (front) PurpleCallioCameraPosition.FRONT else PurpleCallioCameraPosition.BACK
        } else {
            // Not capturing (camera off / backgrounded): swap the capturer for the next start.
            releaseCapturer()
            deviceName = targetName
            createCapturer()
            position = target
        }
        return position
    }

    override fun dispose() {
        if (disposed) return
        releaseCapturer()
        disposed = true
        track.dispose()
        source.dispose()
    }
}

private class WebRtcScreenTrack(
    private val context: Context,
    factory: PeerConnectionFactory,
    egl: EglBase,
    consent: Intent,
    onStopped: () -> Unit,
) : LocalScreenTrack {
    private val capturer = ScreenCapturerAndroid(consent, object : MediaProjection.Callback() {
        override fun onStop() = onStopped()
    })
    private val source: VideoSource = factory.createVideoSource(true)
    private val track: VideoTrack = factory.createVideoTrack("pc-screen-${UUID.randomUUID()}", source)
    private val helper: SurfaceTextureHelper =
        SurfaceTextureHelper.create("PurpleCallioScreen", egl.eglBaseContext)
            ?: throw IllegalStateException("Could not create SurfaceTextureHelper")
    private var capturing = false
    private var disposed = false

    override val handle: Any get() = track
    override val id: String = track.id()

    init {
        capturer.initialize(helper, context, source.capturerObserver)
    }

    override fun setEnabled(enabled: Boolean) {
        if (!disposed) track.setEnabled(enabled)
    }

    override fun startCapture() {
        if (capturing) return
        val (w, h) = captureSize()
        capturer.startCapture(w, h, 15)
        capturing = true
    }

    private fun captureSize(): Pair<Int, Int> {
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val (width, height) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = wm.currentWindowMetrics.bounds
            b.width() to b.height()
        } else {
            val m = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(m)
            m.widthPixels to m.heightPixels
        }
        // Cap the long edge at 1280 px (bandwidth/CPU), keep aspect, even dimensions.
        val scale = minOf(1.0, 1280.0 / maxOf(width, height).coerceAtLeast(1))
        fun even(v: Double) = (v.toInt() / 2 * 2).coerceAtLeast(2)
        return even(width * scale) to even(height * scale)
    }

    override fun stopCapture() {
        if (!capturing) return
        capturing = false
        try {
            capturer.stopCapture()
        } catch (_: Throwable) {
        }
    }

    override fun dispose() {
        if (disposed) return
        stopCapture()
        disposed = true
        capturer.dispose()
        helper.dispose()
        track.dispose()
        source.dispose()
    }
}

private class WebRtcPeer(
    private val observer: RtcPeerObserver,
    private val log: Logger,
) : RtcPeer {
    private var pc: PeerConnection? = null
    private var closed = false

    @Volatile
    private var state = IceConnectionState.NEW

    fun attach(connection: PeerConnection) {
        pc = connection
    }

    val pcObserver = object : PeerConnection.Observer {
        override fun onSignalingChange(s: PeerConnection.SignalingState?) = Unit
        override fun onIceConnectionChange(s: PeerConnection.IceConnectionState?) {
            val mapped = when (s) {
                PeerConnection.IceConnectionState.NEW -> IceConnectionState.NEW
                PeerConnection.IceConnectionState.CHECKING -> IceConnectionState.CHECKING
                PeerConnection.IceConnectionState.CONNECTED -> IceConnectionState.CONNECTED
                PeerConnection.IceConnectionState.COMPLETED -> IceConnectionState.COMPLETED
                PeerConnection.IceConnectionState.DISCONNECTED -> IceConnectionState.DISCONNECTED
                PeerConnection.IceConnectionState.FAILED -> IceConnectionState.FAILED
                PeerConnection.IceConnectionState.CLOSED -> IceConnectionState.CLOSED
                null -> return
            }
            state = mapped
            observer.onIceConnectionStateChanged(mapped)
        }

        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(s: PeerConnection.IceGatheringState?) = Unit
        override fun onIceCandidate(c: IceCandidate?) {
            c ?: return
            observer.onIceCandidate(IceCandidateData(c.sdp, c.sdpMid, c.sdpMLineIndex))
        }

        override fun onIceCandidatesRemoved(c: Array<out IceCandidate>?) = Unit
        override fun onAddStream(s: MediaStream?) = Unit
        override fun onRemoveStream(s: MediaStream?) = Unit
        override fun onDataChannel(d: DataChannel?) = Unit
        override fun onRenegotiationNeeded() = Unit
        override fun onAddTrack(r: RtpReceiver?, s: Array<out MediaStream>?) = Unit
        override fun onTrack(transceiver: RtpTransceiver?) {
            val track = transceiver?.receiver?.track() ?: return
            if (track is VideoTrack) observer.onRemoteVideoTrack(track, track.id())
        }
    }

    private fun requirePc(): PeerConnection = pc?.takeIf { !closed } ?: throw IllegalStateException("peer connection closed")

    override fun addTrack(track: LocalTrack, streamId: String) {
        requirePc().addTrack(track.handle as MediaStreamTrack, listOf(streamId))
    }

    override fun addVideoTransceiver(streamId: String) {
        requirePc().addTransceiver(
            MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
            RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_RECV, listOf(streamId)),
        )
    }

    override suspend fun createOffer(iceRestart: Boolean): SessionDescriptionData {
        val constraints = MediaConstraints().apply {
            if (iceRestart) mandatory.add(MediaConstraints.KeyValuePair("IceRestart", "true"))
        }
        return create(offer = true, constraints)
    }

    override suspend fun createAnswer(): SessionDescriptionData = create(offer = false, MediaConstraints())

    private suspend fun create(offer: Boolean, constraints: MediaConstraints): SessionDescriptionData {
        val pc = requirePc()
        val sdp = suspendCancellableCoroutine { cont ->
            val obs = object : SdpObserver {
                override fun onCreateSuccess(d: SessionDescription?) {
                    if (!cont.isActive) return
                    if (d == null) cont.resumeWithException(IllegalStateException("null description")) else cont.resume(d)
                }

                override fun onCreateFailure(error: String?) {
                    if (cont.isActive) cont.resumeWithException(IllegalStateException("create ${if (offer) "offer" else "answer"} failed: $error"))
                }

                override fun onSetSuccess() = Unit
                override fun onSetFailure(error: String?) = Unit
            }
            if (offer) pc.createOffer(obs, constraints) else pc.createAnswer(obs, constraints)
        }
        return SessionDescriptionData(sdp.type.canonicalForm(), sdp.description)
    }

    override suspend fun setLocalDescription(description: SessionDescriptionData) = set(local = true, description)

    override suspend fun setRemoteDescription(description: SessionDescriptionData) = set(local = false, description)

    private suspend fun set(local: Boolean, d: SessionDescriptionData) {
        val pc = requirePc()
        val desc = SessionDescription(SessionDescription.Type.fromCanonicalForm(d.type), d.sdp)
        suspendCancellableCoroutine { cont ->
            val obs = object : SdpObserver {
                override fun onCreateSuccess(p0: SessionDescription?) = Unit
                override fun onCreateFailure(p0: String?) = Unit
                override fun onSetSuccess() {
                    if (cont.isActive) cont.resume(Unit)
                }

                override fun onSetFailure(error: String?) {
                    if (cont.isActive) cont.resumeWithException(IllegalStateException("set ${if (local) "local" else "remote"} description failed: $error"))
                }
            }
            if (local) pc.setLocalDescription(obs, desc) else pc.setRemoteDescription(obs, desc)
        }
    }

    override fun addIceCandidate(candidate: IceCandidateData): Boolean {
        val pc = pc?.takeIf { !closed } ?: return false
        return pc.addIceCandidate(IceCandidate(candidate.sdpMid ?: "", candidate.sdpMLineIndex, candidate.candidate))
    }

    override fun replaceVideoTrack(track: LocalVideoTrack?): Boolean {
        val pc = pc?.takeIf { !closed } ?: return false
        val transceiver = pc.transceivers.firstOrNull {
            it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO && !it.isStopped
        } ?: return false
        // takeOwnership=false: the SDK disposes its own tracks.
        return transceiver.sender.setTrack(track?.handle as? VideoTrack, false)
    }

    override suspend fun selectedLocalCandidateType(): String? {
        val pc = pc?.takeIf { !closed } ?: return null
        val report = suspendCancellableCoroutine { cont -> pc.getStats { r -> if (cont.isActive) cont.resume(r) } }
        val stats = report.statsMap
        val pair = stats.values.firstOrNull {
            it.type == "candidate-pair" && it.members["state"] == "succeeded" && it.members["nominated"] == true
        } ?: stats.values.firstOrNull { it.type == "candidate-pair" && it.members["state"] == "succeeded" }
        val localId = pair?.members?.get("localCandidateId") as? String ?: return null
        return stats[localId]?.members?.get("candidateType") as? String
    }

    override val iceConnectionState: IceConnectionState get() = state

    override fun close() {
        if (closed) return
        closed = true
        try {
            pc?.dispose()
        } catch (t: Throwable) {
            log.w(t) { "PeerConnection.dispose failed" }
        }
        pc = null
    }
}
