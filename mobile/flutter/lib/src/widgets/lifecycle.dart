import 'package:flutter/widgets.dart';

import '../meeting.dart';

/// What to do with outgoing camera video while the app is backgrounded.
enum PurpleCallioBackgroundVideo {
  /// Leave video alone (the OS may still interrupt capture, notably on iOS).
  keep,

  /// Default. Silently stop sending camera frames (`track.enabled = false`)
  /// and restore on resume. No `camera.disabled` / `camera.enabled` event is
  /// emitted: the user did not turn their camera off, so billing and the
  /// remote UI keep treating the camera as on (the remote sees a frozen or
  /// black frame).
  suspend,

  /// Really disable the camera (emits `camera.disabled`, a billing input)
  /// and re-enable it on resume (emits `camera.enabled`) if it was on.
  disable,
}

/// Opt-in app lifecycle integration for one meeting.
///
/// ```dart
/// final lifecycle = PurpleCallioLifecycle(meeting)..attach();
/// // ...
/// lifecycle.detach(); // or it detaches itself when the meeting ends
/// ```
///
/// * `paused`/`hidden`: applies [backgroundVideo].
/// * `resumed`: restores.
/// * `detached`: disposes the meeting (local cleanup; the server notices the
///   socket drop). Set [disposeOnDetached] to `false` to opt out.
class PurpleCallioLifecycle with WidgetsBindingObserver {
  PurpleCallioLifecycle(
    this.meeting, {
    this.backgroundVideo = PurpleCallioBackgroundVideo.suspend,
    this.disposeOnDetached = true,
  });

  final PurpleCallioMeeting meeting;
  final PurpleCallioBackgroundVideo backgroundVideo;
  final bool disposeOnDetached;

  bool _attached = false;
  bool _backgrounded = false;
  bool _disabledByUs = false;

  void attach() {
    if (_attached) return;
    _attached = true;
    WidgetsBinding.instance.addObserver(this);
    meeting.connectionStateListenable.addListener(_onState);
  }

  void detach() {
    if (!_attached) return;
    _attached = false;
    WidgetsBinding.instance.removeObserver(this);
    meeting.connectionStateListenable.removeListener(_onState);
  }

  void _onState() {
    if (meeting.connectionState.isTerminal) detach();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
        _enterBackground();
      case AppLifecycleState.resumed:
        _enterForeground();
      case AppLifecycleState.detached:
        if (disposeOnDetached) meeting.dispose();
        detach();
      case AppLifecycleState.inactive:
        break;
    }
  }

  void _enterBackground() {
    if (_backgrounded || meeting.connectionState.isTerminal) return;
    _backgrounded = true;
    switch (backgroundVideo) {
      case PurpleCallioBackgroundVideo.keep:
        break;
      case PurpleCallioBackgroundVideo.suspend:
        meeting.setVideoSuspended(true);
      case PurpleCallioBackgroundVideo.disable:
        if (meeting.isCameraEnabled) {
          _disabledByUs = true;
          meeting.disableCamera().catchError((Object _) {});
        }
    }
  }

  void _enterForeground() {
    if (!_backgrounded) return;
    _backgrounded = false;
    if (meeting.connectionState.isTerminal) return;
    switch (backgroundVideo) {
      case PurpleCallioBackgroundVideo.keep:
        break;
      case PurpleCallioBackgroundVideo.suspend:
        meeting.setVideoSuspended(false);
      case PurpleCallioBackgroundVideo.disable:
        if (_disabledByUs) {
          _disabledByUs = false;
          meeting.enableCamera().catchError((Object _) {});
        }
    }
  }
}
