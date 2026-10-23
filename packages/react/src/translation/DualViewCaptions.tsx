import React, { useEffect, useState } from 'react';

import { describeGuardReasons, SLOW_REPLAY_RATE, type TranslationPhrase } from '@purplecallio/sdk';

import { cx, ScriptText, useScriptFonts, v } from './script';
import { useResolvedTranslation, type UseTranslationResult } from './useTranslation';

export type DualViewLayout = 'translated' | 'both' | 'original';

export interface DualViewCaptionsClassNames {
  root?: string;
  toolbar?: string;
  list?: string;
  phrase?: string;
  playing?: string;
  original?: string;
  translated?: string;
  flag?: string;
  actions?: string;
  button?: string;
}

export interface DualViewCaptionsProps {
  translation?: UseTranslationResult | null;
  /** Override the phrases shown (defaults to the translation's history). */
  phrases?: TranslationPhrase[];
  /** Controlled layout; uncontrolled starts at `defaultLayout` (default `both`). */
  layout?: DualViewLayout;
  defaultLayout?: DualViewLayout;
  onLayoutChange?: (layout: DualViewLayout) => void;
  showLayoutSwitch?: boolean;
  /** Show only the latest N phrases (overlay use). Default: all. */
  maxPhrases?: number;
  /** Replay at 0.85× instead of normal speed. */
  slowReplay?: boolean;
  /** Load Noto Sans fonts for scripts in use. Default true. */
  loadFonts?: boolean;
  /** Label for your own phrases / the other person's. */
  youLabel?: string;
  peerLabel?: string;
  className?: string;
  classNames?: DualViewCaptionsClassNames;
  style?: React.CSSProperties;
}

const LAYOUTS: { value: DualViewLayout; label: string }[] = [
  { value: 'translated', label: 'Translated' },
  { value: 'both', label: 'Both' },
  { value: 'original', label: 'Original' },
];

const buttonStyle: React.CSSProperties = {
  background: 'transparent',
  color: v('--pc-tr-fg'),
  border: `1px solid ${v('--pc-tr-border')}`,
  borderRadius: 999,
  padding: '2px 10px',
  fontSize: 12,
  cursor: 'pointer',
};

/**
 * DualView captions: each phrase's original words and translation, in sync
 * with the translated voice (the phrase playing now is highlighted). Phrases
 * MeaningGuard is unsure about get an amber marker with plain reasons.
 */
