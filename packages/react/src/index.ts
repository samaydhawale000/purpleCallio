// Providers
export { MeetingProvider, useMeetingContext } from './context';
export type {
  MeetingProviderProps,
  MeetingContextValue,
} from './context';

// Hooks
export {
  useMeeting,
  useParticipants,
  useParticipant,
  useDevices,
  useConnection,
} from './hooks';
export type {
  DeviceInfo,
  DevicesResult,
} from './hooks';

// Layout components
export {
  MeetingRoom,
  ParticipantGrid,
  ParticipantTile,
  ActiveSpeakerView,
  Avatar,
} from './components/layout';
export type {
  MeetingRoomProps,
  ParticipantGridProps,
  ParticipantTileProps,
  ActiveSpeakerViewProps,
} from './components/layout';

// Control components
export {
  ControlButton,
  CameraButton,
  MicrophoneButton,
  ScreenShareButton,
  LeaveButton,
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
  PhoneDownIcon,
  ScreenShareIcon,
} from './components/controls';
export type {
  ControlButtonProps,
  CameraButtonProps,
  MicrophoneButtonProps,
  LeaveButtonProps,
} from './components/controls';

// Panels + indicators
export {
  DeviceSelector,
  WaitingRoom,
  ConnectionStatus,
  SpeakingIndicator,
  LocalVideoPreview,
} from './components/panels';
export type {
  DeviceSelectorProps,
  WaitingRoomProps,
  SpeakingIndicatorProps,
} from './components/panels';


// AI voice agents
export { usePurpleCallioAI } from './ai';
export type {
  UsePurpleCallioAIOptions,
  UsePurpleCallioAIResult,
  AICallStatus,
  AITranscriptLine,
  AIToolActivity,
} from './ai';
export { PurpleCallioAI, aiErrorMessage } from './components/ai';
export type { PurpleCallioAIProps } from './components/ai';
