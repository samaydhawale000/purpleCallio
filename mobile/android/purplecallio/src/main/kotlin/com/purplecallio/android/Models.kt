package com.purplecallio.android

/** Role of a participant in a 1:1 call. The CALLER always makes the offer. */
enum class PurpleCallioRole { CALLER, RECEIVER }

/** Call type, fixed at call creation by your backend. */
enum class PurpleCallioCallType { AUDIO, VIDEO }

/** Which camera is (or should be) in use. */
enum class PurpleCallioCameraPosition { FRONT, BACK }

/**
 * Unified connection state, identical across the PurpleCallio native SDKs.
 *
 * ```
 * IDLE → CONNECTING → RINGING → JOINING → CONNECTED ⇄ RECONNECTING
 *                                        ↘ DISCONNECTED (terminal, see disconnectReason)
 *                                        ↘ FAILED       (terminal, see error)
 * ```
 */
enum class PurpleCallioConnectionState {
    IDLE,
    CONNECTING,
    RINGING,
    JOINING,
    CONNECTED,
    RECONNECTING,
    DISCONNECTED,
    FAILED;

    /** True for [DISCONNECTED] and [FAILED]; nothing happens after a terminal state. */
    val isTerminal: Boolean get() = this == DISCONNECTED || this == FAILED
}

/** Why a meeting reached [PurpleCallioConnectionState.DISCONNECTED]. */
enum class PurpleCallioDisconnectReason {
    /** This device left (leave(), cancel while ringing, or dispose()). */
    LEFT,
    /** The other participant hung up. */
    REMOTE_ENDED,
    /** The receiver declined the call. */
    REJECTED,
    /** The caller cancelled while ringing. */
    CANCELLED,
    /** Nobody answered before the server's ring timeout. */
    MISSED,
    /** The receiver was already in another call. */
    BUSY,
    /** The same participant token connected from another device/socket. */
    SESSION_REPLACED,
    /** The server expired the call (for example a time-limited playground call). */
    EXPIRED,
}

/** Kind of runtime permission or capture consent. */
enum class PurpleCallioPermissionKind { CAMERA, MICROPHONE, SCREEN }

/** Log verbosity. Default is [NONE]. */
enum class PurpleCallioLogLevel { NONE, ERROR, WARNING, INFO, DEBUG }

/**
 * Options for [PurpleCallioClient.joinMeeting].
 *
 * @property microphoneEnabled start with the microphone on.
 * @property cameraEnabled start with the camera on (ignored for AUDIO calls).
 * @property cameraPosition which camera to open first.
 */
data class PurpleCallioJoinOptions(
    val microphoneEnabled: Boolean = true,
    val cameraEnabled: Boolean = true,
    val cameraPosition: PurpleCallioCameraPosition = PurpleCallioCameraPosition.FRONT,
)

/**
 * A STUN/TURN server. [credential] is never included in [toString] or logs.
 */
class PurpleCallioIceServer(
    val urls: List<String>,
    val username: String? = null,
    val credential: String? = null,
) {
    constructor(url: String, username: String? = null, credential: String? = null) :
        this(listOf(url), username, credential)

    override fun equals(other: Any?): Boolean =
        other is PurpleCallioIceServer && other.urls == urls &&
            other.username == username && other.credential == credential

    override fun hashCode(): Int = (urls.hashCode() * 31 + username.hashCode()) * 31 + credential.hashCode()

    override fun toString(): String =
        "PurpleCallioIceServer(urls=$urls, username=${if (username != null) "<set>" else "null"}, " +
            "credential=${if (credential != null) "<redacted>" else "null"})"
}

/**
 * Opaque handle to a video track, for rendering with [PurpleCallioVideoView].
 * [webrtcTrack] exposes the underlying `org.webrtc.VideoTrack` for apps with
 * their own renderers. Do not dispose it yourself; the SDK owns its lifecycle.
 */
class PurpleCallioVideoTrack internal constructor(
    /** The platform track (`org.webrtc.VideoTrack` on device; a fake in tests). */
    internal val handle: Any,
    /** Stable id of the track. */
    val id: String,
) {
    /** The underlying WebRTC track, or null if not backed by WebRTC. */
    val webrtcTrack: org.webrtc.VideoTrack? get() = handle as? org.webrtc.VideoTrack

    override fun equals(other: Any?): Boolean = other is PurpleCallioVideoTrack && other.handle === handle
    override fun hashCode(): Int = System.identityHashCode(handle)
    override fun toString(): String = "PurpleCallioVideoTrack(id=$id)"
}

