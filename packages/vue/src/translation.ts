import { defineComponent, getCurrentInstance, h, onUnmounted, ref, shallowRef, type PropType, type Ref, type ShallowRef } from 'vue';

import {
  TranslationClient,
  describeGuardReasons,
  isRtlLanguage,
  fontStackForScript,
  lineHeightForScript,
  loadScriptFont,
  scriptForLanguage,
  type TranslationClientConfig,
  type TranslationMode,
  type TranslationOptions,
  type TranslationPhrase,
  type TranslationReady,
  type TranslationRepeatRequest,
  type TranslationState,
} from '@purplecallio/sdk';

export interface UseTranslationOptions extends Partial<TranslationClientConfig> {
  /** Use an existing client (e.g. `meeting.translation`); otherwise built from `serverUrl` + `token`. */
  client?: TranslationClient;
}

export interface UseTranslationReturn {
  client: TranslationClient;
  state: ShallowRef<TranslationState>;
  phrases: ShallowRef<TranslationPhrase[]>;
  repeatRequests: Ref<TranslationRepeatRequest[]>;
  /** Resolves with `ready`, or `null` on failure (see `state.error`). */
  enable(options?: TranslationOptions): Promise<TranslationReady | null>;
  /**
   * Turns translation off. With `meeting.translation` that is for the whole
   * call; `{ share: false }` leaves only this participant (e.g. on hang-up).
   */
  disable(options?: { share?: boolean }): void;
  /** "Join translation": retries audio the browser blocked (`state.audioBlocked`). Call from a click. */
  resumeAudio(): Promise<boolean>;
  setMode(mode: TranslationMode): void;
  setLanguages(languages: { speak?: string; hear?: string }): void;
  setOriginalVolume(volume: number): void;
  replay(phraseId: string, options?: { rate?: number }): boolean;
  requestRepeat(phraseId: string): boolean;
  /** Unsubscribes (and disables a client this composable built). Runs on unmount automatically. */
  destroy(): void;
}

/** Live Translate composable: reactive state + DualView phrases around the SDK's `TranslationClient`. */
export function useTranslation(options: UseTranslationOptions): UseTranslationReturn {
  const owned = !options.client;
  let client: TranslationClient;
  if (options.client) client = options.client;
  else {
    if (!options.serverUrl || !options.token) throw new Error('PurpleCallio: serverUrl and token are required');
    const { client: _c, ...config } = options;
    client = new TranslationClient(config as TranslationClientConfig);
  }

  const state = shallowRef<TranslationState>(client.getState());
  const phrases = shallowRef<TranslationPhrase[]>(client.phrases);
  const repeatRequests = ref<TranslationRepeatRequest[]>([]);
  const offs = [
    client.on('state', (s) => (state.value = s)),
    client.on('phrases', (list) => (phrases.value = list)),
    client.on('repeat.requested', (r) => (repeatRequests.value = [...repeatRequests.value.filter((x) => x.phraseId !== r.phraseId), r])),
  ];

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    offs.forEach((off) => off());
    if (owned) client.disable();
  };
  if (getCurrentInstance()) onUnmounted(destroy);

  return {
    client,
    state,
    phrases,
    repeatRequests,
    enable: (o) => client.enable(o).catch(() => null),
    disable: (o) => client.disable(o),
    resumeAudio: () => client.resumeAudio(),
    setMode: (m) => client.setMode(m),
    setLanguages: (l) => client.setLanguages(l),
    setOriginalVolume: (v) => client.setOriginalVolume(v),
    replay: (id, o) => client.replay(id, o),
    requestRepeat: (id) => client.requestRepeat(id),
    destroy,
  };
}

function scriptText(text: string, language: string, cls: string) {
  const script = scriptForLanguage(language);
  return h(
    'p',
    {
      class: cls,
      lang: language && language !== 'auto' ? language : undefined,
      dir: isRtlLanguage(language) ? 'rtl' : 'auto',
      style: { margin: 0, fontFamily: fontStackForScript(script), lineHeight: lineHeightForScript(script) },
    },
    text,
  );
}

/**
 * DualView captions: original + translated per phrase, highlight while its
 * translated audio plays, amber "May not be accurate — check" marker with
 * plain reasons, "Ask to repeat" and (when enabled) "Replay original".
 * Style via the `pc-tr-*` classes.
 */
export const TranslationCaptions = defineComponent({
  name: 'TranslationCaptions',
  props: {
    translation: { type: Object as PropType<UseTranslationReturn>, required: true },
    layout: { type: String as PropType<'translated' | 'both' | 'original'>, default: 'both' },
    maxPhrases: { type: Number, default: 0 },
    loadFonts: { type: Boolean, default: true },
  },
  setup(props) {
    return () => {
      const tr = props.translation;
      const all = tr.phrases.value;
      const phrases = props.maxPhrases ? all.slice(-props.maxPhrases) : all;
      if (props.loadFonts) {
        for (const p of phrases) {
          loadScriptFont(scriptForLanguage(p.sourceLanguage));
          loadScriptFont(scriptForLanguage(p.targetLanguage));
        }
      }
      const replayEnabled = tr.state.value.replayEnabled;
      return h(
        'ol',
        { class: 'pc-tr-dualview', role: 'log', 'aria-live': 'polite', 'aria-label': 'Live translation captions', style: { listStyle: 'none', margin: 0, padding: 0 } },
        phrases.map((p) => {
          const showTranslated = props.layout !== 'original' && Boolean(p.translated);
          const showOriginal = props.layout !== 'translated' || !p.translated;
          return h(
            'li',
            {
              key: p.phraseId,
              class: ['pc-tr-phrase', p.playing && 'pc-tr-playing', p.flagged && 'pc-tr-flagged'],
              'data-phrase-id': p.phraseId,
              'aria-current': p.playing ? 'true' : undefined,
            },
            [
              showOriginal ? scriptText(p.original, p.sourceLanguage, 'pc-tr-original') : null,
              showTranslated ? scriptText(p.translated, p.targetLanguage, 'pc-tr-translated') : null,
              p.flagged
                ? h('div', { class: 'pc-tr-flag', role: 'note' }, [
                    h('strong', 'May not be accurate — check'),
                    h('ul', describeGuardReasons(p.guard?.reasons).map((r) => h('li', { key: r }, r))),
                  ])
                : null,
              !p.mine && p.final
                ? h('div', { class: 'pc-tr-actions' }, [
                    h('button', { type: 'button', onClick: () => tr.requestRepeat(p.phraseId) }, p.repeatRequestedAt ? 'Asked to repeat' : 'Ask to repeat'),
                    replayEnabled ? h('button', { type: 'button', onClick: () => tr.replay(p.phraseId) }, 'Replay original') : null,
                  ])
                : null,
            ],
          );
        }),
      );
    };
  },
});
