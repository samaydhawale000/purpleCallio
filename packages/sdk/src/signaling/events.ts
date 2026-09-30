import type { Participant, ParticipantMedia, ParticipantRole } from '../types';

/**
 * Map of signaling event name → payload type.
 * The signaling layer is transport-agnostic; it only knows event names
 * and payload shapes. It never touches WebRTC.
 */
export interface SignalingEventMap {
  connected: { callId: string; participantId: string; role: ParticipantRole };
  reconnected: { callId: string };
  disconnected: { reason?: string };

  'participant.joined': { callId: string; participantId: string; participants: number };
  'participant.left': { callId: string; participantId: string; participants: number };
  'participant.updated': {
    callId: string;
    participantId: string;
    media?: ParticipantMedia;
  };
  'call.state': { callId: string; participants: Participant[] };

  'camera.enabled': { callId: string; participantId: string };
  'camera.disabled': { callId: string; participantId: string };
  'microphone.enabled': { callId: string; participantId: string };
  'microphone.disabled': { callId: string; participantId: string };
  'screenShare.started': { callId: string; participantId: string };
  'screenShare.stopped': { callId: string; participantId: string };

'call.started': { callId: string };
  'call.ended': { callId: string };
  'call.expired': { callId: string };
  'connection.diagnostic': { code: 'TURN_CREDENTIALS_FAILED' | 'AUDIO_AUTOPLAY_BLOCKED' | 'AUDIO_OUTPUT_SWITCH_FAILED' | 'ICE_FAILED' };

  // Local media stream events (emitted by the engine, not the server).
  'remote.stream': MediaStream;
  'remote.stream.ended': Record<string, never>;

  // Client→server control commands.
  'join-call': { callId: string };
  'leave-call': { callId: string };

  // WebRTC signaling payloads (still just data — the layer only relays them).
  offer: { offer: RTCSessionDescriptionInit };
  answer: { answer: RTCSessionDescriptionInit };
  'ice-candidate': { candidate: RTCIceCandidateInit };
}

export type SignalingEvent = keyof SignalingEventMap;

export type SignalingListener<K extends SignalingEvent> = (
  payload: SignalingEventMap[K],
) => void;

/**
 * A tiny typed event emitter for signaling events.
 * UI layers and the meeting engine subscribe here.
 */
export class SignalingEvents {
  private listeners: {
    [K in SignalingEvent]: Set<SignalingListener<K>>;
  } = {
    connected: new Set(),
    reconnected: new Set(),
    disconnected: new Set(),
    'participant.joined': new Set(),
    'participant.left': new Set(),
    'participant.updated': new Set(),
    'call.state': new Set(),
    'camera.enabled': new Set(),
    'camera.disabled': new Set(),
    'microphone.enabled': new Set(),
    'microphone.disabled': new Set(),
    'screenShare.started': new Set(),
    'screenShare.stopped': new Set(),
'call.started': new Set(),
    'call.ended': new Set(),
    'call.expired': new Set(),
    'connection.diagnostic': new Set(),
    'remote.stream': new Set(),
    'remote.stream.ended': new Set(),
    'join-call': new Set(),
    'leave-call': new Set(),
    offer: new Set(),
    answer: new Set(),
    'ice-candidate': new Set(),
  };

  on<K extends SignalingEvent>(
    event: K,
    listener: SignalingListener<K>,
  ): () => void {
    this.listeners[event].add(listener as SignalingListener<K>);
    return () => this.off(event, listener);
  }

  off<K extends SignalingEvent>(
    event: K,
    listener: SignalingListener<K>,
  ): void {
    this.listeners[event].delete(listener as SignalingListener<K>);
  }

  emit<K extends SignalingEvent>(event: K, payload: SignalingEventMap[K]): void {
    const set = this.listeners[event] as Set<SignalingListener<K>>;
    set.forEach((l) => l(payload));
  }
}