/**
 * Immutable snapshot of a participant. A new snapshot is published on every
 * change through [PurpleCallioMeeting.localParticipant] /
 * [PurpleCallioMeeting.remoteParticipant] / [PurpleCallioMeeting.participants].
 *
 * Names and avatars come from `/calls/:id/details` only; nothing is invented.
 */
data class PurpleCallioParticipant(
    val participantId: String,
    val displayName: String?,
    val avatarUrl: String?,
    val role: PurpleCallioRole,
    val isLocal: Boolean,
    val isMicrophoneEnabled: Boolean,
    val isCameraEnabled: Boolean,
    val isScreenSharing: Boolean,
    /** Video to render: camera, or the screen while sharing. Null for audio-only. */
    val videoTrack: PurpleCallioVideoTrack?,
)

/** Payload of the server's `incoming-call` event (RECEIVER only). */
data class PurpleCallioIncomingCall(
    val callId: String,
    val callerId: String?,
    val callerName: String?,
    val callerAvatar: String?,
    val type: PurpleCallioCallType,
)

/** Events delivered through [PurpleCallioMeeting.events]. */
sealed class PurpleCallioEvent {
    data class ConnectionStateChanged(val state: PurpleCallioConnectionState) : PurpleCallioEvent()
    data class IncomingCall(val call: PurpleCallioIncomingCall) : PurpleCallioEvent()
    data class ParticipantJoined(val participant: PurpleCallioParticipant) : PurpleCallioEvent()
    data class ParticipantLeft(val participant: PurpleCallioParticipant) : PurpleCallioEvent()
    data class ParticipantUpdated(val participant: PurpleCallioParticipant) : PurpleCallioEvent()
    data class RemoteTrackAdded(
        val participant: PurpleCallioParticipant,
        val track: PurpleCallioVideoTrack,
    ) : PurpleCallioEvent()
    /** A non-fatal (or the fatal, just before FAILED) error. */
    data class Error(val error: PurpleCallioError) : PurpleCallioEvent()
    data class Ended(val reason: PurpleCallioDisconnectReason) : PurpleCallioEvent()
}

/**
 * Every error the SDK throws or reports. Raw platform exceptions are only
 * ever attached as [cause].
 */
sealed class PurpleCallioError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** The participant token is invalid or expired. */
    class InvalidToken : PurpleCallioError("The participant token is invalid or expired")

    /** Authentication did not complete (for example the ack timed out). */
    class AuthenticationFailed(message: String, cause: Throwable? = null) :
        PurpleCallioError("Authentication failed: $message", cause)

    /** The signaling socket or REST API could not be reached. */
    class ConnectionFailed(cause: Throwable?) :
        PurpleCallioError("Connection failed: ${cause?.message ?: "unknown"}", cause)

    /** The server rejected or failed a signaling/REST operation. */
    class SignalingFailed(cause: Throwable?) :
        PurpleCallioError("Signaling failed: ${cause?.message ?: "unknown"}", cause)

    /** WebRTC negotiation or ICE failed. */
    class WebrtcFailed(cause: Throwable?) :
        PurpleCallioError("WebRTC failed: ${cause?.message ?: "unknown"}", cause)

    /** A runtime permission (or screen-capture consent) is missing. */
    class PermissionDenied(val kind: PurpleCallioPermissionKind) :
        PurpleCallioError("Permission denied: ${kind.name.lowercase()}")

    /** Camera or microphone could not be started. */
    class MediaInitializationFailed(cause: Throwable?) :
        PurpleCallioError("Media initialization failed: ${cause?.message ?: "unknown"}", cause)

    /** Screen share cannot run (audio call, declined consent, unsupported, ...). */
    class ScreenShareUnavailable(val reason: String) :
        PurpleCallioError("Screen share unavailable: $reason")

    /** The call is already over. */
    class MeetingEnded(val reason: PurpleCallioDisconnectReason) :
        PurpleCallioError("Meeting ended: ${reason.name.lowercase()}")

    /** The operation is not valid in the current state or for this role/type. */
    class InvalidState(message: String) : PurpleCallioError(message)
}
