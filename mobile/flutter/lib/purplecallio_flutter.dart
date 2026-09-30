/// PurpleCallio Flutter SDK: 1:1 voice and video calls on Android and iOS.
///
/// Headless core ([PurpleCallioClient], [PurpleCallioMeeting]) plus optional,
/// unbranded widgets ([PurpleCallioVideoView], [PurpleCallioParticipantList])
/// and an opt-in lifecycle helper ([PurpleCallioLifecycle]).
library;

export 'src/client.dart' show PurpleCallioClient;
export 'src/errors.dart';
export 'src/events.dart';
export 'src/ice_servers.dart' show mergeIceServers, kFallbackStunServer;
export 'src/logging.dart';
export 'src/meeting.dart' show PurpleCallioMeeting, PurpleCallioTimings;
export 'src/models.dart';
export 'src/widgets/lifecycle.dart';
export 'src/widgets/participant_list.dart';
export 'src/widgets/video_view.dart';
