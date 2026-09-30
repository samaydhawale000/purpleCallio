import { CallRoomService } from './call-room.service';

describe('CallRoomService participant capacity', () => {
  it('admits two distinct playground participants and rejects a third atomically', () => {
    const rooms = new CallRoomService();
    expect(rooms.canJoinRoom('call', 'socket-1', 2)).toBe(true);
    rooms.joinRoom('call', 'socket-1');
    expect(rooms.canJoinRoom('call', 'socket-2', 2)).toBe(true);
    rooms.joinRoom('call', 'socket-2');
    expect(rooms.canJoinRoom('call', 'socket-3', 2)).toBe(false);
  });

  it('allows a reconnecting socket already in its room without consuming another slot', () => {
    const rooms = new CallRoomService();
    rooms.joinRoom('call', 'socket-1');
    rooms.joinRoom('call', 'socket-2');
    expect(rooms.canJoinRoom('call', 'socket-1', 2)).toBe(true);
  });
});
