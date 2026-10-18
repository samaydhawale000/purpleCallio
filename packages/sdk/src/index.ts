export { PurpleCallioClient } from './client';
export { PurpleCallioMeeting } from './meeting/meeting';
export { PurpleCallioAgentCall } from './ai/agent-call';

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

export type {
  AgentCallConfig,
  AgentCallError,
  AgentCallEvent,
  AgentCallEventMap,
  AgentConnectionState,
  AgentEndedEvent,
  AgentReady,
  AgentState,
  AgentToolCall,
  AgentTranscript,
  AiSession,
  AiSessionStatus,
  CreateAiSessionParams,
  CreateAiSessionResult,
} from './ai/types';
