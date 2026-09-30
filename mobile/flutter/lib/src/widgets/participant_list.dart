import 'package:flutter/material.dart';

import '../meeting.dart';
import '../models.dart';

/// Rebuilds whenever [meeting] changes, passing the current participants.
class PurpleCallioParticipantsBuilder extends StatelessWidget {
  const PurpleCallioParticipantsBuilder({
    super.key,
    required this.meeting,
    required this.builder,
  });

  final PurpleCallioMeeting meeting;
  final Widget Function(
      BuildContext context, List<PurpleCallioParticipant> participants) builder;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: meeting,
        builder: (context, _) => builder(context, meeting.participants),
      );
}

/// A minimal, unbranded participant list (name + mic/camera state).
class PurpleCallioParticipantList extends StatelessWidget {
  const PurpleCallioParticipantList({
    super.key,
    required this.meeting,
    this.itemBuilder,
  });

  final PurpleCallioMeeting meeting;
  final Widget Function(BuildContext, PurpleCallioParticipant)? itemBuilder;

  @override
  Widget build(BuildContext context) {
    return PurpleCallioParticipantsBuilder(
      meeting: meeting,
      builder: (context, participants) => ListView(
        shrinkWrap: true,
        children: [
          for (final p in participants)
            itemBuilder?.call(context, p) ?? _DefaultTile(p),
        ],
      ),
    );
  }
}

class _DefaultTile extends StatelessWidget {
  const _DefaultTile(this.p);
  final PurpleCallioParticipant p;

  @override
  Widget build(BuildContext context) {
    final name = p.displayName ?? p.participantId;
    return ListTile(
      dense: true,
      title: Text(p.isLocal ? '$name (you)' : name),
      subtitle: Text(p.role.name),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(p.isMicrophoneEnabled ? Icons.mic : Icons.mic_off,
              semanticLabel:
                  p.isMicrophoneEnabled ? 'microphone on' : 'microphone off'),
          const SizedBox(width: 8),
          Icon(p.isCameraEnabled ? Icons.videocam : Icons.videocam_off,
              semanticLabel: p.isCameraEnabled ? 'camera on' : 'camera off'),
          if (p.isScreenSharing) ...[
            const SizedBox(width: 8),
            const Icon(Icons.screen_share, semanticLabel: 'sharing screen'),
          ],
        ],
      ),
    );
  }
}
