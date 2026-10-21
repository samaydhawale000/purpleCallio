import React from 'react';

import { usePurpleCallioAI, UsePurpleCallioAIOptions, AICallStatus } from '../ai';
import { MicIcon, MicOffIcon } from './controls';

const AI_ERROR_TEXT: Record<string, string> = {
  AI_DISABLED: 'AI voice agents are not available right now.',
  AI_PAID_PLAN_REQUIRED: 'AI voice agents need a paid plan.',
  AI_AGENT_NOT_FOUND: 'This agent no longer exists.',
  AI_AGENT_DISABLED: 'This agent is disabled.',
  AI_QUOTA_EXCEEDED: 'The AI usage limit has been reached. Try again later.',
  AI_CONCURRENCY_LIMIT: 'Too many AI calls are running. Try again in a moment.',
  AI_INSUFFICIENT_CREDITS: 'Not enough credits to start an AI call.',
  AI_SESSION_CREATE_FAILED: 'Could not start the call. Please try again.',
  AI_PROVIDER_UNAVAILABLE: 'The voice service is unavailable. Please try again later.',
  AI_CONNECTION_FAILED: 'The connection to the agent failed.',
  AI_SESSION_EXPIRED: 'The session expired before it connected. Please try again.',
  AI_SESSION_ENDED: 'This session has already ended.',
  AI_MAX_DURATION_REACHED: 'The call reached its maximum duration.',
  AI_MICROPHONE_DENIED: 'Microphone access was denied.',
  AI_MICROPHONE_UNAVAILABLE: 'No microphone was found.',
  AI_AUDIO_UNSUPPORTED: 'This browser cannot play the agent audio.',
};

/** User-facing text for an AI error code. */
export function aiErrorMessage(code: string | undefined): string {
  return (code && AI_ERROR_TEXT[code]) || 'Something went wrong with the call.';
}

const STATUS_TEXT: Record<AICallStatus, string> = {
  idle: 'Ready',
  starting: 'Starting…',
  connecting: 'Connecting…',
  connected: 'Connected',
  ended: 'Call ended',
};

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface PurpleCallioAIProps extends UsePurpleCallioAIOptions {
  className?: string;
  /** Label for the start button. Default "Start call". */
  startLabel?: string;
  /** Show the live transcript under the controls. Default true. */
  showTranscript?: boolean;
}

/**
 * Minimal voice agent UI: start/end/mute, status, speaking indicator,
 * duration, error text and the tool-confirmation prompt. Style it with
 * `className` and the `bj-ai-*` classes.
 */
export function PurpleCallioAI({
  className,
  startLabel = 'Start call',
  showTranscript = true,
  ...options
}: PurpleCallioAIProps) {
  const ai = usePurpleCallioAI(options);
  const live = ai.status === 'starting' || ai.status === 'connecting' || ai.status === 'connected';
  const speaking = ai.status === 'connected' && ai.agentState === 'speaking';

  const buttonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  };

  return (
    <div
      className={`bj-ai${className ? ` ${className}` : ''}`}
      data-status={ai.status}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        borderRadius: 12,
        background: '#0D1421',
        color: '#E2E8F0',
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          className="bj-ai-indicator"
          data-speaking={speaking ? 'true' : 'false'}
          aria-hidden
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: speaking ? '#22C55E' : ai.status === 'connected' ? '#7F40E8' : '#334155',
            boxShadow: speaking ? '0 0 0 4px rgba(34,197,94,0.25)' : 'none',
            transition: 'all 150ms ease',
          }}
        />
        <span className="bj-ai-status" role="status" style={{ flex: 1 }}>
          {ai.status === 'connected' ? (speaking ? 'Agent speaking' : ai.agentState === 'thinking' ? 'Thinking…' : 'Listening') : STATUS_TEXT[ai.status]}
        </span>
        {(ai.status === 'connected' || ai.durationSeconds > 0) && (
          <span className="bj-ai-duration" style={{ fontVariantNumeric: 'tabular-nums', color: '#94A3B8' }}>
            {formatClock(ai.durationSeconds)}
          </span>
        )}
      </div>

      <div className="bj-ai-controls" style={{ display: 'flex', gap: 8 }}>
        {live ? (
          <>
            <button
              type="button"
              className="bj-ai-mute"
              onClick={ai.isMuted ? ai.unmute : ai.mute}
              disabled={ai.status !== 'connected'}
              aria-pressed={ai.isMuted}
              style={{
                ...buttonStyle,
                background: '#1E293B',
                color: '#E2E8F0',
                cursor: ai.status === 'connected' ? 'pointer' : 'not-allowed',
              }}
            >
              {ai.isMuted ? <MicOffIcon /> : <MicIcon />}
              {ai.isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button
              type="button"
              className="bj-ai-end"
              onClick={ai.end}
              style={{ ...buttonStyle, background: '#DC2626', color: '#FFFFFF' }}
            >
              End
            </button>
          </>
        ) : (
          <button
            type="button"
            className="bj-ai-start"
            onClick={() => void ai.start()}
            style={{ ...buttonStyle, background: '#7F40E8', color: '#FFFFFF' }}
          >
            {startLabel}
          </button>
        )}
      </div>

      {ai.error && (
        <p className="bj-ai-error" role="alert" style={{ margin: 0, color: '#F87171' }}>
          {aiErrorMessage(ai.error.code)}
        </p>
      )}

      {ai.pendingConfirmations.map((t) => (
        <div
          key={t.id}
          className="bj-ai-confirm"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, background: '#1E293B' }}
        >
          <span style={{ flex: 1 }}>
            The agent wants to run <strong>{t.name}</strong>.
          </span>
          <button
            type="button"
            onClick={() => ai.confirmTool(t.id, true)}
            style={{ ...buttonStyle, padding: '6px 10px', background: '#7F40E8', color: '#FFFFFF' }}
          >
            Allow
          </button>
          <button
            type="button"
            onClick={() => ai.confirmTool(t.id, false)}
            style={{ ...buttonStyle, padding: '6px 10px', background: '#334155', color: '#E2E8F0' }}
          >
            Deny
          </button>
        </div>
      ))}

      {showTranscript && ai.transcript.length > 0 && (
        <ul className="bj-ai-transcript" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ai.transcript.map((line) => (
            <li key={line.key} data-role={line.role} style={{ opacity: line.final ? 1 : 0.7 }}>
              <strong style={{ color: '#94A3B8' }}>{line.role === 'agent' ? 'Agent' : 'You'}:</strong> {line.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
