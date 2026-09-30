package com.purplecallio.android.internal.android

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.purplecallio.android.Logger
import com.purplecallio.android.PurpleCallioPermissionKind
import com.purplecallio.android.PurpleCallioScreenShareService
import com.purplecallio.android.internal.MeetingPlatform
import kotlinx.coroutines.withTimeout

internal class AndroidMeetingPlatform(
    context: Context,
    private val log: Logger,
) : MeetingPlatform {
    private val context = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    override fun hasPermission(kind: PurpleCallioPermissionKind): Boolean {
        val permission = when (kind) {
            PurpleCallioPermissionKind.CAMERA -> Manifest.permission.CAMERA
            PurpleCallioPermissionKind.MICROPHONE -> Manifest.permission.RECORD_AUDIO
            PurpleCallioPermissionKind.SCREEN -> return true // consent is per-capture, via MediaProjection
        }
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }

    // ------------------------------------------------------------ audio

    private var saved: SavedAudio? = null
    private var focusRequest: AudioFocusRequest? = null
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        log.d { "Audio focus change: $change" }
    }

    private data class SavedAudio(val mode: Int, val speakerphone: Boolean, val micMute: Boolean)

    @Suppress("DEPRECATION")
    @Synchronized
    override fun startAudioSession(video: Boolean) {
        if (saved != null) return
        saved = SavedAudio(audio.mode, audio.isSpeakerphoneOn, audio.isMicrophoneMute)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .setOnAudioFocusChangeListener(focusListener)
                .build()
            focusRequest = req
            audio.requestAudioFocus(req)
        } else {
            audio.requestAudioFocus(focusListener, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        }
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        audio.isMicrophoneMute = false
        // Video calls default to the loudspeaker unless a headset is connected.
        val speaker = video && !hasHeadset()
        setSpeaker(speaker)
        log.d { "Audio session started (speaker=$speaker)" }
    }

    @Suppress("DEPRECATION")
    private fun setSpeaker(on: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (on) {
                audio.availableCommunicationDevices
                    .firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                    ?.let { audio.setCommunicationDevice(it) }
            } else {
                audio.clearCommunicationDevice()
            }
        } else {
            audio.isSpeakerphoneOn = on
        }
    }

    private fun hasHeadset(): Boolean = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
        it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
            it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
            it.type == AudioDeviceInfo.TYPE_USB_HEADSET ||
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && it.type == AudioDeviceInfo.TYPE_BLE_HEADSET)
    }

    @Suppress("DEPRECATION")
    @Synchronized
    override fun stopAudioSession() {
        val s = saved ?: return
        saved = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audio.clearCommunicationDevice()
        }
        audio.isSpeakerphoneOn = s.speakerphone
        audio.isMicrophoneMute = s.micMute
        audio.mode = s.mode
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { audio.abandonAudioFocusRequest(it) }
            focusRequest = null
        } else {
            audio.abandonAudioFocus(focusListener)
        }
        log.d { "Audio session restored" }
    }

    // ------------------------------------------------------------ lifecycle

    override fun observeAppLifecycle(onBackground: () -> Unit, onForeground: () -> Unit): AutoCloseable {
        val observer = object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = onForeground()
            override fun onStop(owner: LifecycleOwner) = onBackground()
        }
        val lifecycle = ProcessLifecycleOwner.get().lifecycle
        runOnMain { lifecycle.addObserver(observer) }
        return AutoCloseable { runOnMain { lifecycle.removeObserver(observer) } }
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
    }

    // ------------------------------------------------------------ screen share

    override fun isScreenCaptureConsentGranted(resultCode: Int): Boolean = resultCode == Activity.RESULT_OK

    override suspend fun startScreenShareService() {
        val started = PurpleCallioScreenShareService.prepareStart()
        ContextCompat.startForegroundService(context, Intent(context, PurpleCallioScreenShareService::class.java))
        withTimeout(5_000) { started.await() }
    }

    override fun stopScreenShareService() {
        context.stopService(Intent(context, PurpleCallioScreenShareService::class.java))
    }
}
