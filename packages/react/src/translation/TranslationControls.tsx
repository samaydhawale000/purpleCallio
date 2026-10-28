import React, { useRef } from 'react';

import type { TranslationLimitEvent, TranslationMode } from '@purplecallio/sdk';

import { cx, v } from './script';
import { useResolvedTranslation, type UseTranslationResult } from './useTranslation';

export interface TranslationControlsClassNames {
  root?: string;
  modes?: string;
  mode?: string;
  volume?: string;
  banner?: string;
  tip?: string;
}

export interface TranslationControlsProps {
  translation?: UseTranslationResult | null;
  /** Show the "use headphones" tip in voice mode. Default true. */
  showHeadphonesTip?: boolean;
  /** Extra controls (e.g. language pickers) rendered under the mode switch. */
  children?: React.ReactNode;
  className?: string;
  classNames?: TranslationControlsClassNames;
  style?: React.CSSProperties;
}

const MODES: { value: TranslationMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'No translation' },
  { value: 'captions', label: 'Captions', hint: 'Translated captions only' },
  { value: 'voice', label: 'Voice', hint: 'Hear a translated voice and see captions' },
];

export function formatRemaining(seconds?: number): string | null {
  if (seconds === undefined || !Number.isFinite(seconds)) return null;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s left`;
  return `${Math.ceil(s / 60)} min left`;
}

/** CostGuard text for a `limit` event. */
export function limitText(limit: TranslationLimitEvent): string {
  if (limit.message) return limit.message;
  if (limit.kind === 'warning') return 'Translation is close to its limit.';
  if (limit.kind === 'stepped_down') return 'Translation switched to captions to stay within the limit.';
  return 'Translation paused: the limit was reached. The call continues.';
}

/**
 * Mode switch (off / captions / voice), the original-voice volume while
 * translation speaks, CostGuard notices and a headphones tip.
 */
export function TranslationControls({ translation, showHeadphonesTip = true, children, className, classNames = {}, style }: TranslationControlsProps) {
  const tr = useResolvedTranslation(translation);
  const { state } = tr;
  const mode: TranslationMode = state.status === 'ready' || state.status === 'connecting' ? state.mode : 'off';
  const lastVolume = useRef(state.originalVolume > 0 ? state.originalVolume : 0.2);
  if (state.originalVolume > 0) lastVolume.current = state.originalVolume;
  const muted = state.originalVolume === 0;

  const pickMode = (m: TranslationMode) => {
    if (m === 'off') return tr.disable();
    if (state.status === 'ready' || state.status === 'connecting') tr.setMode(m);
    else void tr.enable({ mode: m });
  };

  const limit = state.limit;
  return (
    <div className={cx('pc-tr-controls', className, classNames.root)} style={{ display: 'flex', flexDirection: 'column', gap: 10, color: v('--pc-tr-fg'), ...style }}>
      <div role="radiogroup" aria-label="Translation mode" className={classNames.modes} style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 999, border: `1px solid ${v('--pc-tr-border')}`, background: v('--pc-tr-surface') }}>
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={mode === m.value}
            aria-label={`Translation ${m.label.toLowerCase()}: ${m.hint}`}
            title={m.hint}
            onClick={() => pickMode(m.value)}
            className={classNames.mode}
            style={{ flex: 1, border: 'none', borderRadius: 999, padding: '6px 10px', cursor: 'pointer', font: 'inherit', fontSize: 13, color: 'inherit', background: mode === m.value ? v('--pc-tr-accent') : 'transparent' }}
          >
            {m.label}
          </button>
        ))}
      </div>
      {state.status === 'connecting' && <div role="status" style={{ fontSize: 12, color: v('--pc-tr-muted') }}>Connecting translation…</div>}
      {state.audioBlocked && (
        // Translation was switched on from the other side; the browser needs a click to play it.
        <button
          type="button"
          onClick={() => void tr.resumeAudio()}
          style={{ alignSelf: 'flex-start', border: 'none', borderRadius: 999, padding: '6px 14px', cursor: 'pointer', fontSize: 13, color: '#fff', background: 'var(--pc-tr-accent, #8B5CF6)' }}
        >
          Join translation
        </button>
      )}
      {state.error && state.status !== 'ready' && (
        <div role="alert" style={{ fontSize: 12, color: v('--pc-tr-warn') }}>
          {translationErrorMessage(state.error.code)}
        </div>
      )}
      {children}
      <div className={classNames.volume} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          aria-pressed={muted}
          aria-label={muted ? 'Hear the original voice quietly under the translation' : 'Mute the original voice while it is translated'}
          onClick={() => tr.setOriginalVolume(muted ? lastVolume.current : 0)}
          style={{ border: `1px solid ${v('--pc-tr-border')}`, background: 'transparent', color: 'inherit', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}
        >
          {muted ? 'Original muted' : 'Original'}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(state.originalVolume * 100)}
          aria-label="Original voice volume while it is translated"
          aria-valuetext={`${Math.round(state.originalVolume * 100)} percent`}
          onChange={(e) => tr.setOriginalVolume(Number(e.target.value) / 100)}
          style={{ flex: 1, accentColor: 'var(--pc-tr-accent, #8B5CF6)' }}
        />
      </div>
      {limit && (
        <div role={limit.kind === 'warning' ? 'status' : 'alert'} className={cx('pc-tr-costguard', classNames.banner)} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 10px', borderRadius: 8, background: v('--pc-tr-warn-bg'), color: v('--pc-tr-warn'), fontSize: 12 }}>
          <span style={{ flex: 1 }}>
            {limitText(limit)}
            {formatRemaining(limit.remainingSeconds) && ` (${formatRemaining(limit.remainingSeconds)})`}
          </span>
          <button type="button" aria-label="Dismiss translation limit notice" onClick={tr.dismissLimit} style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
            ×
          </button>
        </div>
      )}
      {state.trial && <div style={{ fontSize: 11, color: v('--pc-tr-muted') }}>Live Translate trial</div>}
      {showHeadphonesTip && mode === 'voice' && (
        <div className={cx('pc-tr-tip', classNames.tip)} style={{ fontSize: 12, color: v('--pc-tr-muted') }}>
          Tip: use headphones so the translated voice isn&apos;t picked up by your microphone.
        </div>
      )}
    </div>
  );
}

const ERROR_TEXT: Record<string, string> = {
  TRANSLATION_DISABLED: 'Live Translate is not available right now.',
  TRANSLATION_SESSION_INVALID: 'This call link can no longer use translation.',
  TRANSLATION_NOT_IN_PLAN: 'Live Translate is not included in this plan.',
  TRANSLATION_INSUFFICIENT_CREDITS: 'Not enough credits to start translation.',
  TRANSLATION_CALL_ENDED: 'The call has ended.',
  TRANSLATION_REPLAY_DISABLED: 'Replay is not enabled for this call.',
  TRANSLATION_MICROPHONE_DENIED: 'Microphone access was denied.',
  TRANSLATION_MICROPHONE_UNAVAILABLE: 'No microphone was found.',
  TRANSLATION_AUDIO_UNSUPPORTED: 'This browser cannot run Live Translate.',
  TRANSLATION_CONNECTION_FAILED: 'Could not connect to Live Translate.',
  TRANSLATION_PROVIDER_UNAVAILABLE: 'The translation service is unavailable. Try again shortly.',
  TRANSLATION_SWITCH_FAILED: 'Could not turn translation on for the call.',
};

/** User-facing text for a translation error code. */
export function translationErrorMessage(code: string | undefined): string {
  return (code && ERROR_TEXT[code]) || 'Live Translate ran into a problem.';
}
