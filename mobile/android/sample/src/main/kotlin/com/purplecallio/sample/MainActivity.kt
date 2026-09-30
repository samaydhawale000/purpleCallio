package com.purplecallio.sample

import android.app.Activity
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.Lifecycle
import com.purplecallio.android.PurpleCallioClient
import com.purplecallio.android.PurpleCallioConnectionState
import com.purplecallio.android.PurpleCallioMeeting
import com.purplecallio.android.PurpleCallioPermissions
import com.purplecallio.android.PurpleCallioVideoView
import kotlinx.coroutines.launch

/** Minimal token-only consumer app. Create participant tokens on your backend. */
class MainActivity : ComponentActivity() {
    private lateinit var token: EditText
    private lateinit var status: TextView
    private lateinit var localVideo: PurpleCallioVideoView
    private lateinit var remoteVideo: PurpleCallioVideoView
    private lateinit var acceptButton: Button
    private lateinit var rejectButton: Button
    private lateinit var client: PurpleCallioClient
    private var meeting: PurpleCallioMeeting? = null

    private val permissionRequest = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (grants.values.all { it }) joinCall() else status.text = "Camera and microphone permission are required."
    }

    private val screenCaptureRequest = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val data = result.data ?: return@registerForActivityResult
        lifecycleScope.launch {
            runCatching { meeting?.startScreenShare(result.resultCode, data) }
                .onFailure { status.text = it.message ?: "Screen sharing could not start." }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        client = PurpleCallioClient(applicationContext, baseUrl = BuildConfig.PURPLECALLIO_API_URL)
        buildUi()
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 24, 20, 16)
        }
        token = EditText(this).apply {
            hint = "Participant token from your backend"
            isSingleLine = true
        }
        status = TextView(this).apply { text = "Paste a participant token to join." }
        val join = Button(this).apply { text = "Join"; setOnClickListener { requestPermissionsAndJoin() } }
        acceptButton = Button(this).apply {
            text = "Accept incoming call"
            visibility = android.view.View.GONE
            setOnClickListener { lifecycleScope.launch { runCatching { meeting?.accept() }.onFailure { status.text = "Accept failed: ${it.message}" } } }
        }
        rejectButton = Button(this).apply {
            text = "Decline incoming call"
            visibility = android.view.View.GONE
            setOnClickListener { lifecycleScope.launch { runCatching { meeting?.reject() }.onFailure { status.text = "Decline failed: ${it.message}" } } }
        }
        localVideo = PurpleCallioVideoView(this)
        remoteVideo = PurpleCallioVideoView(this)
        root.addView(token, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        root.addView(join)
        root.addView(status)
        root.addView(acceptButton)
        root.addView(rejectButton)
        root.addView(localVideo, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(remoteVideo, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(buttonRow("Mute / unmute") { lifecycleScope.launch { runCatching { meeting?.toggleMicrophone() } } })
        root.addView(buttonRow("Camera on / off") { lifecycleScope.launch { runCatching { meeting?.toggleCamera() } } })
        root.addView(buttonRow("Switch camera") { lifecycleScope.launch { runCatching { meeting?.switchCamera() } } })
        root.addView(buttonRow("Share screen") { requestScreenShare() })
        root.addView(buttonRow("Stop sharing") { lifecycleScope.launch { runCatching { meeting?.stopScreenShare() } } })
        root.addView(buttonRow("Leave") { lifecycleScope.launch { meeting?.leave(); meeting = null; status.text = "Call ended." } })
        setContentView(root)
    }

    private fun buttonRow(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        setOnClickListener { action() }
    }

    private fun requestPermissionsAndJoin() {
        val missing = PurpleCallioPermissions.missing(this, com.purplecallio.android.PurpleCallioCallType.VIDEO)
        if (missing.isNotEmpty()) permissionRequest.launch(missing) else joinCall()
    }

    private fun joinCall() {
        val participantToken = token.text.toString().trim()
        if (participantToken.isEmpty()) {
            status.text = "Enter the participant token issued by your backend."
            return
        }
        lifecycleScope.launch {
            try {
                val call = client.joinMeeting(participantToken)
                meeting = call
                token.text.clear()
                localVideo.attach(call, call.localParticipant.value)
                status.text = "Connected to call ${call.callId} as ${call.role}."
                lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                    launch {
                        call.connectionState.collect { state ->
                            status.text = "${state.name.lowercase()} · ${call.callId}"
                        }
                    }
                    launch {
                        call.incomingCall.collect { incoming ->
                            acceptButton.visibility = if (incoming == null) android.view.View.GONE else android.view.View.VISIBLE
                            rejectButton.visibility = if (incoming == null) android.view.View.GONE else android.view.View.VISIBLE
                        }
                    }
                    launch {
                        call.remoteParticipant.collect { participant ->
                            if (participant != null) remoteVideo.attach(call, participant)
                        }
                    }
                }
            } catch (error: Throwable) {
                status.text = error.message ?: "Could not join the call."
            }
        }
    }

    private fun requestScreenShare() {
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        screenCaptureRequest.launch(manager.createScreenCaptureIntent())
    }

    override fun onDestroy() {
        localVideo.release()
        remoteVideo.release()
        client.dispose()
        super.onDestroy()
    }
}
