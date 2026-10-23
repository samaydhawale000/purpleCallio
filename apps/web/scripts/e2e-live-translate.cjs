/**
 * Live Translate end-to-end check: two real browsers in one translated call.
 *
 * Needs: API server with TRANSLATION_ENABLED=true (TRANSLATION_MOCK_PROVIDER=true
 * for offline runs), the web app, and translation access for the key's account
 * (trial minutes or the TRANSLATION plan feature).
 *
 *   E2E_API_KEY=bj_live_… node apps/web/scripts/e2e-live-translate.cjs
 *
 * Optional env: API_URL (http://localhost:3005), PLAYWRIGHT_PATH (path to the
 * playwright package), OUT_DIR (screenshots), CALL_SECONDS (25).
 */
const path = require('path');

const API = process.env.API_URL || 'http://localhost:3005';
const KEY = process.env.E2E_API_KEY;
const OUT = process.env.OUT_DIR || process.cwd();
const SECONDS = Number(process.env.CALL_SECONDS || 25);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function createCall() {
  const res = await fetch(`${API}/calls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify({
      callerId: 'e2e-doctor',
      receiverId: 'e2e-patient',
      callerName: 'Dr. Rao',
      receiverName: 'Patient',
      type: 'AUDIO',
      callerLanguage: 'mr',
      receiverLanguage: 'en',
      translation: { mode: 'voice', maxMinutes: 5, guard: { enabled: true } },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`POST /calls ${res.status} ${body.code || ''} ${body.message || ''}`);
  return body;
}

async function captionTexts(page) {
  return page
    .locator('[aria-label="Live translation captions"] li')
    .allInnerTexts()
    .catch(() => []);
}

(async () => {
  if (!KEY) throw new Error('Set E2E_API_KEY to an API key of a project with Live Translate access.');

  const call = await createCall();
  const caller = call.participants.find((p) => p.role === 'CALLER' || p.role === 'caller') || call.participants[0];
  const receiver = call.participants.find((p) => p !== caller);
  check('POST /calls with translation', call.translation?.mode === 'voice', `callId ${call.callId || call.id}`);
  check('participants carry languages', caller.language === 'mr' && receiver.language === 'en');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const errors = [];
  const open = async (url, label) => {
    const ctx = await browser.newContext({ permissions: ['microphone', 'camera'], viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return page;
  };

  const a = await open(caller.hostedUrl, 'caller');
  const b = await open(receiver.hostedUrl, 'receiver');

  // Receiver answers (the hosted UI rings first).
  await b.getByRole('button', { name: 'Accept' }).click({ timeout: 20000 }).catch(() => {});

  // Both pages auto-enable translation from the call details; wait for captions.
  const waitCaptions = (p) => p.waitForSelector('[aria-label="Live translation captions"] li', { timeout: SECONDS * 1000 });
  const [ca, cb] = await Promise.allSettled([waitCaptions(a), waitCaptions(b)]);
  check('caller sees DualView captions', ca.status === 'fulfilled');
  check('receiver sees DualView captions', cb.status === 'fulfilled');

  await a.waitForTimeout(SECONDS * 1000);
  const ta = await captionTexts(a);
  const tb = await captionTexts(b);
  check('captions keep flowing', ta.length + tb.length >= 2, `${ta.length} on caller, ${tb.length} on receiver`);
  const flagged = (await a.getByText(/May not be accurate/i).count()) + (await b.getByText(/May not be accurate/i).count());
  check('MeaningGuard flags a changed amount (mock changes every 5th phrase)', flagged > 0, `${flagged} flagged`);
  const pct = [...ta, ...tb].some((t) => /\d+\s?%\s*(accura|confiden)/i.test(t));
  check('no confidence percentages shown', !pct);
  check('replay is off by default (no Replay original button)', (await b.getByRole('button', { name: /Replay original/ }).count()) === 0);

  // Ask to repeat → the speaker gets a prompt.
  const ask = b.getByRole('button', { name: /^Ask to repeat/ }).first();
  if (await ask.count()) {
    await ask.click();
    const prompt = await a.getByText(/repeat/i).first().isVisible({ timeout: 5000 }).catch(() => false);
    check('Ask to repeat reaches the speaker', prompt);
  } else {
    check('Ask to repeat button present', false);
  }

  await a.screenshot({ path: path.join(OUT, 'e2e-caller.png') });
  await b.screenshot({ path: path.join(OUT, 'e2e-receiver.png') });
  console.log('\nCaller captions:\n  ' + ta.slice(-4).join('\n  '));
  console.log('Receiver captions:\n  ' + tb.slice(-4).join('\n  '));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\nScreenshots: ${path.join(OUT, 'e2e-caller.png')}, ${path.join(OUT, 'e2e-receiver.png')}`);
  await browser.close();
})().catch((e) => {
  console.error('E2E aborted:', e.message);
  process.exit(1);
});
