import React, { useState } from 'react';

import { SLOW_REPLAY_RATE, type TranslationPhrase } from '@purplecallio/sdk';

import { cx, ScriptText, useScriptFonts, v } from './script';
import { useResolvedTranslation, type UseTranslationResult } from './useTranslation';

export interface TranslatedChatViewClassNames {
  root?: string;
  column?: string;
  bubble?: string;
  mine?: string;
  theirs?: string;
  tooltip?: string;
  button?: string;
}

export interface TranslatedChatViewProps {
  translation?: UseTranslationResult | null;
  phrases?: TranslationPhrase[];
  youLabel?: string;
  peerLabel?: string;
  slowReplay?: boolean;
  loadFonts?: boolean;
  className?: string;
  classNames?: TranslatedChatViewClassNames;
  style?: React.CSSProperties;
}

/**
 * Split chat view: the other person's phrases on one side, yours on the
 * other, each bubble in the viewer's language. Hover or tap a bubble to see
 * the original words (and replay them when the call allows it).
 */
export function TranslatedChatView({
  translation,
  phrases: phrasesProp,
  youLabel = 'You',
  peerLabel = 'Them',
  slowReplay = false,
  loadFonts = true,
  className,
  classNames = {},
  style,
}: TranslatedChatViewProps) {
  const tr = useResolvedTranslation(translation);
  const phrases = phrasesProp ?? tr.phrases;
  useScriptFonts(phrases.flatMap((p) => [p.sourceLanguage, p.targetLanguage]), loadFonts);
  const theirs = phrases.filter((p) => !p.mine);
  const mine = phrases.filter((p) => p.mine);

  const column = (list: TranslationPhrase[], own: boolean, label: string) => (
    <div
      role="log"
      aria-live={own ? 'off' : 'polite'}
      aria-label={label}
      className={cx('pc-tr-chat-column', classNames.column)}
      style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: own ? 'flex-end' : 'flex-start' }}
    >
      <div style={{ fontSize: 11, color: v('--pc-tr-muted') }}>{label}</div>
      {list.map((p) => (
        <Bubble
          key={p.phraseId}
          phrase={p}
          own={own}
          replayEnabled={tr.state.replayEnabled}
          onReplay={() => tr.replay(p.phraseId, slowReplay ? { rate: SLOW_REPLAY_RATE } : undefined)}
          classNames={classNames}
        />
      ))}
    </div>
  );

  return (
    <div
      className={cx('pc-tr-chat', className, classNames.root)}
      style={{ display: 'flex', gap: 12, color: v('--pc-tr-fg'), background: v('--pc-tr-bg'), borderRadius: v('--pc-tr-radius'), padding: 12, fontSize: v('--pc-tr-font-size'), ...style }}
    >
      {column(theirs, false, peerLabel)}
      {column(mine, true, youLabel)}
    </div>
  );
}

function Bubble({
  phrase: p,
  own,
  replayEnabled,
  onReplay,
  classNames,
}: {
  phrase: TranslationPhrase;
  own: boolean;
  replayEnabled: boolean;
  onReplay: () => boolean;
  classNames: TranslatedChatViewClassNames;
}) {
  const [open, setOpen] = useState(false);
  // The viewer reads their own words as spoken and the other side translated.
  const main = own ? { text: p.original, lang: p.sourceLanguage } : { text: p.translated || p.original, lang: p.translated ? p.targetLanguage : p.sourceLanguage };
  const other = own ? { text: p.translated, lang: p.targetLanguage, label: 'They hear' } : { text: p.original, lang: p.sourceLanguage, label: 'Original' };
  const tipId = `pc-tr-tip-${p.phraseId}`;

  return (
    <div
      style={{ position: 'relative', maxWidth: '85%' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        data-playing={p.playing || undefined}
        data-flagged={p.flagged || undefined}
        className={cx('pc-tr-bubble', classNames.bubble, own ? classNames.mine : classNames.theirs)}
        style={{
          textAlign: 'start',
          font: 'inherit',
          color: 'inherit',
          cursor: 'pointer',
          padding: '8px 12px',
          borderRadius: 14,
          border: `1px solid ${p.flagged ? v('--pc-tr-warn') : v('--pc-tr-border')}`,
          background: p.playing ? v('--pc-tr-highlight') : own ? v('--pc-tr-accent') : v('--pc-tr-surface'),
        }}
      >
        <ScriptText language={main.lang}>{main.text}</ScriptText>
        {p.flagged && <span style={{ display: 'block', fontSize: 11, color: v('--pc-tr-warn') }}>May not be accurate — check</span>}
      </button>
      {open && other.text && (
        <div
          id={tipId}
          role="tooltip"
          className={cx('pc-tr-tooltip', classNames.tooltip)}
          style={{ marginTop: 4, padding: '6px 10px', borderRadius: 8, background: v('--pc-tr-surface'), border: `1px solid ${v('--pc-tr-border')}`, fontSize: 13 }}
        >
          <div style={{ fontSize: 11, color: v('--pc-tr-muted') }}>{other.label}</div>
          <ScriptText language={other.lang}>{other.text}</ScriptText>
          {!own && replayEnabled && p.final && (
            <div>
              <button type="button" onClick={onReplay} className={classNames.button} style={{ marginTop: 4, background: 'transparent', color: 'inherit', border: `1px solid ${v('--pc-tr-border')}`, borderRadius: 999, padding: '2px 10px', fontSize: 12, cursor: 'pointer' }}>
                Replay original
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
