import React, { useEffect, useRef } from 'react';

import { useMeetingContext } from '../context';
import { useDevices } from '../hooks';

// ── DeviceSelector ────────────────────────────────────────

export interface DeviceSelectorProps {
  showLabel?: boolean;
  className?: string;
}

export function DeviceSelector({ showLabel = true, className }: DeviceSelectorProps) {
  const devices = useDevices();

  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #2D3F6B',
    background: '#0D1421',
    color: '#E2E8F0',
    fontSize: 13,
  };

  return (
    <div
      className={`bj-device-selector${className ? ` ${className}` : ''}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 220 }}
    >
      {showLabel && (
        <p style={{ fontSize: 12, color: '#94A3B8', fontWeight: 600, margin: 0 }}>
          Devices
        </p>
      )}

      {devices.loading ? (
        <p style={{ fontSize: 12, color: '#64748B' }}>Loading devices…</p>
      ) : (
        <>
          {devices.audioInputs.length > 0 && (
            <label style={{ fontSize: 11, color: '#64748B' }}>
              Microphone
              <select
                style={selectStyle}
                value={devices.selected.audioInput}
                onChange={(e) => void devices.setAudioInput(e.target.value).catch(() => undefined)}
              >
                {devices.audioInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${d.deviceId.slice(0, 4)}`}
                  </option>
                ))}
              </select>
            </label>
          )}

          {devices.audioOutputs.length > 0 && (
            <label style={{ fontSize: 11, color: '#64748B' }}>
              Speaker
              <select
                style={selectStyle}
                value={devices.selected.audioOutput}
                onChange={(e) => void devices.setAudioOutput(e.target.value).catch(() => undefined)}
              >
                {devices.audioOutputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Speaker ${d.deviceId.slice(0, 4)}`}
                  </option>
                ))}
              </select>
            </label>
          )}

          {devices.videoInputs.length > 0 && (
            <label style={{ fontSize: 11, color: '#64748B' }}>
              Camera
              <select
                style={selectStyle}
                value={devices.selected.videoInput}
                onChange={(e) => void devices.setVideoInput(e.target.value).catch(() => undefined)}
              >
                {devices.videoInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${d.deviceId.slice(0, 4)}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {devices.error && <p role="alert" style={{ color: '#FCA5A5', fontSize: 12, margin: 0 }}>{devices.error === 'AUDIO_OUTPUT_SWITCH_UNSUPPORTED' ? 'Speaker selection is not supported by this browser.' : 'Could not switch device. Your current device is still active.'}</p>}
        </>
      )}
    </div>
  );
}

// ── WaitingRoom ───────────────────────────────────────────

export interface WaitingRoomProps {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function WaitingRoom({
  title = 'Waiting for the other participant',
  subtitle = 'You will be connected automatically when they join.',
  children,
}: WaitingRoomProps) {
  return (
    <div
      className="bj-waiting-room"
      style={{
        minHeight: 320,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          border: '2px solid #2563EB',
          background: '#1E2D50',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'pulse 1.5s infinite',
        }}
      >
        <span style={{ color: '#60A5FA', fontFamily: 'monospace', fontSize: 18 }}>…</span>
      </div>
      <p style={{ color: '#F1F5F9', fontWeight: 600, fontSize: 16, margin: 0 }}>
        {title}
      </p>
      <p style={{ color: '#64748B', fontSize: 13, margin: 0 }}>{subtitle}</p>
      {children}
    </div>
  );
}

// ── ConnectionStatus ──────────────────────────────────────

const STATE_COLORS: Record<string, string> = {
  idle: '#64748B',
  connecting: '#F59E0B',
  connected: '#10B981',
  reconnecting: '#F59E0B',
  disconnected: '#EF4444',
};

const STATE_LABELS: Record<string, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
};

export function ConnectionStatus() {
  const { connectionState } = useMeetingContext();
  const color = STATE_COLORS[connectionState] ?? '#64748B';

  return (
    <div
      className="bj-connection-status"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        color,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
        }}
      />
      {STATE_LABELS[connectionState] ?? connectionState}
    </div>
  );
}

// ── SpeakingIndicator ─────────────────────────────────────

export interface SpeakingIndicatorProps {
  active?: boolean;
  label?: string;
  color?: string;
}

export function SpeakingIndicator({
  active = false,
  label = 'Speaking',
  color = '#10B981',
}: SpeakingIndicatorProps) {
  if (!active) return null;
  return (
    <span
      className="bj-speaking-indicator"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        color,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
          animation: 'pulse 1s infinite',
        }}
      />
      {label}
    </span>
  );
}

// ── LocalVideoPreview ─────────────────────────────────────

export interface LocalVideoPreviewProps {
  className?: string;
}

export function LocalVideoPreview({ className }: LocalVideoPreviewProps) {
  const { localStream, media } = useMeetingContext();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  if (!media.camera) {
    return (
      <div
        className={`bj-local-preview${className ? ` ${className}` : ''}`}
        style={{
          width: 160,
          height: 112,
          borderRadius: 10,
          background: '#0D1425',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: 12, color: '#64748B' }}>Camera off</span>
      </div>
    );
  }

  return (
    <div
      className={`bj-local-preview${className ? ` ${className}` : ''}`}
      style={{
        width: 160,
        height: 112,
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid #1A2642',
        background: '#0D1425',
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
      />
    </div>
  );
}
