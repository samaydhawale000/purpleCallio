import React, { useEffect, useRef, useState } from 'react';

import { useMeetingContext } from '../context';

// ── MeetingRoom ───────────────────────────────────────────

export interface MeetingRoomProps {
  children?: React.ReactNode;
  /** Optional className for the room shell. */
  className?: string;
  /** Render a "waiting" state until the remote joins. */
  showWaitingRoom?: boolean;
  waitingRoomLabel?: string;
  waitingRoomTimeoutMs?: number;
}

export function MeetingRoom({
  children,
  className,
  showWaitingRoom = true,
  waitingRoomLabel = 'Waiting for the other participant…',
  waitingRoomTimeoutMs = 30_000,
}: MeetingRoomProps) {
  const { connectionState, participants, participantId, leave, join } = useMeetingContext();
  const [waitElapsed, setWaitElapsed] = useState(false);

  const others = participants.filter(
    (p) => p.participantId !== (participantId ?? ''),
  );
  const isInCall = connectionState === 'joined' || connectionState === 'connected';

  useEffect(() => {
    setWaitElapsed(false);
    if (!isInCall || others.length > 0) return;
    const timer = window.setTimeout(() => setWaitElapsed(true), waitingRoomTimeoutMs);
    return () => window.clearTimeout(timer);
  }, [isInCall, others.length, waitingRoomTimeoutMs]);

  if (showWaitingRoom && isInCall && others.length === 0 && !waitElapsed) {
    return (
      <div
        className="bj-room bj-room-waiting"
        style={{
          width: '100%',
          minHeight: 320,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0D1425',
          borderRadius: 12,
        }}
      >
        <p style={{ color: '#94A3B8', fontSize: 14 }}>{waitingRoomLabel}</p>
      </div>
    );
  }

  return (
    <div
      className={`bj-room${className ? ` ${className}` : ''}`}
      style={{ width: '100%', minHeight: 320, background: '#0D1425', borderRadius: 12 }}
    >
      {waitElapsed && others.length === 0 && showWaitingRoom && (
        <div role="status" style={{ color: '#94A3B8', fontSize: 14, padding: 12 }}>
          <p>{waitingRoomLabel} Check the invite or connection.</p>
          <button type="button" onClick={() => { void leave().then(join); }}>Retry connection</button>
          <button type="button" onClick={() => { void leave(); }}>Leave call</button>
        </div>
      )}
      {children}
    </div>
  );
}

// ── ParticipantTile ───────────────────────────────────────

export interface ParticipantTileProps {
  participantId: string;
  /** Optional external display name. */
  name?: string;
  /** Stream to render (remote or local). */
  stream?: MediaStream | null;
  muted?: boolean;
  mirror?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function ParticipantTile({
  participantId,
  name,
  stream,
  muted = false,
  mirror = false,
  className,
  style,
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const { engine } = useMeetingContext();
  const [audioBlocked, setAudioBlocked] = useState(false);
  const hasVideo = stream?.getVideoTracks().some((t) => t.enabled) ?? false;

  useEffect(() => {
    const element = videoRef.current ?? audioRef.current;
    if (!element || !stream) return;
    element.srcObject = stream;
    const unregister = engine?.registerAudioElement(element);
    void element.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
    return () => unregister?.();
  }, [engine, stream]);

  return (
    <div
      className={`bj-tile${className ? ` ${className}` : ''}`}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 12,
        background: '#060A17',
        aspectRatio: '16 / 9',
        ...style,
      }}
    >
      {stream && hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          style={{
            width: '100%',
            height: '100%',
            display: hasVideo ? 'block' : 'none',
            objectFit: 'cover',
            transform: mirror ? 'scaleX(-1)' : undefined,
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0D1425',
          }}
        >
          <Avatar id={participantId} />
        </div>
      )}

      {stream && !hasVideo && stream.getAudioTracks().length > 0 && (
        <audio ref={audioRef} autoPlay muted={muted} />
      )}

      {audioBlocked && !muted && <button type="button" onClick={() => { const element = videoRef.current ?? audioRef.current; if (element) void element.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true)); }} style={{ position: 'absolute', inset: 'auto 8px 8px', zIndex: 2 }}>Click to enable audio</button>}

      {name && (
        <span
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8,
            fontSize: 11,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.9)',
            background: 'rgba(0,0,0,0.55)',
            padding: '2px 8px',
            borderRadius: 6,
          }}
        >
          {name}
        </span>
      )}
    </div>
  );
}

export function Avatar({ id, size = 48 }: { id: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#1E2D50',
        border: '2px solid #2563EB',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.35,
        fontFamily: 'ui-monospace, monospace',
        color: '#94A3B8',
      }}
    >
      {id.slice(0, 2).toUpperCase()}
    </div>
  );
}

// ── ParticipantGrid ───────────────────────────────────────

export interface ParticipantGridProps {
  /** Remote streams keyed by participant id. */
  streams: Record<string, MediaStream | null>;
  /** Display names keyed by participant id. */
  names?: Record<string, string>;
  /** Local stream (rendered as a PiP tile). */
  localStream?: MediaStream | null;
  localName?: string;
  localId?: string;
}

export function ParticipantGrid({
  streams,
  names,
  localStream,
  localName = 'You',
  localId = 'me',
}: ParticipantGridProps) {
  const remoteIds = Object.keys(streams).filter((id) => streams[id]);
  const tiles = [
    ...remoteIds.map((id) => (
      <ParticipantTile
        key={id}
        participantId={id}
        name={names?.[id]}
        stream={streams[id]}
      />
    )),
    ...(localStream
      ? [
          <ParticipantTile
            key={localId}
            participantId={localId}
            name={localName}
            stream={localStream}
            muted
            mirror
          />,
        ]
      : []),
  ];

  if (tiles.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          minHeight: 240,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#64748B',
          fontSize: 13,
        }}
      >
        No participants yet
      </div>
    );
  }

  return (
    <div
      className="bj-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(tiles.length, 2)}, 1fr)`,
        gap: 8,
        width: '100%',
      }}
    >
      {tiles}
    </div>
  );
}

// ── ActiveSpeakerView ─────────────────────────────────────

export interface ActiveSpeakerViewProps {
  /** Remote stream of the active (speaking) participant. */
  stream: MediaStream | null;
  name?: string;
  participantId?: string;
  /** Local PiP stream. */
  localStream?: MediaStream | null;
}

export function ActiveSpeakerView({
  stream,
  name,
  participantId = 'speaker',
  localStream,
}: ActiveSpeakerViewProps) {
  return (
    <div style={{ position: 'relative', width: '100%', minHeight: 320 }}>
      <ParticipantTile participantId={participantId} name={name} stream={stream} />
      {localStream && (
        <div style={{ position: 'absolute', right: 12, bottom: 12, width: 160 }}>
          <ParticipantTile
            participantId="me"
            name="You"
            stream={localStream}
            muted
            mirror
          />
        </div>
      )}
    </div>
  );
}
