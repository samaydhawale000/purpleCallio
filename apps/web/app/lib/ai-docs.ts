import { PURPLECALLIO_API_URL, PURPLECALLIO_SIGNAL_URL } from './brand';

/**
 * Shared content for the AI Voice Agents docs: the section on /docs and the
 * /docs/ai-agents page render the same snippets and tables.
 */

export const AI_TOOL_SCHEMA_EXAMPLE = `{
  "type": "object",
  "description": "Look up an order by its id",
  "properties": {
    "orderId": { "type": "string", "description": "The order id, e.g. ord_123" },
    "channel": { "type": "string", "enum": ["web", "store"] },
    "notify":  { "type": "boolean" }
  },
  "required": ["orderId"]
}`;

export const AI_SERVER_SESSION_EXAMPLE = `// Your backend: the API key never leaves the server.
import express from "express";
import { PurpleCallioClient } from "@purplecallio/sdk";

const client = new PurpleCallioClient({
  apiKey: process.env.PURPLECALLIO_API_KEY!,
  apiUrl: "${PURPLECALLIO_API_URL}",
});

const app = express();

app.post("/api/ai-session", requireLogin, async (req, res) => {
  const session = await client.ai.createSession({
    agentId: process.env.PURPLECALLIO_AGENT_ID!,
    participant: { id: req.user.id, name: req.user.name },
    metadata: { plan: req.user.plan }, // optional, max 2 KB JSON
  });
  // Hand the browser only the short-lived bj_ai_ token.
  res.json({ token: session.token });
});

// Later, from your backend:
// await client.ai.getSession(sessionId);
// await client.ai.endSession(sessionId);`;

export const AI_BROWSER_EXAMPLE = `import { PurpleCallioAgentCall } from "@purplecallio/sdk";

async function talkToAgent() {
  const { token } = await fetch("/api/ai-session", { method: "POST" }).then((r) => r.json());

  const call = new PurpleCallioAgentCall({
    token,
    apiUrl: "${PURPLECALLIO_SIGNAL_URL}", // your PurpleCallio server origin (required)
  });

  call.on("transcript", ({ role, text, final }) => render(role, text, final));
  call.on("agentState", (state) => setIndicator(state)); // listening | thinking | speaking
  call.on("tool.confirmation_required", ({ id, name }) =>
    call.confirmTool(id, window.confirm(\`Allow the agent to run \${name}?\`)),
  );
  call.on("error", (err) => console.warn(err.code));
  call.on("ended", ({ reason }) => console.log("ended:", reason));

  await call.start(); // call from a click handler so audio can play
  // call.mute(); call.unmute(); call.end();
}`;

export const AI_REACT_HOOK_EXAMPLE = `import { usePurpleCallioAI } from "@purplecallio/react";

const getToken = () =>
  fetch("/api/ai-session", { method: "POST" })
    .then((r) => r.json())
    .then((s) => s.token);

export function SupportAgent() {
  const ai = usePurpleCallioAI({
    getToken,
    apiUrl: "${PURPLECALLIO_SIGNAL_URL}", // required
  });

  if (ai.status === "idle" || ai.status === "ended") {
    return <button onClick={ai.start}>Talk to support</button>;
  }
  return (
    <div>
      <p>{ai.status} · {ai.agentState} · {ai.durationSeconds}s</p>
      <button onClick={ai.isMuted ? ai.unmute : ai.mute}>{ai.isMuted ? "Unmute" : "Mute"}</button>
      <button onClick={ai.end}>End</button>
      {ai.pendingConfirmations.map((t) => (
        <button key={t.id} onClick={() => ai.confirmTool(t.id, true)}>Allow {t.name}</button>
      ))}
      {ai.error && <p role="alert">{ai.error.code}</p>}
      {ai.transcript.map((l) => <p key={l.key}>{l.role}: {l.text}</p>)}
    </div>
  );
}`;

export const AI_REACT_COMPONENT_EXAMPLE = `import { PurpleCallioAI } from "@purplecallio/react";

export function SupportWidget() {
  return (
    <PurpleCallioAI
      apiUrl="${PURPLECALLIO_SIGNAL_URL}" // required
      getToken={() => fetch("/api/ai-session", { method: "POST" }).then((r) => r.json())}
      className="my-agent"
      startLabel="Talk to support"
    />
  );
}`;

export const AI_TOOL_SIGNATURE_EXAMPLE = `const crypto = require("crypto");
const express = require("express");

const SECRET = process.env.PURPLECALLIO_TOOL_SECRET; // bj_tool_…
const MAX_SKEW_SECONDS = 300;

function verifyPurpleCallio(rawBody, headers) {
  const timestamp = headers["x-purplecallio-timestamp"];
  const signature = headers["x-purplecallio-signature"] || "";
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return false; // missing or stale: possible replay
  }
  const expected =
    "sha256=" + crypto.createHmac("sha256", SECRET).update(\`\${timestamp}.\${rawBody}\`).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const app = express();

// Verify against the raw bytes, before any JSON parsing.
app.post("/tools/order-status", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verifyPurpleCallio(raw, req.headers)) return res.status(401).json({ error: "bad signature" });
  const { arguments: args } = JSON.parse(raw);
  res.json({ status: lookUpOrder(args.orderId) });
});

// GET tools: the signed string is the \`payload\` query parameter.
app.get("/tools/order-status", (req, res) => {
  const raw = String(req.query.payload || "");
  if (!verifyPurpleCallio(raw, req.headers)) return res.status(401).json({ error: "bad signature" });
  const { arguments: args } = JSON.parse(raw);
  res.json({ status: lookUpOrder(args.orderId) });
});`;

