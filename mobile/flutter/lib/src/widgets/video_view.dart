import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../models.dart';

/// How video fills the view.
enum PurpleCallioVideoFit { cover, contain }

/// A renderer a [PurpleCallioVideoView] owns. The default wraps
/// `RTCVideoRenderer`; tests inject a fake.
abstract interface class PurpleCallioVideoRenderer {
  Future<void> initialize();
  Future<void> setSource(PurpleCallioVideoTrack? track);
  Widget build(BuildContext context,
      {required bool mirror, required PurpleCallioVideoFit fit});
  Future<void> dispose();
}

/// Creates a renderer for each [PurpleCallioVideoView].
typedef PurpleCallioVideoRendererFactory = PurpleCallioVideoRenderer
    Function();

class _WebrtcRenderer implements PurpleCallioVideoRenderer {
  final RTCVideoRenderer _renderer = RTCVideoRenderer();

  @override
  Future<void> initialize() => _renderer.initialize();

  @override
  Future<void> setSource(PurpleCallioVideoTrack? track) async {
    final native = track?.native;
    _renderer.srcObject = native is MediaStream ? native : null;
  }

  @override
  Widget build(BuildContext context,
          {required bool mirror, required PurpleCallioVideoFit fit}) =>
      RTCVideoView(
        _renderer,
        mirror: mirror,
        objectFit: fit == PurpleCallioVideoFit.cover
            ? RTCVideoViewObjectFit.RTCVideoViewObjectFitCover
            : RTCVideoViewObjectFit.RTCVideoViewObjectFitContain,
      );

  @override
  Future<void> dispose() async {
    _renderer.srcObject = null;
    await _renderer.dispose();
  }
}

/// Renders a participant's video. Owns its renderer: created in `initState`,
/// re-pointed when the participant's track changes, disposed with the widget.
///
/// Shows [placeholder] (or a neutral default with the participant's initial)
/// when there is no video or the camera is off.
class PurpleCallioVideoView extends StatefulWidget {
  const PurpleCallioVideoView({
    super.key,
    required this.participant,
    this.mirror,
    this.fit = PurpleCallioVideoFit.cover,
    this.placeholder,
    this.rendererFactory,
  });

  final PurpleCallioParticipant? participant;

  /// Defaults to `true` for the local participant (selfie view) and `false`
  /// for remote. For a local back camera pass `false`.
  final bool? mirror;

  final PurpleCallioVideoFit fit;

  /// Shown when there is no visible video.
  final WidgetBuilder? placeholder;

  /// For tests and custom renderers.
  final PurpleCallioVideoRendererFactory? rendererFactory;

  @override
  State<PurpleCallioVideoView> createState() => _PurpleCallioVideoViewState();
}

class _PurpleCallioVideoViewState extends State<PurpleCallioVideoView> {
  late final PurpleCallioVideoRenderer _renderer =
      (widget.rendererFactory ?? _WebrtcRenderer.new)();
  bool _ready = false;
  bool _disposed = false;
  PurpleCallioVideoTrack? _source;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      await _renderer.initialize();
    } catch (_) {
      return;
    }
    if (_disposed) return;
    _ready = true;
    await _sync();
    if (mounted) setState(() {});
  }

  Future<void> _sync() async {
    if (!_ready || _disposed) return;
    final track = widget.participant?.videoTrack;
    if (track == _source) return;
    _source = track;
    await _renderer.setSource(track);
  }

  @override
  void didUpdateWidget(covariant PurpleCallioVideoView oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  @override
  void dispose() {
    _disposed = true;
    _renderer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.participant;
    final visible = _ready && p != null && p.hasVisibleVideo;
    if (!visible) {
      return widget.placeholder?.call(context) ?? _DefaultPlaceholder(p);
    }
    return _renderer.build(
      context,
      mirror: widget.mirror ?? (p.isLocal && !p.isScreenSharing),
      fit: widget.fit,
    );
  }
}

class _DefaultPlaceholder extends StatelessWidget {
  const _DefaultPlaceholder(this.participant);
  final PurpleCallioParticipant? participant;

  @override
  Widget build(BuildContext context) {
    final name = participant?.displayName ?? '';
    final initial = name.isNotEmpty ? name.characters.first.toUpperCase() : '';
    final scheme = Theme.of(context).colorScheme;
    return ColoredBox(
      color: scheme.surfaceContainerHighest,
      child: Center(
        child: CircleAvatar(
          radius: 32,
          backgroundColor: scheme.secondaryContainer,
          child: initial.isEmpty
              ? Icon(Icons.person, color: scheme.onSecondaryContainer)
              : Text(initial,
                  style: TextStyle(
                      fontSize: 28, color: scheme.onSecondaryContainer)),
        ),
      ),
    );
  }
}
