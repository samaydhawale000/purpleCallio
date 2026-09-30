import type { Participant, ParticipantMedia } from '../types';

export type ParticipantStoreListener = (participants: Participant[]) => void;

/**
 * Holds the live participant list for the meeting.
 * Emits on every mutation so UI layers can subscribe instead of polling.
 */
export class ParticipantStore {
  private byId = new Map<string, Participant>();
  private listeners = new Set<ParticipantStoreListener>();

  onChange(listener: ParticipantStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const list = this.list();
    this.listeners.forEach((l) => l(list));
  }

  list(): Participant[] {
    return [...this.byId.values()];
  }

  get(participantId: string): Participant | undefined {
    return this.byId.get(participantId);
  }

  upsert(participant: Participant): void {
    this.byId.set(participant.participantId, participant);
    this.emit();
  }

  replace(participants: Participant[]): void {
    this.byId.clear();
    participants.forEach((participant) => this.byId.set(participant.participantId, participant));
    this.emit();
  }

  remove(participantId: string): void {
    if (!this.byId.has(participantId)) return;
    this.byId.delete(participantId);
    this.emit();
  }

  updateMedia(participantId: string, patch: Partial<ParticipantMedia>): void {
    const existing = this.byId.get(participantId);
    if (!existing) return;
    existing.media = { ...(existing.media ?? { camera: false, microphone: false, screenShare: false }), ...patch };
    this.emit();
  }

  clear(): void {
    this.byId.clear();
    this.emit();
  }
}
