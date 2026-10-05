'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Atom, Blocks, BookOpen, Cable, CreditCard, Gauge, Headset, KeyRound, Lightbulb, Monitor, RotateCw, Server, Smartphone, UserRound, Webhook, Zap } from 'lucide-react';
import { api } from '../lib/api';
import { PURPLECALLIO_API_URL, PURPLECALLIO_SIGNAL_URL, PURPLECALLIO_URL } from '../lib/brand';

// ── Sidebar nav ───────────────────────────────────────────────────────────────
const NAV = [
  { group: 'Start here', items: [{ id: 'quickstart', label: 'Quick Start', icon: Zap }, { id: 'how-it-works', label: 'How it works', icon: RotateCw }, { id: 'authentication', label: 'Authentication', icon: KeyRound }] },
  { group: 'Products', items: [{ id: 'hosted-ui', label: 'Hosted UI', icon: Monitor }, { id: 'react-components', label: 'React Components', icon: Atom }, { id: 'headless-sdk', label: 'Headless SDK', icon: Blocks }, { id: 'angular-sdk', label: 'Angular SDK', icon: Blocks }, { id: 'react-native-sdk', label: 'React Native SDK', icon: Smartphone }, { id: 'vue-sdk', label: 'Vue SDK', icon: Blocks }, { id: 'svelte-sdk', label: 'Svelte SDK', icon: Blocks }] },
  { group: 'REST API', items: [{ id: 'api-create', label: 'POST /calls' }, { id: 'api-join', label: 'POST /calls/:id/join' }, { id: 'api-leave', label: 'POST /calls/:id/leave' }, { id: 'api-accept', label: 'POST /calls/:id/accept' }, { id: 'api-reject', label: 'POST /calls/:id/reject' }, { id: 'api-end', label: 'POST /calls/:id/end' }, { id: 'api-get', label: 'GET /calls/:id' }] },
{ group: 'Real-time', items: [{ id: 'websocket', label: 'WebSocket Events', icon: Cable }, { id: 'webhooks', label: 'Webhooks', icon: Webhook }] },
  { group: 'Billing', items: [{ id: 'usage-billing', label: 'Usage & Billing', icon: CreditCard }] },
  { group: 'Reference', items: [{ id: 'examples', label: 'Examples', icon: Lightbulb }, { id: 'errors', label: 'Errors', icon: Gauge }, { id: 'faq', label: 'FAQ', icon: BookOpen }, { id: 'support', label: 'Contact Support', icon: Headset }] },
];

// ── Tiny primitives ───────────────────────────────────────────────────────────
type LangKey = 'sdk' | 'node' | 'python' | 'curl';

function MethodBadge({ verb }: { verb: 'GET' | 'POST' | 'PATCH' | 'DELETE' }) {
  const c: Record<string, string> = { GET: '#10B981', POST: '#7F40E8', PATCH: '#F59E0B', DELETE: '#EF4444' };
  return (
    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded" style={{ background: `${c[verb]}22`, color: c[verb], border: `1px solid ${c[verb]}44` }}>
      {verb}
    </span>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text.trim()); setOk(true); setTimeout(() => setOk(false), 1500); }}
      className="text-xs font-mono px-2 py-0.5 rounded transition-all shrink-0"
      style={{ background: ok ? 'rgba(16,185,129,0.15)' : 'rgba(127,64,232,0.06)', color: ok ? '#10B981' : '#3D3650' }}>
      {ok ? '✓ copied' : 'copy'}
    </button>
  );
}

function Code({ code, label }: { code: string; label?: string }) {
  return (
    <div className="rounded-xl border border-[#E7DFF5] overflow-hidden" style={{ background: '#F8F4FD' }}>
      {label && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#E7DFF5]">
          <span className="font-mono text-xs text-[#3D3650]">{label}</span>
          <CopyBtn text={code} />
        </div>
      )}
      {!label && <div className="flex justify-end px-4 pt-3 pb-0"><CopyBtn text={code} /></div>}
      <pre className="font-mono text-xs text-[#3D3650] px-5 py-4 overflow-x-auto" style={{ lineHeight: 1.8 }}>{code.trim()}</pre>
    </div>
  );
}

function LangTabs({ tabs }: { tabs: Partial<Record<LangKey, string>> }) {
  const keys = Object.keys(tabs) as LangKey[];
  const labels: Record<LangKey, string> = { sdk: 'SDK', node: 'Node.js', python: 'Python', curl: 'cURL' };
  const [active, setActive] = useState<LangKey>(keys[0]);
  return (
    <div className="my-4">
      <div className="flex gap-1 mb-0 border-b border-[#E7DFF5]">
        {keys.map((k) => (
          <button key={k} onClick={() => setActive(k)}
            className="text-xs font-mono px-3 py-2 transition-all border-b-2 -mb-px"
            style={{ color: active === k ? '#6425C4' : '#3D3650', borderColor: active === k ? '#7F40E8' : 'transparent', background: 'transparent' }}>
            {labels[k]}
          </button>
        ))}
      </div>
      <Code code={tabs[active] ?? ''} />
    </div>
  );
}

function Tip({ children, type = 'info' }: { children: React.ReactNode; type?: 'info' | 'warn' | 'tip' }) {
  const s = { info: { bg: 'rgba(127,64,232,0.06)', b: 'rgba(127,64,232,0.25)', icon: 'ℹ', c: '#6425C4' }, warn: { bg: 'rgba(245,158,11,0.08)', b: 'rgba(245,158,11,0.3)', icon: '⚠', c: '#92400E' }, tip: { bg: 'rgba(16,185,129,0.08)', b: 'rgba(16,185,129,0.3)', icon: '✓', c: '#065F46' } }[type];
  return (
    <div className="flex gap-3 rounded-xl px-4 py-3 my-4 text-sm leading-relaxed border" style={{ background: s.bg, borderColor: s.b }}>
      <span style={{ color: s.c }}>{s.icon}</span>
      <span className="text-[#3D3650]">{children}</span>
    </div>
  );
}

function Section({ id, children }: { id: string; children: React.ReactNode }) {
  return <section id={id} className="mb-20 scroll-mt-20">{children}</section>;
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="font-bold text-[#170B2E] mb-6 pb-3 border-b border-[#E7DFF5]" style={{ fontSize: '1.35rem', letterSpacing: '-0.02em' }}>{children}</h2>;
}

