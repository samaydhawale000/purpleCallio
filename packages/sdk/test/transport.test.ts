import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SignalingTransport } from '../src/transport/socket';

/**
 * Mirrors CallGateway.authenticate: the NestJS socket.io adapter delivers a
 * handler's return value through the acknowledgement callback only (no
 * `event` field → no separate emit).
 */
describe('SignalingTransport.connect', () => {
  let io: Server;
  let url: string;

  beforeEach(async () => {
    const http = createServer();
    io = new Server(http);
    io.on('connection', (socket) => {
      socket.on('authenticate', (body: { token: string }, ack: (r: unknown) => void) => {
        ack(body.token === 'good' ? { success: true, role: 'CALLER' } : { success: false });
      });
    });
    await new Promise<void>((r) => http.listen(0, r));
    url = `http://localhost:${(http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => io.close(() => r()));
  });

  it('resolves when the gateway acks success', async () => {
    const t = new SignalingTransport(url, 'good');
    await expect(t.connect()).resolves.toBeUndefined();
    expect(t.isConnected).toBe(true);
    t.disconnect();
  });

  it('rejects when the gateway acks failure', async () => {
    const t = new SignalingTransport(url, 'bad');
    await expect(t.connect()).rejects.toThrow(/Authentication failed/);
    t.disconnect();
  });

  it('times out instead of hanging when no ack arrives', async () => {
    io.removeAllListeners('connection');
    const t = new SignalingTransport(url, 'good');
    await expect(t.connect(300)).rejects.toThrow(/timed out/);
    t.disconnect();
  });
});