export const AI_TOOL_REQUEST_BODY = `{
  "tool": "orderStatus",
  "arguments": { "orderId": "ord_123" },
  "sessionId": "…",
  "callId": "…",
  "agentId": "…",
  "participant": { "id": "user_42", "name": "Sam" }
}`;

export const AI_TOOL_HEADERS: [string, string][] = [
  ['X-PurpleCallio-Event', 'ai.tool_call'],
  ['X-PurpleCallio-Timestamp', 'Unix time in seconds when the request was signed'],
  ['X-PurpleCallio-Signature', 'sha256=<hex HMAC-SHA256 of "<timestamp>.<body>">, keyed with the tool signing secret (bj_tool_…)'],
];

export const AI_TOOL_SCHEMA_RULES: string[] = [
  'The root is { "type": "object", "properties": {…}, "required": [...] } with an optional description.',
  'Each property has a type of string, number, integer or boolean, plus an optional description and enum (1–64 values of that type).',
  'No nesting, arrays, $ref or other keywords. At most 32 properties; names match ^[a-zA-Z][a-zA-Z0-9_]{0,63}$; the schema is at most 16 KB.',
  'Arguments the model sends are checked against the schema before your endpoint is called. String arguments are capped at 4,096 characters.',
];

export const AI_SSRF_RULES: string[] = [
  'Endpoints must be https:// URLs. Plain http is refused.',
  'The host is resolved before every request, and the call is refused if any address is private, loopback, link-local (including 169.254.169.254 cloud metadata), CGNAT, multicast, documentation or another reserved range, for IPv4 and IPv6.',
  'The connection is pinned to the checked address, so DNS rebinding cannot redirect it.',
  'Redirects are not followed. Responses must be JSON and at most 64 KB, and must arrive within the tool timeout (500 ms–30 s, capped at 8 s by default).',
];

export const AI_ERROR_CODES: [string, string][] = [
  ['AI_DISABLED', 'AI voice agents are not enabled on this deployment.'],
  ['AI_PAID_PLAN_REQUIRED', 'The account is on the Free plan. Upgrade to any paid plan.'],
  ['AI_AGENT_NOT_FOUND', 'The agent id does not exist or belongs to another account.'],
  ['AI_AGENT_DISABLED', 'The agent is disabled in the dashboard.'],
  ['AI_QUOTA_EXCEEDED', 'The daily or monthly AI minute limit is used up.'],
  ['AI_CONCURRENCY_LIMIT', 'Too many AI calls are running for the account or platform. Retry shortly.'],
  ['AI_INSUFFICIENT_CREDITS', 'The credit balance cannot cover a call. Top up or renew.'],
  ['AI_SESSION_CREATE_FAILED', 'The session could not be created. Retry with backoff.'],
  ['AI_PROVIDER_UNAVAILABLE', 'The voice model provider is unreachable. The session is not billed.'],
  ['AI_CONNECTION_FAILED', 'The live connection to the agent failed.'],
  ['AI_SESSION_EXPIRED', 'The token was not used within its time to connect (5 minutes by default).'],
  ['AI_SESSION_ENDED', 'The session already ended. Create a new one; tokens are single-use.'],
  ['AI_MAX_DURATION_REACHED', 'The call hit the agent’s maximum duration and was ended.'],
  ['AI_TOOL_FAILED', 'A tool endpoint failed, was refused or returned an invalid response.'],
  ['AI_TOOL_TIMEOUT', 'A tool endpoint did not answer within its timeout.'],
  ['AI_MICROPHONE_DENIED', 'Browser SDK only: the user denied microphone access.'],
  ['AI_MICROPHONE_UNAVAILABLE', 'Browser SDK only: no microphone was found.'],
  ['AI_AUDIO_UNSUPPORTED', 'Browser SDK only: the browser lacks the audio APIs the call needs.'],
];

export const AI_LIMITS: [string, string][] = [
  ['Concurrent AI calls per account', '3'],
  ['Platform-wide concurrent AI calls', '50'],
  ['AI minutes per account per day', '120'],
  ['AI minutes per account per month', '1,000'],
  ['Maximum call duration', '30 minutes (agent default 10 minutes, minimum 30 seconds)'],
  ['Time to connect after creating a session', '5 minutes'],
  ['Tool calls per session', '20'],
  ['Tool timeout', '8 seconds'],
  ['Tool response size', '64 KB'],
  ['Stored transcript messages per call', '500'],
];

export const AI_SECURITY_NOTES: string[] = [
  'Create sessions only from your backend with your bj_live_ API key, and only after you have authenticated your own user. The browser receives a bj_ai_ token that works for one session and expires if unused.',
  'Provider keys (Gemini, OpenAI) stay on PurpleCallio servers. Audio is relayed through PurpleCallio; the browser never talks to a model provider directly.',
  'Verify the signature and timestamp on every tool request, and treat tool arguments as untrusted input from the model.',
  'Turn on "requires confirmation" for tools with side effects (refunds, bookings), so the user must approve each call in the browser.',
  'Keep secrets out of agent instructions and session metadata: both are sent to the model provider.',
  'Transcripts are stored only when you enable them on the agent, have card-like numbers, API keys and email addresses redacted, and are deleted after the retention period you choose.',
];