export function DualViewCaptions({
  translation,
  phrases: phrasesProp,
  layout: layoutProp,
  defaultLayout = 'both',
  onLayoutChange,
  showLayoutSwitch = true,
  maxPhrases,
  slowReplay = false,
  loadFonts = true,
  youLabel = 'You',
  peerLabel = 'Them',
  className,
  classNames = {},
  style,
}: DualViewCaptionsProps) {
  const tr = useResolvedTranslation(translation);
  const [own, setOwn] = useState<DualViewLayout>(defaultLayout);
  const layout = layoutProp ?? own;
  const setLayout = (l: DualViewLayout) => {
    if (layoutProp === undefined) setOwn(l);
    onLayoutChange?.(l);
  };

  const all = phrasesProp ?? tr.phrases;
  const phrases = maxPhrases ? all.slice(-maxPhrases) : all;
  useScriptFonts(
    phrases.flatMap((p) => [p.sourceLanguage, p.targetLanguage]),
    loadFonts,
  );

  return (
    <section
      className={cx('pc-tr-dualview', className, classNames.root)}
      aria-label="Live translation captions"
      style={{
        color: v('--pc-tr-fg'),
        background: v('--pc-tr-bg'),
        borderRadius: v('--pc-tr-radius'),
        fontSize: v('--pc-tr-font-size'),
        padding: 12,
        ...style,
      }}
    >
      {showLayoutSwitch && (
        <div
          role="radiogroup"
          aria-label="Caption layout"
          className={cx('pc-tr-dualview-toolbar', classNames.toolbar)}
          style={{ display: 'flex', gap: 6, marginBottom: 8 }}
        >
          {LAYOUTS.map((l) => (
            <button
              key={l.value}
              type="button"
              role="radio"
              aria-checked={layout === l.value}
              onClick={() => setLayout(l.value)}
              className={classNames.button}
              style={{ ...buttonStyle, background: layout === l.value ? v('--pc-tr-accent') : 'transparent' }}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
      <ol
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        className={cx('pc-tr-dualview-list', classNames.list)}
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {phrases.length === 0 && (
          <li style={{ color: v('--pc-tr-muted'), fontSize: 13 }}>Captions will appear here when someone speaks.</li>
        )}
        {phrases.map((p) => (
          <PhraseRow
            key={p.phraseId}
            phrase={p}
            layout={layout}
            replayEnabled={tr.state.replayEnabled}
            onReplay={() => tr.replay(p.phraseId, slowReplay ? { rate: SLOW_REPLAY_RATE } : undefined)}
            onRepeat={() => tr.requestRepeat(p.phraseId)}
            who={p.mine ? youLabel : peerLabel}
            classNames={classNames}
          />
        ))}
      </ol>
    </section>
  );
}

function PhraseRow({
  phrase: p,
  layout,
  replayEnabled,
  onReplay,
  onRepeat,
  who,
  classNames,
}: {
  phrase: TranslationPhrase;
  layout: DualViewLayout;
  replayEnabled: boolean;
  onReplay: () => boolean;
  onRepeat: () => boolean;
  who: string;
  classNames: DualViewCaptionsClassNames;
}) {
  const [asked, setAsked] = useState(Boolean(p.repeatRequestedAt));
  useEffect(() => setAsked(Boolean(p.repeatRequestedAt)), [p.repeatRequestedAt]);
  const reasons = p.flagged ? describeGuardReasons(p.guard?.reasons) : [];
  const showOriginal = layout !== 'translated' || !p.translated;
  const showTranslated = layout !== 'original' && Boolean(p.translated);

  return (
    <li
      className={cx('pc-tr-phrase', classNames.phrase, p.playing && classNames.playing)}
      data-phrase-id={p.phraseId}
      data-playing={p.playing || undefined}
      data-flagged={p.flagged || undefined}
      aria-current={p.playing ? 'true' : undefined}
      style={{
        padding: '6px 10px',
        borderRadius: 8,
        borderInlineStart: `3px solid ${p.flagged ? v('--pc-tr-warn') : 'transparent'}`,
        background: p.playing ? v('--pc-tr-highlight') : 'transparent',
        transition: 'background 0.2s',
        opacity: p.final ? 1 : 0.85,
      }}
    >
      <div style={{ fontSize: 11, color: v('--pc-tr-muted'), marginBottom: 2 }}>{who}</div>
      {showOriginal && (
        <ScriptText
          as="p"
          language={p.sourceLanguage}
          className={cx('pc-tr-original', classNames.original)}
          style={{ margin: 0, color: layout === 'both' && showTranslated ? v('--pc-tr-muted') : undefined, fontSize: layout === 'both' && showTranslated ? '0.9em' : undefined }}
        >
          {p.original}
        </ScriptText>
      )}
      {showTranslated && (
        <ScriptText as="p" language={p.targetLanguage} className={cx('pc-tr-translated', classNames.translated)} style={{ margin: 0, fontWeight: 600 }}>
          {p.translated}
        </ScriptText>
      )}
      {p.flagged && (
        <div className={cx('pc-tr-flag', classNames.flag)} role="note" style={{ marginTop: 4, padding: '4px 8px', borderRadius: 6, background: v('--pc-tr-warn-bg'), color: v('--pc-tr-warn'), fontSize: 12 }}>
          <strong>May not be accurate — check</strong>
          {reasons.length > 0 && (
            <ul style={{ margin: '2px 0 0', paddingInlineStart: 16 }}>
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!p.mine && p.final && (
        <div className={cx('pc-tr-actions', classNames.actions)} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button type="button" onClick={() => { if (onRepeat()) setAsked(true); }} disabled={asked} className={classNames.button} style={buttonStyle} aria-label={`Ask to repeat: ${p.translated || p.original}`}>
            {asked ? 'Asked to repeat' : 'Ask to repeat'}
          </button>
          {replayEnabled && (
            <button type="button" onClick={onReplay} className={classNames.button} style={buttonStyle} aria-label={`Replay original: ${p.original}`}>
              Replay original
            </button>
          )}
        </div>
      )}
    </li>
  );
}
