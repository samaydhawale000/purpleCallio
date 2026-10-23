export { usePurpleCallio } from './composable';
export type {
  MediaControls,
  ScreenShareControls,
  UsePurpleCallioOptions,
  UsePurpleCallioReturn,
} from './composable';

export { default as PurpleCallioVideo } from './components/PurpleCallioVideo.vue';
export type { PurpleCallioVideoProps } from './components/PurpleCallioVideo.types';

// Re-exported for convenience so consumers don't need a direct dependency on
// `@purplecallio/sdk` just to name these types.
export type {
  ConnectionState,
  EngineConfig,
  MeetingSnapshot,
  Participant,
  ParticipantMedia,
  ParticipantRole,
} from '@purplecallio/sdk';

// Live Translate
export { useTranslation, TranslationCaptions } from './translation';
export type { UseTranslationOptions, UseTranslationReturn } from './translation';
export type { TranslationClient, TranslationMode, TranslationPhrase, TranslationState } from '@purplecallio/sdk';
