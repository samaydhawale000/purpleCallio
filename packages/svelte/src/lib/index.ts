export { createPurpleCallio } from './createPurpleCallio.js';
export type {
  PurpleCallioCall,
  PurpleCallioMediaControls,
  PurpleCallioScreenShareControls,
} from './createPurpleCallio.js';

export { default as PurpleCallioVideo } from './PurpleCallioVideo.svelte';

// Re-exported for convenience so consumers don't also need to depend
// directly on `@purplecallio/sdk` just to type their own component props.
export type {
  ConnectionState,
  EngineConfig,
  MeetingSnapshot,
  Participant,
  ParticipantMedia,
  ParticipantRole,
} from '@purplecallio/sdk';

// Live Translate
export { createTranslation } from './createTranslation.js';
export type { CreateTranslationOptions, PurpleCallioTranslation } from './createTranslation.js';
export { default as TranslationCaptions } from './TranslationCaptions.svelte';
export type { TranslationClient, TranslationMode, TranslationPhrase, TranslationState } from '@purplecallio/sdk';
