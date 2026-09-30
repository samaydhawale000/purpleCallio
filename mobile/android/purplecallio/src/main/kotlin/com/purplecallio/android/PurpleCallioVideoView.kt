package com.purplecallio.android

import android.content.Context
import android.util.AttributeSet
import android.view.ViewGroup
import android.widget.FrameLayout
import com.purplecallio.android.internal.rtc.SharedEgl
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * Renders one participant's video (camera, or screen while sharing) using a
 * [SurfaceViewRenderer] on the SDK's shared EGL context.
 *
 * Call [attach] with the meeting and the participant to show; the view
 * follows track changes (screen share on/off, remote track arrival) and
 * mirrors the local front camera. Call [release] when done (for example in
 * `onDestroyView`/`onDestroy`); the view can be attached again afterwards.
 */
class PurpleCallioVideoView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : FrameLayout(context, attrs, defStyleAttr) {

    private val renderer = SurfaceViewRenderer(context)
    private var initialized = false
    private var scope: CoroutineScope? = null
    private var job: Job? = null
    private var boundTrack: VideoTrack? = null

    /** Aspect handling; default [RendererCommon.ScalingType.SCALE_ASPECT_FILL]. */
    var scalingType: RendererCommon.ScalingType = RendererCommon.ScalingType.SCALE_ASPECT_FILL
        set(value) {
            field = value
            renderer.setScalingType(value)
        }

    /** Set to override automatic mirroring (null = mirror the local front camera only). */
    var mirrorOverride: Boolean? = null

    /** Draw on top of another SurfaceView (for a picture-in-picture local preview). */
    fun setZOrderMediaOverlay(overlay: Boolean) = renderer.setZOrderMediaOverlay(overlay)

    init {
        addView(renderer, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    /** Shows [participant]'s video from [meeting] and keeps following it. */
    fun attach(meeting: PurpleCallioMeeting, participant: PurpleCallioParticipant) {
        ensureInitialized()
        job?.cancel()
        val s = scope ?: CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).also { scope = it }
        val source: Flow<PurpleCallioParticipant?> =
            if (participant.isLocal) meeting.localParticipant else meeting.remoteParticipant
        job = s.launch {
            combine(source, meeting.cameraPosition) { p, position ->
                val track = p?.videoTrack?.webrtcTrack
                val mirror = mirrorOverride
                    ?: (p?.isLocal == true && !p.isScreenSharing && position == PurpleCallioCameraPosition.FRONT)
                track to mirror
            }.distinctUntilChanged().collect { (track, mirror) ->
                renderer.setMirror(mirror)
                bind(track)
            }
        }
    }

    /** Stops rendering and releases the renderer and its EGL reference. Idempotent. */
    fun release() {
        job?.cancel()
        job = null
        scope?.cancel()
        scope = null
        bind(null)
        if (initialized) {
            initialized = false
            renderer.release()
            SharedEgl.release()
        }
    }

    private fun ensureInitialized() {
        if (initialized) return
        val egl = SharedEgl.acquire()
        renderer.init(egl.eglBaseContext, null)
        renderer.setScalingType(scalingType)
        renderer.setEnableHardwareScaler(true)
        initialized = true
    }

    private fun bind(track: VideoTrack?) {
        if (boundTrack === track) return
        boundTrack?.let { old ->
            // The track may already be disposed by the meeting's cleanup.
            try {
                old.removeSink(renderer)
            } catch (_: IllegalStateException) {
            }
        }
        boundTrack = null
        if (track != null) {
            try {
                track.addSink(renderer)
                boundTrack = track
            } catch (_: IllegalStateException) {
                // Disposed between publication and binding.
            }
        }
        if (boundTrack == null && initialized) renderer.clearImage()
    }
}
