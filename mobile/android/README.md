# PurpleCallio Android SDK

Native Kotlin SDK for 1:1 audio/video calls using PurpleCallio participant
tokens, REST, Socket.IO signaling, and WebRTC.

> **Preview status:** the library, JVM tests, and consumer sample source are
> present. This environment has no Java runtime and Gradle could not initialize
> its native services, so there is no verified Android build/test or physical
> device result. Do not publish or use this as a production-ready SDK yet. See
> [STATUS.md](STATUS.md).

## Requirements and permissions

- Android `minSdk 24`, compile SDK 35, JDK 17, and Android Gradle Plugin 8.7.3.
- Request `RECORD_AUDIO` and, for video calls, `CAMERA` at runtime before
  joining as caller or accepting as receiver. The SDK exposes
  `PurpleCallioPermissions.required()` and `.missing()` helpers but does not
  own an Activity or display permission prompts.
- The SDK manifest declares network/media permissions and its non-exported
  MediaProjection foreground service. Screen sharing needs fresh user consent
  from `MediaProjectionManager.createScreenCaptureIntent()` for every start.

## Add the library

The Maven publication configuration is present, but no artifact has been
published. For local development in a host project, include the library by
path:

```kotlin
// settings.gradle.kts
include(":purplecallio")
project(":purplecallio").projectDir = file("../BlueJoinet/mobile/android/purplecallio")

// app/build.gradle.kts
dependencies {
    implementation(project(":purplecallio"))
}
```

The sample app in this repository demonstrates this project dependency. Use
the Maven coordinate only after a release repository and signed artifact are
configured.

## Join a call

Your trusted backend creates the call with its project API key and passes the
corresponding participant token to the app. Never include an API key, API
secret, or server credential in Android resources, BuildConfig, or client
code.

```kotlin
class CallViewModel(application: Application) : AndroidViewModel(application) {
    private val client = PurpleCallioClient(application)
    var meeting: PurpleCallioMeeting? = null
        private set

    suspend fun join(participantToken: String) {
        meeting = client.joinMeeting(
            token = participantToken,
            options = PurpleCallioJoinOptions(
                microphoneEnabled = true,
                cameraEnabled = true,
                cameraPosition = PurpleCallioCameraPosition.FRONT,
            ),
        )
    }

    suspend fun toggleMicrophone() { meeting?.toggleMicrophone() }
    suspend fun toggleCamera() { meeting?.toggleCamera() }
    suspend fun switchCamera() { meeting?.switchCamera() }
    suspend fun leave() { meeting?.leave(); meeting = null }

    override fun onCleared() {
        client.dispose()
    }
}
```

Observe `connectionState`, `participants`, `localParticipant`, and
`remoteParticipant` using their `StateFlow`s from a lifecycle-aware scope. A
receiver observes `incomingCall` and calls `accept()` or `reject()`. Render
video with `PurpleCallioVideoView`: call `attach(meeting, participant)` when
the participant snapshot changes and `release()` when the view is destroyed.

## Media and lifecycle

Microphone and camera have enable/disable/toggle operations. Camera switching
uses the active capturer's front/back camera switch. `toggleCamera()` flips
the current state. The meeting monitors process foreground/background state,
pauses camera capture while backgrounded, and manages voice-call audio focus;
keep the meeting in a ViewModel or service across Activity recreation.

For screen sharing, launch `MediaProjectionManager.createScreenCaptureIntent()`
through the Activity Result API and pass the result to
`meeting.startScreenShare(resultCode, data)`. Call `stopScreenShare()` to
restore the camera. The OS share UI can also stop capture; the SDK handles that
system stop.

Call `leave()` for graceful termination. `dispose()` releases resources without
signaling; `client.dispose()` disposes all meetings. Do not persist or log
participant tokens. Logging defaults to `NONE` and redacts token and TURN
credential values.

## Sample and release boundary

The `sample` application is intended to demonstrate token-only integration,
permissions, rendering, controls, and screen capture. The SDK source includes
WebRTC, signaling, participant events, state/recovery, and cleanup. Neither the
sample nor library has been built in this environment. Gradle/JVM tests,
consumer sync, instrumentation tests, physical Android media testing, and
Maven publication must pass before production release.