// ── Accordion endpoint card ───────────────────────────────────────────────────
function Endpoint({ method, path, summary, children, id }: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string; summary: string; children: React.ReactNode; id?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div id={id} className="rounded-xl border border-[#E7DFF5] overflow-hidden mb-3 transition-all scroll-mt-20" style={{ background: open ? '#F3ECFB' : '#FFFFFF' }}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-[#7F40E8]/[0.03] transition-all">
        <MethodBadge verb={method} />
        <code className="font-mono text-sm text-[#3D3650]">{path}</code>
        <span className="text-[#3D3650] text-xs ml-2 hidden sm:block">— {summary}</span>
        <span className="ml-auto text-[#3D3650] text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-5 pb-5 pt-1 border-t border-[#E7DFF5]">{children}</div>}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function DocsPage() {
  const [activeId, setActiveId] = useState('quickstart');
  const [rates, setRates] = useState<{
    audioPaise: number;
    videoPaise: number;
    screenSharePaise: number;
    freeAudioMins: number;
    freeVideoMins: number;
    taxPercent: number;
  } | null>(null);

  useEffect(() => {
    const ob = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActiveId(e.target.id); }),
      { rootMargin: '-15% 0px -65% 0px' }
    );
    document.querySelectorAll('section[id]').forEach((el) => ob.observe(el));
    return () => ob.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    api
      .get('/billing/rates')
      .then((res) => { if (active) setRates(res.data); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const paiseToINR = (p: number) => `₹${((p ?? 0) / 100).toFixed(2)}`;
  const audio = rates ? paiseToINR(rates.audioPaise) : 'Loading…';
  const video = rates ? paiseToINR(rates.videoPaise) : 'Loading…';
  const screen = rates ? paiseToINR(rates.screenSharePaise) : 'Loading…';
  const freeAudio = rates?.freeAudioMins;
  const freeVideo = rates?.freeVideoMins;

  return (
    <div style={{ background: '#FFFFFF', color: '#170B2E', minHeight: '100vh' }}>

      <div className="max-w-7xl mx-auto flex pt-20">

        {/* sidebar */}
        <aside className="hidden lg:flex flex-col w-56 shrink-0 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-8 px-4 border-r border-[#E7DFF5]" style={{ maxHeight: 'calc(100vh - 4rem)' }}>
          {NAV.map((g) => (
            <div key={g.group} className="mb-5">
              <p className="font-mono text-xs text-[#3D3650] uppercase tracking-widest mb-2 px-3">{g.group}</p>
              {g.items.map((item) => (
                <a key={item.id} href={`#${item.id}`}
                  className="flex items-center text-xs px-3 py-1.5 rounded-lg transition-all mb-0.5"
                  style={{ color: activeId === item.id ? '#6425C4' : '#64748B', background: activeId === item.id ? 'rgba(127,64,232,0.1)' : 'transparent', borderLeft: activeId === item.id ? '2px solid #7F40E8' : '2px solid transparent' }}>
                  {item.icon && <item.icon size={14} className="mr-2 shrink-0" />}{item.label}
                </a>
              ))}
            </div>
          ))}
        </aside>

        {/* content */}
        <main className="flex-1 min-w-0 px-6 lg:px-10 py-10 max-w-6xl">

          {/* ── Quick Start ───────────────────────────── */}
          <Section id="quickstart">
            <div className="mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono mb-4 border" style={{ background: 'rgba(127,64,232,0.1)', borderColor: 'rgba(127,64,232,0.3)', color: '#6425C4' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                Start here
              </div>
              <h1 className="font-bold text-[#170B2E] mb-3" style={{ fontSize: 'clamp(1.75rem, 3vw, 2.25rem)', letterSpacing: '-0.03em' }}>
                First call in 5 minutes
              </h1>
              <p className="text-[#3D3650] text-base leading-relaxed">
                Two API calls. Two URLs. That's the entire integration.
              </p>
            </div>

            {/* Steps */}
            <div className="space-y-3 mb-8">
              {[
                { n: '01', title: 'Get your API key', body: 'Sign up → create a project → copy your key (starts with bj_live_).' },
                { n: '02', title: 'Install the SDK', body: null },
                { n: '03', title: 'Create a call from your backend', body: null },
                { n: '04', title: 'Redirect each user — done', body: 'Alice opens callerUrl, Bob opens receiverUrl. PurpleCallio handles the rest.' },
              ].map((step, i) => (
                <div key={step.n} className="flex gap-4 rounded-xl border border-[#E7DFF5] p-5 transition-all hover:border-[#D6C4EE]" style={{ background: '#FFFFFF' }}>
                  <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center font-mono text-xs font-bold" style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.2), rgba(65,6,134,0.2))', color: '#6425C4', border: '1px solid rgba(127,64,232,0.25)' }}>
                    {step.n}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#170B2E] text-sm mb-1">{step.title}</p>
                    {step.body && <p className="text-xs text-[#3D3650]">{step.body}</p>}
                    {i === 1 && <Code code="npm install @purplecallio/sdk" />}
                    {i === 2 && (
                      <LangTabs tabs={{
                        sdk: `import PurpleCallio from '@purplecallio/sdk';
const bj = new PurpleCallio({ apiKey: process.env.PURPLECALLIO_API_KEY });

const { callId, callerUrl, receiverUrl } = await bj.createCall({
  callerId: 'user_alice',
  receiverId: 'user_bob',
});`,
                        node: `const res = await fetch('${PURPLECALLIO_API_URL}/calls', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.PURPLECALLIO_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ callerId: 'user_alice', receiverId: 'user_bob' }),
});
const { callId, callerUrl, receiverUrl } = await res.json();`,
                        python: `import os
import httpx

async with httpx.AsyncClient() as client:
    r = await client.post(
        '${PURPLECALLIO_API_URL}/calls',
        headers={'x-api-key': os.environ['PURPLECALLIO_API_KEY']},
        json={'callerId': 'user_alice', 'receiverId': 'user_bob'},
    )
data = r.json()
caller_url  = data['callerUrl']
receiver_url = data['receiverUrl']`,
                        curl: `curl -X POST ${PURPLECALLIO_API_URL}/calls \\
  -H "x-api-key: $PURPLECALLIO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"callerId":"user_alice","receiverId":"user_bob"}'`,
                      }} />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Tip type="info">
              Your <strong>bj_live_</strong> API key is server-side only. Never send it to the browser.
            </Tip>
          </Section>

          {/* ── How it works ─────────────────────────── */}
          <Section id="how-it-works">
            <Heading>How it works</Heading>

            {/* Visual flow */}
            <div className="rounded-xl border border-[#E7DFF5] p-6 mb-6" style={{ background: '#FFFFFF' }}>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-center">
                {[
                  { icon: Server, label: 'Your backend', sub: 'POST /calls' },
                  null,
                  { icon: Zap, label: 'PurpleCallio', sub: 'Returns 2 URLs' },
                  null,
                  { icon: UserRound, label: 'Alice (caller)', sub: 'Opens callerUrl' },
                  null,
                  { icon: UserRound, label: 'Bob (receiver)', sub: 'Opens receiverUrl' },
                ].map((item, i) =>
                  item === null ? (
                    <div key={i} className="text-[#3D3650] text-lg hidden sm:block">→</div>
                  ) : (
                    <div key={item.label} className="flex flex-col items-center gap-1">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center border border-[#D6C4EE] text-[#6425C4]" style={{ background: '#F8F4FD' }}><item.icon size={22} /></div>
                      <p className="text-xs font-semibold text-[#170B2E]">{item.label}</p>
                      <p className="font-mono text-xs text-[#3D3650]">{item.sub}</p>
                    </div>
                  )
                )}
              </div>
              <div className="mt-6 pt-5 border-t border-[#E7DFF5] grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-[#3D3650]">
                <div><span className="text-[#6425C4] font-semibold">Signaling</span> — WebSocket events between browser and server</div>
                <div><span className="text-[#6425C4] font-semibold">WebRTC</span> — peer-to-peer media, negotiated automatically</div>
                <div><span className="text-[#6425C4] font-semibold">TURN</span> — relay for calls behind strict firewalls</div>
              </div>
            </div>

            {/* 3 tokens */}
            <p className="text-sm font-semibold text-[#170B2E] mb-3">Three types of credentials</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { prefix: 'bj_live_...', name: 'API Key', who: 'Your server → REST API', color: '#7F40E8' },
                { prefix: 'bj_session_...', name: 'Session Token', who: 'Browser → WebSocket', color: '#A05DF9' },
                { prefix: 'JWT Bearer', name: 'Dashboard JWT', who: 'Dashboard UI → management API', color: '#6425C4' },
              ].map((t) => (
                <div key={t.name} className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#F3ECFB' }}>
                  <code className="font-mono text-xs block mb-2" style={{ color: t.color }}>{t.prefix}</code>
                  <p className="text-xs font-semibold text-[#170B2E]">{t.name}</p>
                  <p className="text-xs text-[#3D3650] mt-0.5">{t.who}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Authentication ───────────────────────── */}
          <Section id="authentication">
            <Heading>Authentication</Heading>
            <p className="text-[#3D3650] text-sm mb-4">Every REST request needs your API key in the <code className="font-mono text-xs">x-api-key</code> header.</p>
            <Code code="x-api-key: $PURPLECALLIO_API_KEY" label="Header" />
            <Tip type="warn">
              Session tokens in <code className="font-mono text-xs bg-black/30 px-1 rounded">callerUrl</code> / <code className="font-mono text-xs bg-black/30 px-1 rounded">receiverUrl</code> are single-use. Do not cache or reuse them.
            </Tip>
          </Section>

          {/* ── Hosted UI ────────────────────────────── */}
          <Section id="hosted-ui">
            <Heading>Hosted UI — zero frontend work</Heading>
            <p className="text-[#3D3650] text-sm mb-5">
              The fastest way to integrate. Create a call from your backend, then
              redirect your users to a PurpleCallio-hosted meeting page. No frontend
              implementation required.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {[
                'Ready-made meeting UI',
                'Video & audio calling',
                'Screen sharing',
                'Device selection',
                'Waiting room',
                'Responsive design',
                'Branding support',
                'WebRTC + TURN handled',
              ].map((f) => (
                <div key={f} className="rounded-lg border border-[#E7DFF5] px-3 py-2 text-xs text-[#3D3650]" style={{ background: '#F3ECFB' }}>
                  ✓ {f}
                </div>
              ))}
            </div>

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Integration flow</p>
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-center rounded-xl border border-[#E7DFF5] p-6 mb-6" style={{ background: '#FFFFFF' }}>
              {[
                { icon: Server, label: 'Your backend', sub: 'POST /calls' },
                null,
                { icon: Zap, label: 'PurpleCallio', sub: 'Returns hostedUrl + tokens' },
                null,
                { icon: UserRound, label: 'Redirect users', sub: 'Meeting starts' },
              ].map((item, i) =>
                item === null ? (
                  <div key={i} className="text-[#3D3650] text-lg hidden sm:block">→</div>
                ) : (
                  <div key={item.label} className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center border border-[#D6C4EE] text-[#6425C4]" style={{ background: '#F8F4FD' }}><item.icon size={22} /></div>
                    <p className="text-xs font-semibold text-[#170B2E]">{item.label}</p>
                    <p className="font-mono text-xs text-[#3D3650]">{item.sub}</p>
                  </div>
                )
              )}
            </div>

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Branding</p>
            <p className="text-[#3D3650] text-sm mb-3">
              Configure branding on your project and the hosted page will apply it automatically.
            </p>
            <Code code={`{
  "branding": {
    "companyName": "Acme",
    "logoUrl": "https://cdn.acme.com/logo.png",
    "primaryColor": "#2563EB"
  },
  "theme": "dark",
  "waitingRoom": true
}`} label="Project settings (dashboard)" />

            <Tip type="tip">
              Integration time: <strong>5 minutes</strong>. Create a call, redirect your users, done.
            </Tip>
          </Section>

          {/* ── React Components ─────────────────────── */}
          <Section id="react-components">
            <Heading>⚛️ React UI Components</Heading>
            <p className="text-[#3D3650] text-sm mb-5">
              Build a custom interface with reusable React components — no need to
              implement WebRTC, signaling, or media handling yourself.
            </p>

            <Code code="npm install @purplecallio/react" label="install" />

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Quick example</p>
            <Code code={`import { MeetingProvider, MeetingRoom, ParticipantGrid, ControlBar } from '@purplecallio/react';

export function Call({ token, callId, signalUrl }) {
  return (
    <MeetingProvider token={token} callId={callId} signalUrl={signalUrl}>
      <MeetingRoom>
        <ParticipantGrid />
      </MeetingRoom>
      <ControlBar />
    </MeetingProvider>
  );
}`} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-5">
              {[
                { c: 'MeetingProvider', d: 'Context provider — wires the engine, media, and signaling' },
                { c: 'MeetingRoom', d: 'Meeting layout shell with waiting room support' },
                { c: 'ParticipantGrid / ParticipantTile', d: 'Grid of participant video tiles' },
                { c: 'ActiveSpeakerView', d: 'Large speaker view + local PiP' },
                { c: 'CameraButton / MicrophoneButton', d: 'Toggle camera / microphone' },
                { c: 'ScreenShareButton / LeaveButton', d: 'Screen share + end call controls' },
                { c: 'DeviceSelector', d: 'Camera / microphone / speaker picker' },
                { c: 'WaitingRoom', d: 'Waiting room panel' },
                { c: 'ConnectionStatus', d: 'Live connection state indicator' },
                { c: 'SpeakingIndicator', d: 'Active speaker indicator' },
              ].map((x) => (
                <div key={x.c} className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
                  <code className="font-mono text-xs block mb-1" style={{ color: '#6425C4' }}>{x.c}</code>
                  <p className="text-xs text-[#3D3650]">{x.d}</p>
                </div>
              ))}
            </div>

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Hooks</p>
            <Code code={`import { useMeeting, useParticipants, useParticipant, useDevices, useConnection } from '@purplecallio/react';

function Status() {
  const { connectionState } = useConnection();
  const participants = useParticipants();
  const { toggleCamera, toggleMicrophone } = useMeeting();
  const devices = useDevices();
  return null;
}`} />

            <Tip type="info">
              <code className="font-mono text-xs bg-black/30 px-1 rounded">@purplecallio/react</code> is built on top of{' '}
              <code className="font-mono text-xs bg-black/30 px-1 rounded">@purplecallio/sdk</code> — the same session tokens and signaling work across both.
            </Tip>
          </Section>

          {/* ── Headless SDK ─────────────────────────── */}
          <Section id="headless-sdk">
            <Heading>Headless SDK</Heading>
            <p className="text-[#3D3650] text-sm mb-5">
              For developers who want complete control. PurpleCallio provides only the
              communication engine — no UI included.
            </p>

            <Code code="npm install @purplecallio/sdk" label="install" />

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Quick example</p>
<Code code={`import { PurpleCallioMeeting } from '@purplecallio/sdk';

const meeting = new PurpleCallioMeeting({
  token,            // bj_session_... for this participant
  callId,
  signalUrl: '${PURPLECALLIO_SIGNAL_URL}',
  apiUrl: '${PURPLECALLIO_API_URL}',
});

await meeting.join();

meeting.camera.enable();
meeting.microphone.disable();
await meeting.screenShare.start();

meeting.on('participant.joined', (p) => console.log('joined', p));
meeting.on('remote.stream', (stream) => attachToVideo(stream));

await meeting.leave();`} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-5">
              {[
                { m: 'meeting.join()', r: 'Connects socket, authenticates, joins room' },
                { m: 'meeting.leave()', r: 'Ends the meeting, cleans up media' },
                { m: 'meeting.camera.enable() / disable()', r: 'Toggle camera track' },
                { m: 'meeting.microphone.enable() / disable()', r: 'Toggle microphone track' },
                { m: 'meeting.screenShare.start() / stop()', r: 'Start / stop screen share' },
                { m: 'meeting.participants()', r: 'Live list of participants' },
                { m: 'meeting.connectionState()', r: "Current connection state" },
                { m: 'meeting.on(event, cb)', r: 'Subscribe to meeting events' },
              ].map((m) => (
                <div key={m.m} className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
                  <code className="font-mono text-xs block mb-1" style={{ color: '#6425C4' }}>{m.m}</code>
                  <p className="text-xs text-[#3D3650]">→ {m.r}</p>
                </div>
              ))}
            </div>

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Events</p>
            <Code code={`meeting.on('connected', (p) => {});
meeting.on('disconnected', () => {});
meeting.on('reconnected', () => {});
meeting.on('call.started', (d) => {});
meeting.on('call.ended', (d) => {});
meeting.on('participant.joined', (p) => {});
meeting.on('participant.left', (p) => {});
meeting.on('participant.updated', (p) => {});
meeting.on('camera.enabled' | 'camera.disabled', () => {});
meeting.on('microphone.enabled' | 'microphone.disabled', () => {});
meeting.on('screenShare.started' | 'screenShare.stopped', () => {});
meeting.on('remote.stream', (stream) => {});
meeting.on('remote.stream.ended', () => {});`} />
          </Section>

          {/* ── Angular SDK ──────────────────────────── */}
          <Section id="angular-sdk">
            <Heading>Angular SDK</Heading>
            <p className="text-[#3D3650] text-sm mb-5">
              An injectable service and video directive for Angular apps, built on the
              same engine as the JavaScript SDK. Requires Angular 16+.
            </p>

            <Code code="npm install @purplecallio/angular @purplecallio/sdk" label="install" />

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Quick example</p>
            <Code code={`import { Component, OnDestroy, OnInit } from '@angular/core';
import { PurpleCallioService } from '@purplecallio/angular';

@Component({
  selector: 'app-call',
  standalone: true,
  template: \`
    <video purplecallioVideo [stream]="call.localStream$ | async" [muted]="true"></video>
    <video purplecallioVideo [stream]="call.remoteStream$ | async"></video>
  \`,
})
export class CallComponent implements OnInit, OnDestroy {
  constructor(public call: PurpleCallioService) {}

  ngOnInit() {
    this.call.configure({ token, callId, signalUrl });
    this.call.join();
  }

  ngOnDestroy() {
    this.call.leave();
  }
}`} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-5">
              {[
                { c: 'PurpleCallioService', d: 'Injectable, providedIn root — configure(), join(), leave()' },
                { c: 'connectionState$ / participants$', d: 'RxJS observables for live meeting state' },
                { c: 'remoteStream$ / localStream$', d: 'Observables carrying MediaStream | null' },
                { c: 'camera / microphone', d: 'enable() / disable() / toggle() / isEnabled()' },
                { c: 'screenShare', d: 'start() / stop() / isActive()' },
                { c: 'purplecallioVideo directive', d: 'Binds a stream to a <video> element' },
              ].map((x) => (
                <div key={x.c} className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
                  <code className="font-mono text-xs block mb-1" style={{ color: '#6425C4' }}>{x.c}</code>
                  <p className="text-xs text-[#3D3650]">{x.d}</p>
                </div>
              ))}
            </div>

            <Tip type="info">
              The service does not expose the raw engine instance — state is only available through
              observables and the control methods above, keeping the public surface small.
            </Tip>
          </Section>

          {/* ── React Native SDK ─────────────────────── */}
          <Section id="react-native-sdk">
            <Heading>React Native SDK</Heading>
            <p className="text-[#3D3650] text-sm mb-5">
              Reuses the same call engine as the web SDKs on top of react-native-webrtc, with
              permission handling, camera switching, and background/foreground lifecycle built in.
            </p>

            <Code code="npm install @purplecallio/react-native @purplecallio/sdk react-native-webrtc" label="install" />

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Quick example</p>
            <Code code={`import { registerGlobals } from 'react-native-webrtc';
registerGlobals(); // once, at app startup

import { PurpleCallioProvider, useMeeting, PurpleCallioVideoView } from '@purplecallio/react-native';

function CallScreen() {
  const { join, remoteStream, localStream, toggleCamera, switchCamera } = useMeeting();

  useEffect(() => { join(); }, [join]);

  return <PurpleCallioVideoView stream={remoteStream} objectFit="cover" />;
}

export default function App() {
  return (
    <PurpleCallioProvider token={token} callId={callId} signalUrl={signalUrl}>
      <CallScreen />
    </PurpleCallioProvider>
  );
}`} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-5">
              {[
                { c: 'PurpleCallioProvider', d: 'Requests camera/mic permissions before join(), manages lifecycle' },
                { c: 'useMeeting / useParticipants', d: 'Same hook names as @purplecallio/react' },
                { c: 'PurpleCallioVideoView', d: 'Wraps react-native-webrtc\'s RTCView' },
                { c: 'switchCamera()', d: 'Toggle between front and back camera' },
                { c: 'setSpeakerphoneOn()', d: 'Requires the optional react-native-incall-manager package' },
                { c: 'pauseVideoInBackground', d: 'Camera auto-pauses while the app is backgrounded (default on)' },
              ].map((x) => (
                <div key={x.c} className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
                  <code className="font-mono text-xs block mb-1" style={{ color: '#6425C4' }}>{x.c}</code>
                  <p className="text-xs text-[#3D3650]">{x.d}</p>
                </div>
              ))}
            </div>

            <Tip type="warn">
              Screen sharing is not yet supported on React Native — it requires native platform
              integration (an iOS Broadcast Upload Extension and Android MediaProjection) not yet
              implemented in this package. Calling <code className="font-mono text-xs bg-black/30 px-1 rounded">screenShare.start()</code> rejects with a clear error.
            </Tip>
          </Section>

          {/* ── Vue SDK ──────────────────────────────── */}
          <Section id="vue-sdk">
            <Heading>Vue SDK</Heading>
            <p className="text-[#3D3650] text-sm mb-5">
              A Composition API composable for Vue 3 apps, exposing connection state, participants,
              and media as reactive refs.
            </p>

            <Code code="npm install @purplecallio/vue @purplecallio/sdk" label="install" />

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Quick example</p>
            <Code code={`<script setup lang="ts">
import { usePurpleCallio } from '@purplecallio/vue';
import PurpleCallioVideo from '@purplecallio/vue/components/PurpleCallioVideo.vue';

const { join, leave, localStream, remoteStream, camera } = usePurpleCallio({
  token, callId, signalUrl,
});

join();
</script>

<template>
  <PurpleCallioVideo :stream="localStream" muted />
  <PurpleCallioVideo :stream="remoteStream" />
  <button @click="camera.toggle()">Toggle camera</button>
</template>`} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-5">
              {[
                { c: 'usePurpleCallio(config)', d: 'Composable — creates the engine and wires reactive state' },
                { c: 'connectionState / participants', d: 'Reactive refs, usable directly in templates' },
                { c: 'remoteStream / localStream', d: 'shallowRef<MediaStream | null>' },
                { c: 'camera / microphone', d: 'enable() / disable() / toggle() / isEnabled()' },
                { c: 'screenShare', d: 'start() / stop() / isActive()' },
                { c: 'PurpleCallioVideo', d: 'Binds a stream to a <video> element' },
              ].map((x) => (
                <div key={x.c} className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
                  <code className="font-mono text-xs block mb-1" style={{ color: '#6425C4' }}>{x.c}</code>
                  <p className="text-xs text-[#3D3650]">{x.d}</p>
                </div>
              ))}
            </div>

            <Tip type="info">
              If the component using <code className="font-mono text-xs bg-black/30 px-1 rounded">usePurpleCallio()</code> unmounts while still
              connected, it automatically leaves the call as a safety net — but call <code className="font-mono text-xs bg-black/30 px-1 rounded">leave()</code> explicitly when you're done.
            </Tip>
          </Section>

          {/* ── Svelte SDK ───────────────────────────── */}
          <Section id="svelte-sdk">
            <Heading>Svelte SDK</Heading>
            <p className="text-[#3D3650] text-sm mb-5">
              A factory function returning Svelte stores for connection state, participants, and
              media. Works with Svelte 4 and Svelte 5 (uses classic stores, not runes, so it works
              as a plain library module).
            </p>

            <Code code="npm install @purplecallio/svelte @purplecallio/sdk" label="install" />

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Quick example</p>
            <Code code={`<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createPurpleCallio, PurpleCallioVideo } from '@purplecallio/svelte';

  const call = createPurpleCallio({ token, callId, signalUrl });
  call.join();

  onDestroy(() => call.destroy());
</script>

<PurpleCallioVideo stream={$call.localStream} muted={true} />
<PurpleCallioVideo stream={$call.remoteStream} />
<button on:click={() => call.camera.toggle()}>Toggle camera</button>`} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-5">
              {[
                { c: 'createPurpleCallio(config)', d: 'Factory — creates the engine and returns stores + controls' },
                { c: 'connectionState / participants', d: 'Readable stores — use $ auto-subscription in .svelte files' },
                { c: 'remoteStream / localStream', d: 'Readable<MediaStream | null>' },
                { c: 'camera / microphone', d: 'enable() / disable() / toggle() / isEnabled()' },
                { c: 'screenShare', d: 'start() / stop() / isActive()' },
                { c: 'call.destroy()', d: 'Unsubscribes and leaves — call from onDestroy()' },
              ].map((x) => (
                <div key={x.c} className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
                  <code className="font-mono text-xs block mb-1" style={{ color: '#6425C4' }}>{x.c}</code>
                  <p className="text-xs text-[#3D3650]">{x.d}</p>
                </div>
              ))}
            </div>

            <Tip type="warn">
              Unlike the React/Vue/Angular adapters, <code className="font-mono text-xs bg-black/30 px-1 rounded">createPurpleCallio()</code> is not tied to any
              component lifecycle automatically — you must call <code className="font-mono text-xs bg-black/30 px-1 rounded">call.destroy()</code> yourself from <code className="font-mono text-xs bg-black/30 px-1 rounded">onDestroy()</code>.
            </Tip>
          </Section>

          {/* ── REST API ─────────────────────────────── */}
          <Section id="api-create">
            <Heading>REST API</Heading>
            <p className="text-[#3D3650] text-sm mb-5">Base URL: <code className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: '#FFFFFF', color: '#6425C4' }}>{PURPLECALLIO_API_URL}</code></p>

            {/* POST /calls */}
            <Endpoint method="POST" path="/calls" summary="Create a call">
              <p className="text-[#3D3650] text-sm mb-4 mt-3">Creates a call session and returns two participant URLs.</p>

              <p className="text-xs font-semibold text-[#3D3650] mb-2">Request body</p>
              <div className="rounded-lg border border-[#E7DFF5] overflow-hidden mb-4">
                <table className="w-full text-xs">
                  <thead><tr style={{ background: '#F8F4FD' }}><th className="text-left px-3 py-2 text-[#3D3650] font-mono font-normal">field</th><th className="text-left px-3 py-2 text-[#3D3650] font-mono font-normal">type</th><th className="text-left px-3 py-2 text-[#3D3650] font-mono font-normal">required</th></tr></thead>
                  <tbody>
                    {[
                      { f: 'callerId', t: 'string', r: true },
                      { f: 'receiverId', t: 'string', r: true },
                      { f: 'type', t: '"VIDEO" | "AUDIO"', r: false },
                    ].map((row) => (
                      <tr key={row.f} className="border-t border-[#E7DFF5]">
                        <td className="px-3 py-2 font-mono" style={{ color: '#6425C4' }}>{row.f}</td>
                        <td className="px-3 py-2 text-[#3D3650]">{row.t}</td>
                        <td className="px-3 py-2" style={{ color: row.r ? '#DC2626' : '#3D3650' }}>{row.r ? 'required' : 'optional'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <LangTabs tabs={{
                sdk: `const { callId, callerUrl, receiverUrl } = await bj.createCall({
  callerId: 'user_alice',
  receiverId: 'user_bob',
});`,
                curl: `curl -X POST ${PURPLECALLIO_API_URL}/calls \\
  -H "x-api-key: $PURPLECALLIO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"callerId":"user_alice","receiverId":"user_bob"}'`,
              }} />

              <p className="text-xs font-semibold text-[#3D3650] mb-2 mt-4">Response — 201</p>
              <Code code={`{
  "callId": "clx8f2z...",
  "hostedUrl": "${PURPLECALLIO_URL}/call?callId=clx8f...&token=bj_session_...",
  "participants": [
    {
      "participantId": "user_alice",
      "token": "bj_session_...",
      "hostedUrl": "${PURPLECALLIO_URL}/call?callId=clx8f...&token=bj_session_...",
      "expiresAt": "2026-08-02T10:00:00.000Z"
    },
    {
      "participantId": "user_bob",
      "token": "bj_session_...",
      "hostedUrl": "${PURPLECALLIO_URL}/call?callId=clx8f...&token=bj_session_...",
      "expiresAt": "2026-08-02T10:00:00.000Z"
    }
  ]
}`} />
            </Endpoint>

            {/* POST join */}
            <Endpoint method="POST" path="/calls/:callId/join" summary="Join a call" id="api-join">
              <p className="text-[#3D3650] text-sm mb-4 mt-3">
                Marks this participant as joined. The hosted UI calls this automatically
                when the receiver accepts. Guarded by a session token (<code className="font-mono text-xs bg-black/30 px-1 rounded">Authorization: Bearer bj_session_...</code>).
              </p>
              <LangTabs tabs={{
sdk: `// SDK: engine.join() does this for you
const meeting = new PurpleCallioMeeting({ token, callId, signalUrl });
await meeting.join();`,
                curl: `curl -X POST ${PURPLECALLIO_API_URL}/calls/CALL_ID/join \\
  -H "Authorization: Bearer bj_session_..."`,
              }} />
              <Code code={`{ "callId": "clx8f2z...", "participantId": "user_bob", "joined": true }`} />
            </Endpoint>

            {/* POST leave */}
            <Endpoint method="POST" path="/calls/:callId/leave" summary="Leave a call" id="api-leave">
              <p className="text-[#3D3650] text-sm mb-4 mt-3">
                Marks this participant as left. Guarded by a session token.
              </p>
              <LangTabs tabs={{
                sdk: `await meeting.leave();`,
                curl: `curl -X POST ${PURPLECALLIO_API_URL}/calls/CALL_ID/leave \\
  -H "Authorization: Bearer bj_session_..."`,
              }} />
              <Code code={`{ "callId": "clx8f2z...", "participantId": "user_bob", "left": true }`} />
            </Endpoint>

            {/* POST accept */}
            <Endpoint method="POST" path="/calls/:callId/accept" summary="Accept a call" id="api-accept">
              <p className="text-[#3D3650] text-sm mb-4 mt-3">Marks a call as accepted. The hosted UI does this automatically when the receiver taps Accept.</p>
              <LangTabs tabs={{ sdk: `await bj.acceptCall('clx8f2z...');`, curl: `curl -X POST ${PURPLECALLIO_API_URL}/calls/CALL_ID/accept \\
  -H "Authorization: Bearer bj_session_"` }} />
              <Code code={`{ "callId": "clx8f2z...", "status": "ACCEPTED" }`} />
            </Endpoint>

            {/* POST reject */}
            <Endpoint method="POST" path="/calls/:callId/reject" summary="Reject a call" id="api-reject">
              <p className="text-[#3D3650] text-sm mb-4 mt-3">Receiver declines. The caller's UI is notified via WebSocket.</p>
              <LangTabs tabs={{ sdk: `await bj.rejectCall('clx8f2z...');`, curl: `curl -X POST ${PURPLECALLIO_API_URL}/calls/CALL_ID/reject \\
  -H "Authorization: Bearer bj_session_"` }} />
              <Code code={`{ "callId": "clx8f2z...", "status": "REJECTED" }`} />
            </Endpoint>

            {/* POST end */}
            <Endpoint method="POST" path="/calls/:callId/end" summary="End a call" id="api-end">
              <p className="text-[#3D3650] text-sm mb-4 mt-3">Ends an active call. Both participants receive a WebSocket <code className="font-mono text-xs bg-black/30 px-1 rounded">call.ended</code> event.</p>
              <LangTabs tabs={{ sdk: `await bj.endCall('clx8f2z...');`, curl: `curl -X POST ${PURPLECALLIO_API_URL}/calls/CALL_ID/end \\
  -H "Authorization: Bearer bj_session_"` }} />
              <Code code={`{ "callId": "clx8f2z...", "status": "ENDED" }`} />
            </Endpoint>

            {/* GET call */}
            <Endpoint method="GET" path="/calls/:callId" summary="Get call status" id="api-get">
              <p className="text-[#3D3650] text-sm mb-4 mt-3">Returns the current state of a call.</p>
              <LangTabs tabs={{ sdk: `const call = await bj.getCall('clx8f2z...');`, curl: `curl ${PURPLECALLIO_API_URL}/calls/CALL_ID \\
  -H "x-api-key: $PURPLECALLIO_API_KEY"` }} />
              <Code code={`{
  "callId": "clx8f2z...",
  "status": "ACCEPTED",
  "type": "VIDEO",
  "callerId": "user_alice",
  "receiverId": "user_bob",
  "startedAt": "2026-08-01T10:00:15.000Z",
  "endedAt": null,
  "createdAt": "2026-08-01T10:00:00.000Z"
}`} />
              <div className="flex flex-wrap gap-2 mt-3">
                {[{ s: 'RINGING', c: '#F59E0B' }, { s: 'ACCEPTED', c: '#10B981' }, { s: 'ENDED', c: '#64748B' }, { s: 'REJECTED', c: '#EF4444' }, { s: 'MISSED', c: '#EF4444' }].map(({ s, c }) => (
                  <span key={s} className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: `${c}22`, color: c, border: `1px solid ${c}44` }}>{s}</span>
                ))}
              </div>
            </Endpoint>
          </Section>

          {/* ── WebSocket ─────────────────────────────── */}
          <Section id="websocket">
            <Heading>WebSocket Events</Heading>
            <p className="text-[#3D3650] text-sm mb-5">The hosted call UI connects automatically. Build a custom client? Here's the full reference.</p>

            <Code label="connect" code={`import { io } from 'socket.io-client';

const socket = io('${PURPLECALLIO_SIGNAL_URL}', {
  auth: { token: 'bj_session_...' },
  transports: ['websocket'],
});

socket.on('connect', () => {
  socket.emit('authenticate', { token: 'bj_session_...' });
});`} />

            <p className="text-sm font-semibold text-[#170B2E] mb-3 mt-6">Connection</p>
            <div className="space-y-3 mb-5">
              {[
                { event: 'connected', dir: '→ client', color: '#10B981', desc: 'Authenticated and joined the meeting. Carries your participant id.', payload: `{ participantId: 'user_alice' }` },
                { event: 'disconnected', dir: '→ client', color: '#EF4444', desc: 'Socket dropped.', payload: `{}` },
                { event: 'reconnected', dir: '→ client', color: '#F59E0B', desc: 'Socket re-established.', payload: `{}` },
              ].map((ev) => (
                <div key={ev.event} className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
                  <div className="flex items-center gap-3 mb-2">
                    <code className="font-mono text-xs font-bold" style={{ color: ev.color }}>{ev.event}</code>
                    <span className="text-xs text-[#3D3650] font-mono">{ev.dir}</span>
                  </div>
                  <p className="text-xs text-[#3D3650] mb-2">{ev.desc}</p>
                  <code className="font-mono text-xs text-[#3D3650]">{ev.payload}</code>
                </div>
              ))}
            </div>

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Call + participant events</p>
            <div className="space-y-3 mb-5">
              {[
                { event: 'call.started', dir: '→ both', color: '#10B981', desc: 'Call became active.', payload: `{ callId: 'clx8f2z...' }` },
                { event: 'call.ended', dir: '→ both', color: '#EF4444', desc: 'Call ended by either side.', payload: `{ callId: 'clx8f2z...' }` },
                { event: 'participant.joined', dir: '→ others', color: '#7F40E8', desc: 'A participant joined the room.', payload: `{ participantId: 'user_bob' }` },
                { event: 'participant.left', dir: '→ others', color: '#F59E0B', desc: 'A participant left the room.', payload: `{ participantId: 'user_bob' }` },
                { event: 'participant.updated', dir: '→ others', color: '#A05DF9', desc: 'Participant media state changed.', payload: `{ participantId: 'user_bob', camera: false, microphone: true }` },
                { event: 'incoming-call', dir: '→ receiver', color: '#7F40E8', desc: 'Legacy alias — caller is waiting.', payload: `{ callId, callerId, type: 'VIDEO' }` },
              ].map((ev) => (
                <div key={ev.event} className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
                  <div className="flex items-center gap-3 mb-2">
                    <code className="font-mono text-xs font-bold" style={{ color: ev.color }}>{ev.event}</code>
                    <span className="text-xs text-[#3D3650] font-mono">{ev.dir}</span>
                  </div>
                  <p className="text-xs text-[#3D3650] mb-2">{ev.desc}</p>
                  <code className="font-mono text-xs text-[#3D3650]">{ev.payload}</code>
                </div>
              ))}
            </div>

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Media events</p>
            <div className="space-y-3 mb-5">
              {[
                { event: 'camera.enabled / camera.disabled', dir: '→ others', color: '#A05DF9', desc: 'Camera toggled.', payload: `{ callId }` },
                { event: 'microphone.enabled / microphone.disabled', dir: '→ others', color: '#A05DF9', desc: 'Microphone toggled.', payload: `{ callId }` },
                { event: 'screenShare.started / screenShare.stopped', dir: '→ others', color: '#A05DF9', desc: 'Screen share toggled.', payload: `{ callId }` },
              ].map((ev) => (
                <div key={ev.event} className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
                  <div className="flex items-center gap-3 mb-2">
                    <code className="font-mono text-xs font-bold" style={{ color: ev.color }}>{ev.event}</code>
                    <span className="text-xs text-[#3D3650] font-mono">{ev.dir}</span>
                  </div>
                  <p className="text-xs text-[#3D3650] mb-2">{ev.desc}</p>
                  <code className="font-mono text-xs text-[#3D3650]">{ev.payload}</code>
                </div>
              ))}
            </div>

            <p className="text-sm font-semibold text-[#170B2E] mb-3">WebRTC signaling</p>
            <div className="space-y-3">
              {[
                { event: 'offer / answer / ice-candidate', dir: '↔ both', color: '#A05DF9', desc: 'WebRTC signaling events relayed by the server.', payload: `{ callId, offer? / answer? / candidate? }` },
              ].map((ev) => (
                <div key={ev.event} className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
                  <div className="flex items-center gap-3 mb-2">
                    <code className="font-mono text-xs font-bold" style={{ color: ev.color }}>{ev.event}</code>
                    <span className="text-xs text-[#3D3650] font-mono">{ev.dir}</span>
                  </div>
                  <p className="text-xs text-[#3D3650] mb-2">{ev.desc}</p>
                  <code className="font-mono text-xs text-[#3D3650]">{ev.payload}</code>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Webhooks ──────────────────────────────── */}
          <Section id="webhooks">
            <Heading>Webhooks</Heading>
            <p className="text-[#3D3650] text-sm mb-5">PurpleCallio POSTs a signed event to your server on every call lifecycle change.</p>

            {/* Setup */}
            <div className="rounded-xl border border-[#E7DFF5] p-5 mb-5" style={{ background: '#FFFFFF' }}>
              <p className="text-xs font-semibold text-[#170B2E] mb-3">Setup — Dashboard</p>
              <div className="flex items-center gap-3 flex-wrap text-xs text-[#3D3650]">
                <span className="px-3 py-1 rounded-lg border border-[#D6C4EE]" style={{ background: '#F8F4FD' }}>Open project</span>
                <span className="text-[#3D3650]">→</span>
                <span className="px-3 py-1 rounded-lg border border-[#D6C4EE]" style={{ background: '#F8F4FD' }}>Webhook section</span>
                <span className="text-[#3D3650]">→</span>
                <span className="px-3 py-1 rounded-lg border border-[#D6C4EE]" style={{ background: '#F8F4FD' }}>Paste your URL</span>
                <span className="text-[#3D3650]">→</span>
                <span className="px-3 py-1 rounded-lg border border-[#D6C4EE] text-green-700" style={{ background: '#F8F4FD' }}>Secret auto-generated</span>
              </div>
            </div>

            {/* Events */}
            <div className="grid grid-cols-2 gap-2 mb-5">
              {['call.created', 'call.accepted', 'call.rejected', 'call.ended'].map((ev) => (
                <div key={ev} className="rounded-lg border border-[#E7DFF5] px-3 py-2 font-mono text-xs" style={{ background: '#F3ECFB', color: '#6425C4' }}>{ev}</div>
              ))}
            </div>

            {/* Verify */}
            <p className="text-sm font-semibold text-[#170B2E] mb-3">Verify the signature</p>
            <Tip type="warn">
              Always verify the <code className="font-mono text-xs bg-black/30 px-1 rounded">X-PurpleCallio-Signature</code> header before processing. Use <code className="font-mono text-xs bg-black/30 px-1 rounded">express.raw()</code> — do not parse JSON first.
            </Tip>
            <LangTabs tabs={{
              node: `import crypto from 'crypto';
import express from 'express';

app.post('/webhooks/purplecallio',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const sig      = req.headers['x-purplecallio-signature'];
    const expected = 'sha256=' + crypto
      .createHmac('sha256', process.env.PURPLECALLIO_WEBHOOK_SECRET)
      .update(req.body)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(401).send('invalid signature');
    }

    const event = JSON.parse(req.body);
    // event.event → 'call.created' | 'call.accepted' | ...
    res.json({ ok: true });
  }
);`,
              python: `import hmac, hashlib, os
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()
SECRET = os.environ['PURPLECALLIO_WEBHOOK_SECRET'].encode()

@app.post('/webhooks/purplecallio')
async def webhook(request: Request):
    body = await request.body()
    sig  = request.headers.get('x-purplecallio-signature', '')
    expected = 'sha256=' + hmac.new(SECRET, body, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(sig, expected):
        raise HTTPException(status_code=401, detail='invalid signature')

    event = await request.json()
    return {'ok': True}`,
            }} />
          </Section>

          {/* ── Examples ─────────────────────────────── */}
          <Section id="examples">
            <Heading>Examples</Heading>

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Hosted UI — create & redirect (Node.js)</p>
            <Code code={`import PurpleCallio from '@purplecallio/sdk';

const bj = new PurpleCallio({
  apiKey: process.env.PURPLECALLIO_API_KEY,
  apiUrl: '${PURPLECALLIO_API_URL}',
});

// 1. Create a call from your backend
const { callId, hostedUrl, participants } = await bj.createCall({
  callerId: 'user_alice',
  receiverId: 'user_bob',
  type: 'VIDEO',
});

// 2. Redirect each participant to their hosted page
//    participants[0].hostedUrl  → Alice
//    participants[1].hostedUrl  → Bob
res.redirect(participants[0].hostedUrl);`} label="your-server.js" />

            <p className="text-sm font-semibold text-[#170B2E] mb-3 mt-6">React Components</p>
            <Code code={`import { MeetingProvider, MeetingRoom, ParticipantGrid, CameraButton, MicrophoneButton, ScreenShareButton, LeaveButton, DeviceSelector } from '@purplecallio/react';

export function CustomCall({ token, callId, signalUrl }) {
  return (
    <MeetingProvider token={token} callId={callId} signalUrl={signalUrl}>
      <MeetingRoom>
        <ParticipantGrid />
      </MeetingRoom>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: 16 }}>
        <CameraButton />
        <MicrophoneButton />
        <ScreenShareButton />
        <DeviceSelector />
        <LeaveButton />
      </div>
    </MeetingProvider>
  );
}`} />

            <p className="text-sm font-semibold text-[#170B2E] mb-3 mt-6">Headless SDK</p>
            <Code code={`import { PurpleCallioMeeting } from '@purplecallio/sdk';

const meeting = new PurpleCallioMeeting({ token, callId, signalUrl });

meeting.on('remote.stream', (stream) => {
  document.getElementById('remote-video').srcObject = stream;
});

await meeting.join();
meeting.camera.enable();
meeting.microphone.enable();`} />
          </Section>

          {/* ── Native SDK previews ──────────────────── */}
          <Section id="native-sdk-previews">
            <Heading>Native SDK previews</Heading>
            <p className="text-[#3D3650] text-sm mb-5">
              Native Flutter, Swift, and Kotlin implementations are available
              in the repository for evaluation. They are not released for
              production while platform builds and physical-device validation
              remain outstanding.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Flutter", "/docs/flutter"],
                ["iOS", "/docs/ios"],
                ["Android", "/docs/android"],
              ].map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-xl border border-[#E7DFF5] p-4 text-sm font-semibold text-[#6425C4] hover:border-[#A05DF9]"
                >
                  {label} implementation status →
                </Link>
              ))}
            </div>
          </Section>

          {/* ── Errors ───────────────────────────────── */}
          <Section id="errors">
            <Heading>Error Codes</Heading>
            <div className="rounded-xl border border-[#E7DFF5] overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr style={{ background: '#FFFFFF' }}><th className="text-left px-4 py-2.5 text-[#3D3650] font-mono font-normal">status</th><th className="text-left px-4 py-2.5 text-[#3D3650] font-mono font-normal">meaning</th><th className="text-left px-4 py-2.5 text-[#3D3650] font-mono font-normal">fix</th></tr></thead>
                <tbody>
                  {[
                    { code: '400', label: 'Bad Request', fix: 'Check request body — missing required field.' },
                    { code: '401', label: 'Unauthorized', fix: 'API key or session token is missing, invalid, or expired.' },
                    { code: '403', label: 'Forbidden', fix: 'You do not own this resource.' },
                    { code: '404', label: 'Not Found', fix: 'callId does not exist or belongs to another project.' },
                    { code: '409', label: 'Conflict', fix: 'Call is already ENDED or REJECTED.' },
                    { code: '429', label: 'Rate Limited', fix: 'Slow down — too many requests per second.' },
                    { code: '500', label: 'Server Error', fix: 'Temporary. Retry with backoff. Contact support if persistent.' },
                  ].map((row, i) => {
                    const c = Number(row.code) >= 500 ? '#DC2626' : Number(row.code) >= 400 ? '#B45309' : '#6425C4';
                    return (
                      <tr key={row.code} className="border-t border-[#E7DFF5]" style={{ background: i % 2 === 0 ? '#FFFFFF' : '#FBF8FE' }}>
                        <td className="px-4 py-2.5 font-mono font-bold" style={{ color: c }}>{row.code}</td>
                        <td className="px-4 py-2.5 text-[#170B2E]">{row.label}</td>
                        <td className="px-4 py-2.5 text-[#3D3650]">{row.fix}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

{/* ── Usage & Billing ─────────────────────────── */}
          <Section id="usage-billing">
            <Heading>Usage & Billing</Heading>
            <p className="text-[#3D3650] text-sm mb-5">
              PurpleCallio is pay-as-you-go. There are no subscriptions and no
              up-front fees — you pay a simple per-participant-minute rate only
              for usage beyond the monthly free allowance.
            </p>

{/* Free tier + rates */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              {[
                { media: 'Audio', rate: audio, note: freeAudio === undefined ? 'Current allowance loading' : `First ${freeAudio} audio min/month free` },
                { media: 'Video', rate: video, note: freeVideo === undefined ? 'Current allowance loading' : `First ${freeVideo} video min/month free` },
                { media: 'Screen share', rate: screen, note: 'Separate usage category; no free allowance' },
              ].map((r) => (
                <div key={r.media} className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
                  <p className="text-xs text-[#3D3650]">{r.media}</p>
                  <p className="text-2xl font-bold text-[#170B2E] mt-1">{r.rate}</p>
                  <p className="text-[11px] text-[#3D3650] mt-1">/ participant-minute</p>
                  <p className="text-[11px] text-[#3D3650] mt-2">{r.note}</p>
                </div>
              ))}
            </div>

            <p className="text-sm font-semibold text-[#170B2E] mb-3">How billing works</p>
            <div className="space-y-3 mb-6">
              {[
                { t: 'Start free', d: freeAudio === undefined || freeVideo === undefined ? 'Current free allowances are loaded from the billing service.' : `Every account gets ${freeAudio} audio + ${freeVideo} video minutes/month at no cost. No card required to begin.` },
                { t: 'Add a payment method', d: 'In the dashboard, add a card only when you go to production. You are only charged for minutes beyond the free tier.' },
                { t: 'Monthly invoice', d: rates ? `At the end of each month we generate an invoice for billable usage and auto-charge your saved card. GST of ${rates.taxPercent}% applies on billable usage.` : 'Current tax information is loaded from the billing service.' },
                { t: 'Failed payment', d: 'We retry and enter a 7-day grace period. Active calls are never interrupted, but new calls are blocked until payment succeeds.' },
              ].map((s) => (
                <div key={s.t} className="flex gap-3 rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
                  <span className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center font-mono text-xs font-bold" style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.2), rgba(65,6,134,0.2))', color: '#6425C4', border: '1px solid rgba(127,64,232,0.25)' }}>✓</span>
                  <div>
                    <p className="text-sm font-semibold text-[#170B2E]">{s.t}</p>
                    <p className="text-xs text-[#3D3650] mt-0.5">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>

            <Tip type="info">
              Screen sharing is a separately tracked, billable usage category with no free allowance. Everything else —
              Hosted UI, React Components, Headless SDK, REST API, signaling, and the
              dashboard — is included on the free tier.
            </Tip>
          </Section>

          {/* ── FAQ ───────────────────────────────────── */}
          <Section id="faq">
            <Heading>❓ FAQ</Heading>
            <div className="space-y-3">
              {[
                { q: 'Which integration should I pick?', a: 'Hosted UI for the fastest path (5 minutes). React Components for a branded custom interface without building WebRTC. Headless SDK if you need complete control over the UI.' },
                { q: 'Can I switch between the three products later?', a: 'Yes. All three use the same backend, the same POST /calls response, and the same session tokens. Change the frontend, keep your server-side integration.' },
                { q: 'Where do I put the API key?', a: 'Server-side only (bj_live_...). Never send it to the browser. The hosted page uses per-participant session tokens (bj_session_...), not API keys.' },
                { q: 'What about calls behind strict firewalls?', a: 'PurpleCallio provides TURN relay with time-limited credentials. The hosted UI and SDK fetch ICE servers automatically — no configuration needed.' },
                { q: 'Are session tokens single-use?', a: 'Yes. Each token is tied to one participant and one call. Create a new call if you need to re-invite someone.' },
                { q: 'Do you support group calls?', a: 'Currently 1:1 calls. Group calls are on the roadmap.' },
                { q: 'How do I debug a failed call?', a: 'Check the WebSocket connection state, verify the session token matches the correct participant, ensure camera/microphone permissions are granted, and confirm TURN credentials are returned from /turn/credentials.' },
              ].map((item) => (
                <div key={item.q} className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
                  <p className="text-sm font-semibold text-[#170B2E] mb-1">{item.q}</p>
                  <p className="text-sm text-[#3D3650] leading-relaxed">{item.a}</p>
                </div>
              ))}
            </div>

            {/* Final CTA */}
            <div className="mt-12 rounded-xl p-8 text-center border border-[#D6C4EE]" style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.08), rgba(65,6,134,0.05))' }}>
              <p className="font-bold text-[#170B2E] mb-2 text-lg">Still stuck?</p>
              <p className="text-[#3D3650] text-sm mb-6">Try the playground — make a call in your browser with no code, no API key required.</p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link href="/dashboard/playground" className="inline-flex items-center gap-2 text-white font-medium text-sm px-6 py-2.5 rounded-lg transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}>
                  Open playground →
                </Link>
                <Link href="/signup" className="inline-flex items-center gap-2 text-[#3D3650] font-medium text-sm px-6 py-2.5 rounded-lg border border-[#E7DFF5] hover:border-[#D6C4EE] transition-all">
                  Get API key
                </Link>
              </div>
            </div>
          </Section>

          {/* ── Contact Support ───────────────────────── */}
          <Section id="support">
            <Heading>Contact Support</Heading>
            <p className="text-[#3D3650] text-sm mb-5">
              If you experience an issue while integrating PurpleCallio, you can
              contact our support team directly from your dashboard.
            </p>

            <p className="text-sm font-semibold text-[#170B2E] mb-3">Create a support ticket</p>
            <div className="space-y-3 mb-6">
              {[
                <>Open <strong>Support</strong> from your dashboard.</>,
                <>Click <strong>Create Ticket</strong>.</>,
                <>Enter a short subject describing the issue.</>,
                <>Describe the problem and include any relevant error message.</>,
                <>Optionally select the related documentation.</>,
                <>Click <strong>Create Ticket</strong> to submit it.</>,
              ].map((step, i) => (
                <div key={i} className="flex gap-3 rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
                  <span className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center font-mono text-xs font-bold" style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.2), rgba(65,6,134,0.2))', color: '#6425C4', border: '1px solid rgba(127,64,232,0.25)' }}>{i + 1}</span>
                  <p className="text-sm text-[#3D3650]">{step}</p>
                </div>
              ))}
            </div>

            <p className="text-[#3D3650] text-sm mb-2">
              Our team will review the request and respond directly through the ticket.
            </p>
            <p className="text-[#3D3650] text-sm mb-5">
              You can view the response and continue the conversation from{' '}
              <strong className="text-[#170B2E]">Dashboard → Support</strong>.
            </p>

            <Link href="/dashboard/support/new" className="inline-flex items-center gap-2 text-white font-medium text-sm px-6 py-2.5 rounded-lg transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}>
              Contact Support
            </Link>
          </Section>

        </main>
      </div>
    </div>
  );
}
