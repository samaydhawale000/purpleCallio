/**
 * Live smoke test for the /ai relay (stage 3): no browser needed.
 *
 *   # with an API key (creates a session via POST /ai/sessions):
 *   npx ts-node scripts/ai-relay-smoke.ts --api-key bj_live_… --agent <agentId> [--wav in.wav]
 *   # or with a bj_ai_ token you already have:
 *   npx ts-node scripts/ai-relay-smoke.ts --token bj_ai_… [--wav in.wav]
 *
 * Options: --url (default http://localhost:3005), --out (default
 * ai-reply.wav), --seconds to keep listening after the input (default 15).
 * The input WAV must be 16 kHz mono PCM16; without one, only silence is
 * sent and you should still hear the agent's welcome message.
 * The server needs AI_ENABLED=true and GEMINI_API_KEY.
 */
import { readFileSync, writeFileSync } from 'fs';
import { io } from 'socket.io-client';

const FRAME_MS = 20;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readPcm16Wav(path: string): Buffer {
  const file = readFileSync(path);
  if (file.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Not a WAV');
  let offset = 12;
  let format: { channels: number; rate: number; bits: number } | null = null;
  while (offset + 8 <= file.length) {
    const id = file.toString('ascii', offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        channels: file.readUInt16LE(body + 2),
        rate: file.readUInt32LE(body + 4),
        bits: file.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (
        !format ||
        format.channels !== 1 ||
        format.rate !== 16_000 ||
        format.bits !== 16
      ) {
        throw new Error(
          `WAV must be 16 kHz mono PCM16, got ${JSON.stringify(format)}`,
        );
      }
      return file.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

function wav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function createToken(baseUrl: string): Promise<string> {
  const apiKey = arg('api-key');
  const agentId = arg('agent');
  if (!apiKey || !agentId) {
    throw new Error('Pass --token, or --api-key and --agent');
  }
  const res = await fetch(`${baseUrl}/ai/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      agentId,
      participant: { id: 'smoke-test', name: 'Smoke Test' },
    }),
  });
  const body = (await res.json()) as { token?: string; sessionId?: string };
  if (!res.ok || !body.token) {
    throw new Error(
      `Session create failed: ${res.status} ${JSON.stringify(body)}`,
    );
  }
  console.log(`session ${body.sessionId}`);
  return body.token;
}

async function main() {
  const baseUrl = (arg('url') ?? 'http://localhost:3005').replace(/\/+$/, '');
  const out = arg('out') ?? 'ai-reply.wav';
  const listenSeconds = Number(arg('seconds') ?? 15);
  const wavPath = arg('wav');
  const input = wavPath ? readPcm16Wav(wavPath) : Buffer.alloc(0);
  const token = arg('token') ?? (await createToken(baseUrl));

  const socket = io(`${baseUrl}/ai`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });
  const received: Buffer[] = [];
  let outputRate = 24_000;

  const done = new Promise<void>((resolve) => {
    socket.on('ended', (e: { reason: string }) => {
      console.log(`ended reason=${e.reason}`);
      resolve();
    });
    socket.on('disconnect', () => resolve());
  });

  socket.on('connect_error', (err) =>
    console.error(`connect_error ${err.message}`),
  );
  socket.on('error', (e: { code: string }) =>
    console.error(`error code=${e.code}`),
  );
  socket.on('state', (e: { state: string }) => console.log(`state ${e.state}`));
  socket.on('interrupted', () => console.log('interrupted'));
  socket.on(
    'transcript',
    (t: { role: string; text: string; final: boolean }) => {
      if (t.final) console.log(`transcript ${t.role}: ${t.text}`);
    },
  );
  socket.on('audio', (chunk: Buffer | ArrayBuffer) => {
    received.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  socket.on(
    'ready',
    async (r: { inputSampleRate: number; outputSampleRate: number }) => {
      console.log(
        `ready in=${r.inputSampleRate}Hz out=${r.outputSampleRate}Hz`,
      );
      outputRate = r.outputSampleRate;
      const frameBytes = (r.inputSampleRate * 2 * FRAME_MS) / 1000;
      // Input in real time, then silence so the provider's VAD sees the
      // turn end and the agent has time to answer.
      const silence = Buffer.alloc(
        frameBytes * Math.ceil((listenSeconds * 1000) / FRAME_MS),
      );
      const stream = Buffer.concat([input, silence]);
      for (let i = 0; i < stream.length && socket.connected; i += frameBytes) {
        socket.emit('audio', stream.subarray(i, i + frameBytes));
        await new Promise((res) => setTimeout(res, FRAME_MS));
      }
      socket.emit('end');
    },
  );

  await done;
  socket.close();
  const pcm = Buffer.concat(received);
  writeFileSync(out, wav(pcm, outputRate));
  console.log(
    `saved ${(pcm.length / 2 / outputRate).toFixed(1)}s of agent audio to ${out}`,
  );
  process.exit(pcm.length > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
