export { PurpleCallioClient } from './client';
export { PurpleCallioMeeting } from './meeting/meeting';

// Default export = REST client for server-side convenience.
import { PurpleCallioClient } from './client';
export default PurpleCallioClient;

export type {
  ConnectivityFailureReason,
  ConnectivityStatus,
  MediaPath,
} from './webrtc/connectivity';

export type {
  PurpleCallioConfig,
  Branding,
  Call,
  CallDetails,
  CallStatus,
  CallType,
  ConnectionState,
  CreateCallParams,
  CreateCallResult,
  EngineConfig,
  JoinCallResult,
  MeetingSnapshot,
  Participant,
  ParticipantMedia,
  ParticipantRole,
  ParticipantToken,
} from './types';
