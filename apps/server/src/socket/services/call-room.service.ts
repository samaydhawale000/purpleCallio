import { Injectable } from '@nestjs/common';

export interface RoomParticipant {
  socketId: string;
  participantId: string;
  role: 'CALLER' | 'RECEIVER';
  media: {
    camera: boolean;
    microphone: boolean;
    screenShare: boolean;
  };
  joinedAt: number;
}

@Injectable()
export class CallRoomService {
  private rooms = new Map<
    string,
    Set<string>
  >();

  private participants = new Map<
    string,
    RoomParticipant
  >();

  joinRoom(
    callId: string,
    socketId: string,
  ) {
    if (
      !this.rooms.has(callId)
    ) {
      this.rooms.set(
        callId,
        new Set(),
      );
    }

    this.rooms
      .get(callId)!
      .add(socketId);
  }

  leaveRoom(
    callId: string,
    socketId: string,
  ) {
    const room =
      this.rooms.get(callId);

    if (!room) return;

    room.delete(socketId);

    if (room.size === 0) {
      this.rooms.delete(callId);
    }
  }

  getParticipantCount(
    callId: string,
  ) {
    return (
      this.rooms.get(callId)
        ?.size || 0
    );
  }

  canJoinRoom(callId: string, socketId: string, maxParticipants: number): boolean {
    const room = this.rooms.get(callId);
    return Boolean(room?.has(socketId)) || (room?.size ?? 0) < maxParticipants;
  }

hasRoom(callId: string) {
    return this.rooms.has(callId);
  }

  /** Number of distinct call rooms currently holding at least one socket. */
  getActiveRoomCount(): number {
    return this.rooms.size;
  }

  /** Total sockets currently inside any call room. */
  getTotalInCall(): number {
    let total = 0;
    for (const room of this.rooms.values()) {
      total += room.size;
    }
    return total;
  }

  /**
   * Track rich metadata for a socket inside a call.
   */
  addParticipant(
    callId: string,
    participant: Omit<RoomParticipant, 'joinedAt'>,
  ) {
    this.participants.set(participant.socketId, {
      ...participant,
      callId,
      joinedAt: Date.now(),
    } as RoomParticipant & { callId: string });
  }

  removeParticipant(socketId: string) {
    this.participants.delete(socketId);
  }

  getParticipant(socketId: string) {
    return this.participants.get(socketId);
  }

  getParticipants(callId: string): Array<RoomParticipant & { callId: string }> {
    const result: Array<RoomParticipant & { callId: string }> = [];
    for (const p of this.participants.values()) {
      if ((p as RoomParticipant & { callId: string }).callId === callId) {
        result.push(p as RoomParticipant & { callId: string });
      }
    }
    return result;
  }

  updateMedia(
    socketId: string,
    patch: Partial<RoomParticipant['media']>,
  ) {
    const p = this.participants.get(socketId);
    if (!p) return null;
    p.media = { ...p.media, ...patch };
    return p;
  }
}
