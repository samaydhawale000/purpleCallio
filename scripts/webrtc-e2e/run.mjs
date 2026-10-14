#!/usr/bin/env node
// Real-browser WebRTC connectivity tests: two Chromium peers, real ICE, a
// real Coturn relay. Exercises @purplecallio/sdk and (with --hosted) the
// hosted /call page against the stand-in gateway in ./stack.mjs.
//
//   node scripts/webrtc-e2e/run.mjs            # SDK scenarios
//   node scripts/webrtc-e2e/run.mjs --hosted   # + hosted call page (starts `next dev`)
//
// Requires: Coturn's `turnserver` on PATH (or TURNSERVER_BIN) and
// playwright-core with Chromium (`npx playwright install chromium`; set
// PLAYWRIGHT_CORE to its path if it is not resolvable from here).
//
// Everything runs on one machine: "direct" means host candidates on the LAN
// interface. This validates the application's ICE/TURN/recovery logic, not
// real-world NAT traversal — see README.md for the network matrix.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Coturn, Gateway, bundleSdk, lanIPv4 } from './stack.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const args = new Set(process.argv.slice(2));
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

async function loadChromium() {
  try {
    return (await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core')).chromium;
  } catch {
    throw new Error('playwright-core not found: set PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core');
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeoutMs, everyMs = 250) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return { value: last, ms: Date.now() - start };
    await wait(everyMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
}

// Collects every RTCPeerConnection the page creates, so the probe reads the
// real connection independently of the code under test.
const INIT_SCRIPT = `(() => {
  const Orig = window.RTCPeerConnection;
  window.__pcs = [];
  function Wrapped(...a) { const pc = new Orig(...a); window.__pcs.push(pc); return pc; }
  Wrapped.prototype = Orig.prototype;
  Object.setPrototypeOf(Wrapped, Orig);
  window.RTCPeerConnection = Wrapped;
})();`;

/** Live state of the page's current peer connection, from getStats(). */
async function probe(page) {
  return page.evaluate(async () => {
    const pc = [...(window.__pcs ?? [])].reverse().find((p) => p.signalingState !== 'closed');
    if (!pc) return null;
    const stats = await pc.getStats();
    const byId = new Map();
    stats.forEach((r) => byId.set(r.id, r));
    let pairId;
    stats.forEach((r) => {
      if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
    });
    const pair = pairId ? byId.get(pairId) : undefined;
    const inbound = { audio: 0, video: 0 };
    stats.forEach((r) => {
      if (r.type === 'inbound-rtp') inbound[r.kind] = (inbound[r.kind] ?? 0) + (r.bytesReceived ?? 0);
    });
    const cfg = pc.getConfiguration();
    return {
      pcs: window.__pcs.length,
      ice: pc.iceConnectionState,
      local: pair ? byId.get(pair.localCandidateId)?.candidateType : null,
      remote: pair ? byId.get(pair.remoteCandidateId)?.candidateType : null,
      inbound,
      policy: cfg.iceTransportPolicy,
      turnConfigured: (cfg.iceServers ?? []).some((s) => [].concat(s.urls).some((u) => u.startsWith('turn'))),
      senders: pc.getSenders().map((s) => s.track?.kind ?? null),
    };
  });
}

/** Media is flowing: inbound RTP bytes (audio, and video if expected) grow. */
async function mediaFlowing(page, { video = true } = {}) {
  const a = await probe(page);
  await wait(1500);
  const b = await probe(page);
  if (!a || !b) return false;
  return b.inbound.audio > a.inbound.audio && (!video || b.inbound.video > a.inbound.video);
}

const directPath = (p) => p && p.local && p.remote && p.local !== 'relay' && p.remote !== 'relay';
const relayPath = (p) => p && (p.local === 'relay' || p.remote === 'relay');

const SDK_PAGE = `<!doctype html><meta charset="utf-8"><title>sdk e2e</title>
<script src="/sdk.js"></script>
<script>
  const q = new URLSearchParams(location.search);
  window.__events = [];
  const cfg = {
    token: q.get('token'), callId: q.get('callId'),
    signalUrl: location.origin, apiUrl: location.origin,
    audio: true, video: q.get('video') !== '0',
  };
  if (q.get('policy')) cfg.iceTransportPolicy = q.get('policy');
  if (q.get('recovery')) cfg.iceRecovery = JSON.parse(q.get('recovery'));
  const meeting = new PurpleCallioSDK.PurpleCallioMeeting(cfg);
  for (const ev of ['connection.status', 'connection.diagnostic', 'disconnected', 'participant.joined', 'participant.left'])
    meeting.on(ev, (p) => window.__events.push({ ev, p: JSON.parse(JSON.stringify(p ?? null)), t: Date.now() }));
  meeting.join().then(() => (window.__joined = true), (e) => (window.__joinError = String(e)));
</script>`;

const results = [];
function record(name, expected, outcome, ok, details) {
  results.push({ name, expected, outcome, ok, details });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      expected: ${expected}\n      observed: ${outcome}${details ? `\n      ${details}` : ''}`);
}

async function scenario(name, expected, fn) {
  if (only && !only.has(name.split(' ')[0])) return;
  try {
    const { outcome, ok, details } = await fn();
    record(name, expected, outcome, ok, details);
  } catch (e) {
    record(name, expected, `error: ${e.message}`, false);
  }
}

async function main() {
  const chromium = await loadChromium();
  const ip = lanIPv4();
  const coturn = new Coturn({ ip, port: 3479, secret: 'e2e-turn-secret' });
  await coturn.start();
  const gateway = new Gateway({ coturn, sdkBundle: await bundleSdk(), sdkPage: SDK_PAGE });
  await gateway.listen();
  console.log(`LAN ${ip} · gateway ${gateway.url} · coturn ${ip}:3479\n`);

  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const newPage = async () => {
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
    await context.addInitScript(INIT_SCRIPT);
    return context.newPage();
  };
  const openPages = [];
  const closePages = async () => {
    await Promise.all(openPages.splice(0).map((p) => p.context().close().catch(() => {})));
  };

  const sdkCall = async ({ callerPolicy, receiverPolicy, recovery, video = true, ...callOpts } = {}) => {
    const call = gateway.newCall(callOpts);
    const url = (role, policy) => {
      const q = new URLSearchParams({ token: gateway.tokenFor(role), callId: call.id, video: video ? '1' : '0' });
      if (policy) q.set('policy', policy);
      if (recovery) q.set('recovery', JSON.stringify(recovery));
      return `${gateway.url}/sdk.html?${q}`;
    };
    const caller = await newPage();
    const receiver = await newPage();
    openPages.push(caller, receiver);
    await caller.goto(url('CALLER', callerPolicy));
    await receiver.goto(url('RECEIVER', receiverPolicy));
    return { caller, receiver };
  };
  const statuses = (page) => page.evaluate(() => window.__events.filter((e) => e.ev === 'connection.status').map((e) => e.p));
  const lastStatus = async (page) => (await statuses(page)).at(-1);
  const connectedWithPath = async (page) => {
    const s = await lastStatus(page);
    return s?.status === 'connected' && s.path ? s : null;
  };
  const transportReports = () => gateway.telemetry.filter((t) => t.kind === 'webrtc-transport');

  // ── SDK ───────────────────────────────────────────────────────────────
  await scenario('S1 SDK: direct P2P works', 'P2P on both sides, TURN configured but unused, media flowing', async () => {
    const { caller, receiver } = await sdkCall();
    const { ms } = await until('both connected', async () => (await connectedWithPath(caller)) && (await connectedWithPath(receiver)), 20_000);
    const [pc, pr] = [await probe(caller), await probe(receiver)];
    const flowing = (await mediaFlowing(caller)) && (await mediaFlowing(receiver));
    const reports = transportReports().map((t) => `${t.role}:${t.transport}(${t.candidateType}/${t.remoteCandidateType}, setup ${t.setupMs}ms, media ${t.mediaVerified})`);
    await closePages();
    const ok = directPath(pc) && directPath(pr) && pc.turnConfigured && pc.policy === 'all' && flowing && transportReports().every((t) => t.transport === 'P2P');
    return {
      ok,
      outcome: `caller ${pc.local}->${pc.remote}, receiver ${pr.local}->${pr.remote}; policy=${pc.policy}, turnConfigured=${pc.turnConfigured}; media=${flowing}; connected in ${ms}ms`,
      details: `telemetry: ${reports.join('; ')}`,
    };
  });

  await scenario('S2 SDK: direct impossible on one side -> TURN fallback', 'relay path selected automatically, media flowing', async () => {
    // The RECEIVER can only use relay candidates (as behind a firewall that
    // blocks every direct path); the CALLER runs the normal "all" policy.
    const { caller, receiver } = await sdkCall({ receiverPolicy: 'relay' });
    const { ms } = await until('both connected', async () => (await connectedWithPath(caller)) && (await connectedWithPath(receiver)), 20_000);
    const [pc, pr] = [await probe(caller), await probe(receiver)];
    const flowing = (await mediaFlowing(caller)) && (await mediaFlowing(receiver));
    const reports = transportReports().map((t) => `${t.role}:${t.transport}(${t.candidateType}/${t.remoteCandidateType})`);
    await closePages();
    return {
      ok: relayPath(pc) && relayPath(pr) && pc.policy === 'all' && flowing && transportReports().every((t) => t.transport === 'TURN'),
      outcome: `caller(policy ${pc.policy}) ${pc.local}->${pc.remote}, receiver(policy ${pr.policy}) ${pr.local}->${pr.remote}; media=${flowing}; connected in ${ms}ms`,
      details: `telemetry: ${reports.join('; ')}`,
    };
  });

  await scenario('S3 SDK: media path lost mid-call -> ICE restart recovers', 'recovering, then connected again via ICE restart, media resumes', async () => {
    // Media relayed through Coturn on both sides; killing Coturn removes the
    // only working path (like a network change), restarting it brings a path back.
    const { caller, receiver } = await sdkCall({ callerPolicy: 'relay', receiverPolicy: 'relay' });
    await until('both connected', async () => (await connectedWithPath(caller)) && (await connectedWithPath(receiver)), 20_000);
    const lostAt = Date.now();
    await coturn.stop();
    await until('recovering', async () => (await statuses(caller)).some((s) => s.status === 'recovering'), 20_000);
    await wait(4_000);
    await coturn.start();
    const { ms } = await until(
      'connected after recovery',
      async () => {
        const all = await statuses(caller);
        const i = all.findIndex((s) => s.status === 'recovering');
        return i >= 0 && all.slice(i).some((s) => s.status === 'connected') && (await probe(caller)).ice === 'connected';
      },
      45_000,
    );
    const flowing = (await mediaFlowing(caller)) && (await mediaFlowing(receiver));
    const pc = await probe(caller);
    const trail = (await statuses(caller)).map((s) => `${s.status}${s.reason ? `:${s.reason}` : ''}`).join(' > ');
    const restarts = gateway.signalLog.filter((e) => e.event === 'offer' && e.role === 'CALLER').length - 1;
    await closePages();
    return {
      ok: flowing && restarts >= 1 && pc.pcs === 1,
      outcome: `recovered ${Math.round((Date.now() - lostAt) / 1000)}s after the path was lost (${ms}ms after TURN came back); ICE restarts=${restarts}; same RTCPeerConnection=${pc.pcs === 1}; media=${flowing}`,
      details: `caller status: ${trail}`,
    };
  });

  await scenario('S3b SDK: signaling socket drops mid-call', 'socket reconnects and rejoins; no ICE restart; media uninterrupted', async () => {
    const { caller, receiver } = await sdkCall();
    await until('both connected', async () => (await connectedWithPath(caller)) && (await connectedWithPath(receiver)), 20_000);
    const offersBefore = gateway.signalLog.filter((e) => e.event === 'offer').length;
    gateway.socketOf('CALLER').conn.close();
    await until('caller back in room', async () => gateway.room.size === 2 && gateway.socketOf('CALLER'), 10_000);
    const flowing = (await mediaFlowing(caller)) && (await mediaFlowing(receiver));
    await wait(1000);
    const offers = gateway.signalLog.filter((e) => e.event === 'offer').length - offersBefore;
    await closePages();
    return { ok: flowing && offers === 0, outcome: `rejoined; extra offers=${offers}; media=${flowing}` };
  });

  await scenario('S4 SDK: neither direct nor TURN possible', 'clear `failed` status within the recovery deadline, no infinite connecting', async () => {
    // RECEIVER is relay-only and TURN rejects its credentials: no candidate
    // pair can ever form. Default deadlines: setup 15s + recovery 35s.
    const { caller, receiver } = await sdkCall({ receiverPolicy: 'relay', turnMode: 'bad' });
    const start = Date.now();
    await until('failed status', async () => (await lastStatus(caller))?.status === 'failed', 70_000, 500);
    const seconds = Math.round((Date.now() - start) / 1000);
    const trail = (await statuses(caller)).map((s) => `${s.status}${s.reason ? `:${s.reason}` : ''}`).join(' > ');
    const diag = await caller.evaluate(() => window.__events.filter((e) => e.ev === 'connection.diagnostic').map((e) => e.p.code));
    const gaveUp = gateway.telemetry.filter((t) => t.kind === 'webrtc-ice' && t.reason === 'RECOVERY_EXHAUSTED');
    const restarts = gateway.signalLog.filter((e) => e.event === 'offer' && e.role === 'CALLER').length - 1;
    const receiverFailed = (await lastStatus(receiver))?.status === 'failed';
    await closePages();
    return {
      ok: gaveUp.length === 2 && receiverFailed && diag.includes('ICE_FAILED') && seconds <= 60,
      outcome: `both sides failed after ${seconds}s; caller ICE restarts=${restarts}; give-up telemetry: ${gaveUp.map((t) => `${t.role} ${t.reason}/${t.cause} restarts=${t.iceRestarts}`).join(', ')}`,
      details: `caller status: ${trail}`,
    };
  });

  await scenario('S5 SDK: audio-only call', 'no video sender, audio flows', async () => {
    const { caller, receiver } = await sdkCall({ video: false });
    await until('both connected', async () => (await connectedWithPath(caller)) && (await connectedWithPath(receiver)), 20_000);
    const pc = await probe(caller);
    const flowing = (await mediaFlowing(caller, { video: false })) && (await mediaFlowing(receiver, { video: false }));
    const after = await probe(caller);
    await closePages();
    return {
      ok: !pc.senders.includes('video') && flowing && after.inbound.video === 0,
      outcome: `senders=[${pc.senders}], inbound video bytes=${after.inbound.video}, audio flowing=${flowing}`,
    };
  });

  // ── Hosted call page ─────────────────────────────────────────────────
  if (args.has('--hosted')) {
    const port = Number(process.env.HOSTED_PORT ?? 3100);
    // `next dev` adds the e2e build dir to tsconfig's include; put it back after.
    const tsconfigPath = path.join(repoRoot, 'apps/web/tsconfig.json');
    const tsconfig = readFileSync(tsconfigPath, 'utf8');
    const next = spawn('npx', ['next', 'dev', '-p', String(port)], {
      cwd: path.join(repoRoot, 'apps/web'),
      // Own build dir (and dev lock), so a developer's running `next dev` is untouched.
      env: { ...process.env, NEXT_PUBLIC_API_URL: gateway.url, NEXT_TELEMETRY_DISABLED: '1', NEXT_E2E_DIST_DIR: '.next-e2e' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let nextLog = '';
    next.stdout.on('data', (d) => (nextLog += d));
    next.stderr.on('data', (d) => (nextLog += d));
    try {
      await until('next dev ready', async () => /Ready|ready in/i.test(nextLog), 120_000, 500);
      const origin = `http://localhost:${port}`;

      const hostedCall = async ({ receiverPolicy, callerPolicy, ...callOpts } = {}) => {
        const call = gateway.newCall(callOpts);
        const url = (role, policy) => {
          const q = new URLSearchParams({ token: gateway.tokenFor(role), callId: call.id });
          if (policy) q.set('iceTransportPolicy', policy);
          return `${origin}/call?${q}`;
        };
        const caller = await newPage();
        const receiver = await newPage();
        openPages.push(caller, receiver);
        await caller.goto(url('CALLER', callerPolicy), { timeout: 120_000 });
        await caller.getByLabel('Call', { exact: true }).click({ timeout: 60_000 });
        await receiver.goto(url('RECEIVER', receiverPolicy), { timeout: 120_000 });
        await receiver.getByLabel('Accept').click({ timeout: 30_000 });
        return { caller, receiver };
      };
      const bothReported = () =>
        ['CALLER', 'RECEIVER'].every((role) => transportReports().some((t) => t.role === role));

      await scenario('H1 hosted page: direct P2P works', 'P2P on both sides, TURN configured, media flowing', async () => {
        const { caller, receiver } = await hostedCall();
        const { ms } = await until('transport reported by both', async () => bothReported(), 30_000);
        const [pc, pr] = [await probe(caller), await probe(receiver)];
        const flowing = (await mediaFlowing(caller)) && (await mediaFlowing(receiver));
        const reports = transportReports().map((t) => `${t.role}:${t.transport}(${t.candidateType}/${t.remoteCandidateType}, setup ${t.setupMs}ms, media ${t.mediaVerified})`);
        await closePages();
        return {
          ok: directPath(pc) && directPath(pr) && pc.turnConfigured && pr.turnConfigured && flowing,
          outcome: `caller ${pc.local}->${pc.remote}, receiver ${pr.local}->${pr.remote}; turnConfigured=${pc.turnConfigured}/${pr.turnConfigured}; media=${flowing}; reported in ${ms}ms`,
          details: `telemetry: ${reports.join('; ')}`,
        };
      });

      await scenario('H2 hosted page: direct impossible on one side -> TURN fallback', 'relay path selected, media flowing', async () => {
        const { caller, receiver } = await hostedCall({ receiverPolicy: 'relay' });
        await until('transport reported by both', async () => bothReported(), 30_000);
        const [pc, pr] = [await probe(caller), await probe(receiver)];
        const flowing = (await mediaFlowing(caller)) && (await mediaFlowing(receiver));
        await closePages();
        return {
          ok: relayPath(pc) && relayPath(pr) && pc.policy === 'all' && flowing,
          outcome: `caller(policy ${pc.policy}) ${pc.local}->${pc.remote}, receiver(policy ${pr.policy}) ${pr.local}->${pr.remote}; media=${flowing}`,
        };
      });

      await scenario('H3 hosted page: media path lost mid-call -> ICE restart recovers', 'Reconnecting banner, then back in call with media', async () => {
        const { caller, receiver } = await hostedCall({ callerPolicy: 'relay', receiverPolicy: 'relay' });
        await until('transport reported by both', async () => bothReported(), 30_000);
        const lostAt = Date.now();
        await coturn.stop();
        await until('Reconnecting banner', async () => caller.getByText('Reconnecting…').isVisible(), 20_000);
        await wait(4_000);
        await coturn.start();
        await until('ICE connected again', async () => (await probe(caller))?.ice === 'connected' && !(await caller.getByText('Reconnecting…').isVisible()), 45_000);
        const flowing = (await mediaFlowing(caller)) && (await mediaFlowing(receiver));
        const failedScreen = await caller.getByText('Unable to connect').isVisible();
        const restarts = gateway.signalLog.filter((e) => e.event === 'offer' && e.role === 'CALLER').length - 1;
        await closePages();
        return {
          ok: flowing && !failedScreen && restarts >= 1,
          outcome: `recovered ${Math.round((Date.now() - lostAt) / 1000)}s after the path was lost; ICE restarts=${restarts}; media=${flowing}`,
        };
      });

      await scenario('H3b hosted page: signaling socket drops mid-call (both sides)', 'stays in the call, re-joins the room, media uninterrupted', async () => {
        const { caller, receiver } = await hostedCall();
        await until('transport reported by both', async () => bothReported(), 30_000);
        const joinsBefore = gateway.room.size;
        gateway.socketOf('CALLER').conn.close();
        gateway.socketOf('RECEIVER').conn.close();
        await until('both back in the room', async () => gateway.room.size === 2 && gateway.socketOf('CALLER') && gateway.socketOf('RECEIVER'), 15_000);
        await wait(1500);
        const lobby = await caller.getByLabel('Call', { exact: true }).isVisible().catch(() => false);
        const ringing = await receiver.getByLabel('Accept').isVisible().catch(() => false);
        const flowing = (await mediaFlowing(caller)) && (await mediaFlowing(receiver));
        await closePages();
        return {
          ok: !lobby && !ringing && flowing,
          outcome: `room size before=${joinsBefore} after=2; caller bounced to lobby=${lobby}; receiver re-rung=${ringing}; media=${flowing}`,
        };
      });

      await scenario('H4 hosted page: neither direct nor TURN possible', '"Unable to connect" within the recovery deadline', async () => {
        const start = Date.now();
        const { caller, receiver } = await hostedCall({ receiverPolicy: 'relay', turnMode: 'bad' });
        try {
          await until('Unable to connect', async () => caller.getByText('Unable to connect').isVisible(), 75_000, 500);
        } catch (e) {
          const text = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200);
          throw new Error(`${e.message}; caller shows "${await text(caller)}"; receiver shows "${await text(receiver)}"; telemetry ${JSON.stringify(gateway.telemetry)}; offers ${gateway.signalLog.filter((x) => x.event === 'offer').map((x) => x.role)}`);
        }
        const seconds = Math.round((Date.now() - start) / 1000);
        const gaveUp = gateway.telemetry.find((t) => t.kind === 'webrtc-ice' && t.reason === 'RECOVERY_EXHAUSTED');
        await until('receiver failure screen', async () => receiver.getByText('Unable to connect').isVisible(), 10_000);
        const pcState = await probe(caller);
        await closePages();
        return {
          ok: !!gaveUp && seconds <= 70 && pcState === null,
          outcome: `both sides show "Unable to connect" after ${seconds}s (incl. page load); telemetry ${gaveUp?.reason}/${gaveUp?.cause}; peer connection closed=${pcState === null}`,
        };
      });
    } finally {
      next.kill('SIGTERM');
      writeFileSync(tsconfigPath, tsconfig);
      if (results.some((r) => r.name.startsWith('H') && !r.ok)) console.log(nextLog.slice(-3000));
    }
  }

  await browser.close();
  await gateway.close();
  await coturn.stop();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
