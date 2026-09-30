package com.purplecallio.android.internal

import com.purplecallio.android.PurpleCallioCallType
import com.purplecallio.android.PurpleCallioCameraPosition
import com.purplecallio.android.PurpleCallioIceServer
import com.purplecallio.android.PurpleCallioPermissionKind

// Everything in this file is pure Kotlin so the meeting engine can run on a
// plain JVM in unit tests. Real implementations wrap io.socket, OkHttp and
// stream-webrtc-android; tests inject fakes.

/** Signaling payloads are plain maps/lists/strings/numbers/booleans (JSON-shaped). */
internal typealias Payload = Map<String, Any?>

internal interface SignalingListener {
    /** Fired on the initial connect and on every socket.io auto-reconnect. */
    fun onConnect()

    /** Fired whenever the socket drops. [serverInitiated] = the server kicked us (no auto-reconnect). */
    fun onDisconnect(reason: String, serverInitiated: Boolean)

    /** Fired when a connection attempt fails (the transport keeps retrying). */
    fun onConnectError(cause: Throwable?)
}

/** A Socket.IO connection to the PurpleCallio gateway (default namespace, websocket). */
internal interface SignalingChannel {
    var listener: SignalingListener?

    val isConnected: Boolean

    /** Starts connecting; auto-reconnect is enabled until [disconnect]. */
    fun connect()

    /** Emits without an ack. Dropped (not buffered) while disconnected. */
    fun emit(event: String, payload: Payload? = null)

    /** Emits with an ack; [onAck] receives the first ack argument (or null). */
    fun emitWithAck(event: String, payload: Payload, onAck: (Any?) -> Unit)

    /** Registers a handler for a server event; payload is the first argument (or null). */
    fun on(event: String, handler: (Payload?) -> Unit)

    /** Removes every handler registered with [on] and the [listener]. */
    fun removeAllHandlers()

    /** Disconnects and turns reconnection off. Idempotent. */
    fun disconnect()
}

/** Error from the REST API with its HTTP status. */
internal class ApiException(val status: Int, message: String) : Exception(message)

internal data class CallDetails(
    val callId: String,
    val type: PurpleCallioCallType,
    val status: String,
    val callerId: String?,
    val receiverId: String?,
    val callerName: String?,
    val callerAvatar: String?,
    val receiverName: String?,
    val receiverAvatar: String?,
    val participantId: String?,
)

internal enum class CallAction(val path: String) {
    ACCEPT("accept"),
    REJECT("reject"),
    CANCEL("cancel"),
    JOIN("join"),
    LEAVE("leave"),
    END("end"),
    WEBRTC_TRANSPORT("webrtc-transport"),
    WEBRTC_ICE("webrtc-ice"),
}

/** PurpleCallio REST API, authenticated with `Authorization: Bearer <participant token>`. */
internal interface PurpleCallioApi {
    /** GET /turn/credentials. */
    suspend fun turnCredentials(token: String): List<PurpleCallioIceServer>

    /** GET /calls/:callId/details. */
    suspend fun callDetails(callId: String, token: String): CallDetails

    /** POST /calls/:callId/<action>. */
    suspend fun post(callId: String, action: CallAction, token: String, body: Payload? = null)
}

// ---------------------------------------------------------------- RTC

internal data class SessionDescriptionData(val type: String, val sdp: String)

internal data class IceCandidateData(val candidate: String, val sdpMid: String?, val sdpMLineIndex: Int)

internal enum class IceConnectionState { NEW, CHECKING, CONNECTED, COMPLETED, DISCONNECTED, FAILED, CLOSED }

internal interface RtcPeerObserver {
    fun onIceCandidate(candidate: IceCandidateData)
    fun onIceConnectionStateChanged(state: IceConnectionState)
    /** A remote video track arrived. [handle] is the platform track. */
    fun onRemoteVideoTrack(handle: Any, id: String)
}

internal interface LocalTrack {
    /** Platform handle (org.webrtc.MediaStreamTrack on device). */
    val handle: Any
    val id: String
    fun setEnabled(enabled: Boolean)
    fun dispose()
}

internal interface LocalAudioTrack : LocalTrack

internal interface LocalVideoTrack : LocalTrack

internal interface LocalCameraTrack : LocalVideoTrack {
    val position: PurpleCallioCameraPosition
    val isCapturing: Boolean
    /** Reported asynchronously when the camera fails or disconnects. */
    var onCaptureError: ((Throwable) -> Unit)?
    /** Opens the camera. Throws on immediate failure. */
    fun startCapture()
    /** Releases the camera. Safe to call when not capturing. */
    fun stopCapture()
    /** Front ↔ back; returns the new position. */
    suspend fun switchCamera(): PurpleCallioCameraPosition
}

internal interface LocalScreenTrack : LocalVideoTrack {
    fun startCapture()
    fun stopCapture()
}

internal interface RtcPeer {
    fun addTrack(track: LocalTrack, streamId: String)
    /** Adds a send/receive video transceiver with no track (a VIDEO caller without a camera). */
    fun addVideoTransceiver(streamId: String)
    suspend fun createOffer(iceRestart: Boolean): SessionDescriptionData
    suspend fun createAnswer(): SessionDescriptionData
    suspend fun setLocalDescription(description: SessionDescriptionData)
    suspend fun setRemoteDescription(description: SessionDescriptionData)
    fun addIceCandidate(candidate: IceCandidateData): Boolean
    /** Swaps the video sender's track without renegotiation. False when there is no video sender. */
    fun replaceVideoTrack(track: LocalVideoTrack?): Boolean
    /** Local candidate type of the selected pair (host/srflx/prflx/relay), best effort. */
    suspend fun selectedLocalCandidateType(): String?
    val iceConnectionState: IceConnectionState
    /** Closes and disposes the peer connection. Idempotent. */
    fun close()
}

/** Per-meeting media engine (one PeerConnectionFactory on device). */
internal interface RtcEngine {
    fun createPeer(iceServers: List<PurpleCallioIceServer>, observer: RtcPeerObserver): RtcPeer
    fun createAudioTrack(): LocalAudioTrack
    fun createCameraTrack(position: PurpleCallioCameraPosition): LocalCameraTrack
    /** [consentData] is the MediaProjection consent Intent. [onStopped]: capture ended by the system/user. */
    fun createScreenTrack(consentData: Any, onStopped: () -> Unit): LocalScreenTrack
    /** Releases the factory, audio device module and the shared EGL reference. Idempotent. */
    fun dispose()
}

// ---------------------------------------------------------------- platform

/** Android services the engine needs, behind an interface for JVM tests. */
internal interface MeetingPlatform {
    fun hasPermission(kind: PurpleCallioPermissionKind): Boolean

    /** MODE_IN_COMMUNICATION + audio focus; speakerphone for video. */
    fun startAudioSession(video: Boolean)

    /** Restores the audio state captured by [startAudioSession]. Idempotent. */
    fun stopAudioSession()

    /** Observes process foreground/background. Returns a handle that unregisters. */
    fun observeAppLifecycle(onBackground: () -> Unit, onForeground: () -> Unit): AutoCloseable

    /** Whether the MediaProjection consent result code means "granted". */
    fun isScreenCaptureConsentGranted(resultCode: Int): Boolean

    /** Starts the mediaProjection foreground service and waits until it is in the foreground. */
    suspend fun startScreenShareService()

    fun stopScreenShareService()
}
