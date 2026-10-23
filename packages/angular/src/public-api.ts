/*
 * Public API surface of `@purplecallio/angular`.
 */

export {
  PurpleCallioService,
  type PurpleCallioServiceConfig,
} from './lib/purplecallio.service';

export { PurpleCallioVideoDirective } from './lib/purplecallio-video.directive';

// Live Translate
export {
  PurpleCallioTranslationService,
  type PurpleCallioTranslationConfig,
} from './lib/purplecallio-translation.service';
export { PurpleCallioCaptionsComponent } from './lib/purplecallio-captions.component';

// Re-exported for convenience so consumers don't need a direct
// `@purplecallio/sdk` dependency just to type their own components.
export type {
  ConnectionState,
  Participant,
  ParticipantMedia,
  ParticipantRole,
  TranslationClient,
  TranslationMode,
  TranslationPhrase,
  TranslationState,
} from '@purplecallio/sdk';
