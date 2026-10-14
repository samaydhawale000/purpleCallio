// Local test stack for real-browser WebRTC tests:
//  - a real Coturn process (STUN + TURN, REST shared-secret auth) that can be
//    stopped and restarted mid-call to simulate losing the media path,
//  - a signaling gateway + REST API that mirrors the contract of
//    apps/server's CallGateway / CallController for one 1:1 call,
//  - the @purplecallio/sdk source bundled for the browser.
//
// The gateway is a stand-in, not the NestJS server: authorization, billing
// and persistence are out of scope here and covered by the server's tests.

import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { Server } from 'socket.io';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

/** First non-internal IPv4 address: Chrome does not gather loopback candidates. */
export function lanIPv4() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  throw new Error('No non-loopback IPv4 interface; a LAN address is required for host candidates');
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Coturn {
  constructor({ ip, port, secret }) {
    Object.assign(this, { ip, port, secret, proc: null, log: '' });
  }

  async start() {
    if (this.proc) return;
    const bin = process.env.TURNSERVER_BIN || 'turnserver';
    this.proc = spawn(
      bin,
      [
        '-n',
        `--listening-ip=${this.ip}`,
        `--relay-ip=${this.ip}`,
        `--listening-port=${this.port}`,
        '--use-auth-secret',
        `--static-auth-secret=${this.secret}`,
        '--realm=purplecallio.test',
        '--fingerprint',
        '--no-tls',
        '--no-dtls',
        '--min-port=50000',
        '--max-port=50999',
        '--log-file=stdout',
        '--simple-log',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.proc.stdout.on('data', (d) => (this.log += d));
    this.proc.stderr.on('data', (d) => (this.log += d));
    for (let i = 0; i < 50; i++) {
      if (/listener opened on|Total UDP servers/i.test(this.log)) return;
      if (this.proc.exitCode !== null) throw new Error(`turnserver exited:\n${this.log}`);
      await wait(100);
    }
  }

  async stop() {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    proc.kill('SIGKILL');
    await new Promise((r) => (proc.exitCode !== null ? r() : proc.once('exit', r)));
  }

  /** Same algorithm as apps/server TurnService.getCredentials (Coturn REST API). */
  credentials({ bad = false } = {}) {
    const username = `${Math.floor(Date.now() / 1000) + 3600}:purplecallio`;
    const credential = createHmac('sha1', bad ? 'wrong-secret' : this.secret)
      .update(username)
      .digest('base64');
    return [
      { urls: `stun:${this.ip}:${this.port}` },
      { urls: `turn:${this.ip}:${this.port}`, username, credential },
    ];
  }
}

export async function bundleSdk() {
  const result = await build({
    entryPoints: [path.join(repoRoot, 'packages/sdk/src/index.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'PurpleCallioSDK',
    platform: 'browser',
    write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

/**
 * One call with a CALLER and a RECEIVER token. `turnMode` per call:
 * 'ok' (valid TURN credentials) or 'bad' (TURN rejects the credentials).
 */
export class Gateway {
  constructor({ coturn, sdkBundle, sdkPage }) {
    Object.assign(this, { coturn, sdkBundle, sdkPage });
    this.http = createServer((req, res) => this.onHttp(req, res));
    this.io = new Server(this.http, { cors: { origin: true } });
    this.io.on('connection', (s) => this.onConnection(s));
    this.newCall();
  }

  newCall({ type = 'VIDEO', turnMode = 'ok', dropCandidateTypes = [] } = {}) {
    const id = `call-${randomBytes(4).toString('hex')}`;
    this.call = {
      id,
      type,
      turnMode,
      dropCandidateTypes,
      status: 'RINGING',
      tokens: {
        [`bj_session_${randomBytes(32).toString('hex')}`]: { role: 'CALLER', participantId: 'alice' },
        [`bj_session_${randomBytes(32).toString('hex')}`]: { role: 'RECEIVER', participantId: 'bob' },
      },
    };
    this.sessions = new Map(); // socketId -> session
    this.room = new Set();
    this.telemetry = [];
    this.signalLog = [];
    return this.call;
  }

  tokenFor(role) {
    return Object.entries(this.call.tokens).find(([, s]) => s.role === role)[0];
  }

  async listen() {
    await new Promise((r) => this.http.listen(0, '0.0.0.0', r));
    this.port = this.http.address().port;
    // localhost: getUserMedia needs a secure context. ICE still uses the
    // LAN interface for host candidates.
    this.url = `http://localhost:${this.port}`;
  }

  async close() {
    await new Promise((r) => this.io.close(() => r()));
  }

  socketOf(role) {
    for (const [id, s] of this.sessions) if (s.role === role) return this.io.sockets.sockets.get(id);
    return null;
  }

  otherSocketId(socketId) {
    for (const id of this.sessions.keys()) if (id !== socketId) return id;
    return null;
  }

  authenticate(socket, token) {
    const session = this.call.tokens[token];
    if (!session) return { success: false };
    // Same token on a new socket replaces the old one (multi-tab / reconnect).
    for (const [id, s] of this.sessions) {
      if (s.role === session.role && id !== socket.id) {
        this.sessions.delete(id);
        this.room.delete(id);
        this.io.sockets.sockets.get(id)?.disconnect(true);
      }
    }
    if (!this.sessions.has(socket.id)) {
      this.sessions.set(socket.id, session);
      socket.emit('connected', {
        callId: this.call.id,
        participantId: session.participantId,
        role: session.role,
        source: 'CUSTOMER',
        expiresAt: null,
      });
      if (session.role === 'RECEIVER' && !['ENDED', 'REJECTED'].includes(this.call.status))
        socket.emit('incoming-call', {
          callId: this.call.id,
          callerId: 'alice',
          callerName: 'Alice',
          type: this.call.type,
        });
    }
    return { success: true, role: session.role };
  }

  onConnection(socket) {
    const handshakeToken = socket.handshake.auth?.token;
    if (typeof handshakeToken === 'string') this.authenticate(socket, handshakeToken);

    socket.on('authenticate', (body, ack) => ack?.(this.authenticate(socket, body?.token)));

    socket.on('join-call', async (body, ack) => {
      const session = this.sessions.get(socket.id);
      if (!session || body?.callId !== this.call.id) return ack?.({ success: false });
      await wait(5);
      await socket.join(this.call.id);
      this.room.add(socket.id);
      const participants = [...this.room].map((id) => ({
        participantId: this.sessions.get(id)?.participantId,
        role: this.sessions.get(id)?.role,
        media: { camera: false, microphone: false, screenShare: false },
      }));
      socket.emit('call.state', { callId: this.call.id, participants });
      this.io.to(this.call.id).emit('participant.joined', {
        callId: this.call.id,
        participantId: session.participantId,
        participants: this.room.size,
      });
      ack?.({ success: true, participants: this.room.size, state: { callId: this.call.id, participants } });
    });

    for (const event of ['offer', 'answer', 'ice-candidate']) {
      socket.on(event, (payload) => {
        const session = this.sessions.get(socket.id);
        // CallGateway.isAuthorized(requireJoined=true): room members only.
        const relayed = !!session && this.room.has(socket.id);
        const type = event === 'ice-candidate' ? / typ (\w+)/.exec(payload?.candidate?.candidate ?? '')?.[1] : undefined;
        const dropped = relayed && type && this.call.dropCandidateTypes.includes(type);
        this.signalLog.push({ event, role: session?.role, relayed: relayed && !dropped, type, at: Date.now() });
        if (!relayed || dropped) return;
        const target = this.otherSocketId(socket.id);
        if (target) this.io.to(target).emit(event, payload);
      });
    }

    for (const event of [
      'camera.enabled',
      'camera.disabled',
      'microphone.enabled',
      'microphone.disabled',
      'screenShare.started',
      'screenShare.stopped',
    ]) {
      socket.on(event, () => {
        const session = this.sessions.get(socket.id);
        if (session) this.io.to(this.call.id).emit(event, { callId: this.call.id, participantId: session.participantId });
      });
    }
    socket.on('call.started', () => this.io.to(this.call.id).emit('call.started', { callId: this.call.id }));
    socket.on('call.ended', () => {
      this.call.status = 'ENDED';
      this.io.to(this.call.id).emit('call.ended', { callId: this.call.id });
    });
    socket.on('call-ended', () => {
      const target = this.otherSocketId(socket.id);
      if (target) this.io.to(target).emit('call-ended');
    });
    socket.on('leave-call', () => this.leave(socket));
    socket.on('disconnect', () => {
      this.leave(socket);
      this.sessions.delete(socket.id);
    });
  }

  leave(socket) {
    const session = this.sessions.get(socket.id);
    if (!this.room.delete(socket.id) || !session) return;
    void socket.leave(this.call.id);
    this.io.to(this.call.id).emit('participant.left', {
      callId: this.call.id,
      participantId: session.participantId,
      participants: this.room.size,
    });
  }

  async onHttp(req, res) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const url = new URL(req.url, 'http://x');
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/sdk.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(this.sdkBundle);
    }
    if (url.pathname === '/sdk.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(this.sdkPage);
    }
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const session = this.call.tokens[token];
    if (!session) return json(401, { message: 'Unauthorized' });

    let body = '';
    for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : undefined;

    if (url.pathname === '/turn/credentials')
      return json(200, { iceServers: this.coturn.credentials({ bad: this.call.turnMode === 'bad' }) });

    const m = /^\/calls\/([^/]+)\/([\w-]+)$/.exec(url.pathname);
    if (!m || decodeURIComponent(m[1]) !== this.call.id) return json(404, { message: 'Not found' });
    const action = m[2];
    if (action === 'details')
      return json(200, { type: this.call.type, participantId: session.participantId, branding: null });
    if (action === 'webrtc-transport' || action === 'webrtc-ice') {
      this.telemetry.push({ kind: action, role: session.role, at: Date.now(), ...data });
      return json(201, { ok: true });
    }
    if (action === 'accept') {
      this.call.status = 'ACCEPTED';
      const caller = this.socketOf('CALLER');
      caller?.emit('call-accepted', { callId: this.call.id });
      return json(201, { ok: true });
    }
    if (action === 'end') {
      this.call.status = 'ENDED';
      this.io.to(this.call.id).emit('call-ended');
      return json(201, { ok: true });
    }
    return json(201, { ok: true }); // join / leave / cancel / reject
  }
}
