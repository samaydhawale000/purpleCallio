'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { PricingAuthority } from '../components/PricingAuthority';

const FAQ_GROUPS = [
  {
    group: 'Products & Integration',
    items: [
      {
        q: 'How do I integrate video calling using PurpleCallio?',
        a: 'Create a call from your backend with the REST API or @purplecallio/sdk, then join from the browser with @purplecallio/react components, the headless JavaScript SDK, or hosted UI. See the quickstart and video docs at purplecallio.com/docs/quickstart and purplecallio.com/docs/video.',
      },
      {
        q: 'How do I integrate audio calling using PurpleCallio?',
        a: 'Create a call from your backend with the REST API or @purplecallio/sdk, then join from the browser with @purplecallio/react, the headless SDK, or hosted UI. See purplecallio.com/docs/audio for a full walkthrough.',
      },
      {
        q: 'Which integration should I pick?',
        a: 'Hosted UI is the fastest path (5 minutes — just create a call and redirect your users). React Components let you build a branded custom interface without implementing WebRTC. Headless SDK gives you complete control over the UI while PurpleCallio handles signaling, authentication, and media infrastructure.',
      },
      {
        q: 'Can I switch between the three products later?',
        a: 'Yes. All three products are powered by the same backend, the same POST /calls response, and the same per-participant session tokens. You can change your frontend integration without changing your server-side code.',
      },
      {
        q: 'What is the difference between @purplecallio/sdk and @purplecallio/react?',
        a: '@purplecallio/sdk is the headless communication engine (join, leave, camera, microphone, screen share, events). @purplecallio/react is a component library built on top of the core SDK — it provides ready-made React components (MeetingProvider, ParticipantGrid, ControlBar, etc.) that call into the engine for you.',
      },
      {
        q: 'Do you support group calls?',
        a: 'Currently PurpleCallio supports 1:1 audio and video calls. Group calls are on the roadmap.',
      },
    ],
  },
  {
    group: 'Authentication & Security',
    items: [
      {
        q: 'Where do I put the API key?',
        a: 'Server-side only. Your API key (starts with bj_live_) is used by your backend to create calls. Never send it to the browser. The hosted page uses per-participant session tokens (starts with bj_session_) which are cryptographically tied to one participant and one call.',
      },
      {
        q: 'What authentication methods are supported?',
        a: 'PurpleCallio supports two server-side authentication methods: API Keys (x-api-key header, ideal for backend integration) and JWT (for the dashboard and playground). Call participants authenticate with short-lived session tokens over WebSocket.',
      },
      {
        q: 'Are session tokens single-use?',
        a: 'Yes. Each session token is tied to one participant and one call, and expires after 24 hours. If someone needs a new invite, create a new call.',
      },
      {
        q: 'Are webhooks signed?',
        a: 'Yes. Every webhook POST includes an X-PurpleCallio-Signature header (HMAC-SHA256 with your project secret). Always verify it before processing the payload.',
      },
    ],
  },
  {
    group: 'Media & Network',
    items: [
      {
        q: 'What about calls behind strict firewalls?',
        a: 'PurpleCallio provides TURN relay with time-limited HMAC credentials. The hosted UI and SDK fetch ICE servers automatically — no configuration needed on your side.',
      },
      {
        q: 'What browsers are supported?',
        a: 'PurpleCallio uses standard WebRTC, so any modern browser works — Chrome, Firefox, Safari, Edge. Mobile browsers are fully supported with responsive layouts.',
      },
      {
        q: 'Can my users select which camera and microphone to use?',
        a: 'Yes. The hosted UI includes a DeviceSelector, and the React SDK exposes useDevices() plus a DeviceSelector component. Developers on the Headless SDK can manage devices programmatically.',
      },
      {
        q: 'Is screen sharing supported?',
        a: 'Yes — screen sharing works in all three products. The hosted UI has a built-in Share Screen control, React has a ScreenShareButton, and the SDK exposes screenShare.start() / screenShare.stop().',
      },
    ],
  },
{
    group: 'Development & Support',
    items: [
      {
        q: 'How do I debug a failed call?',
        a: 'Check the WebSocket connection state, verify the session token matches the correct participant, ensure camera/microphone permissions are granted, and confirm TURN credentials are returned from /turn/credentials. The docs FAQ covers common failure modes.',
      },
      {
        q: 'Where can I test before integrating?',
        a: 'Try the Live Playground — create a call, open two browser tabs, and start a video call with no code and no API key required.',
      },
      {
        q: 'Who do I talk to for support?',
        a: 'PurpleCallio support is run by the engineers who built the platform. Email purplecallio@gmail.com and you will get a technical answer.',
      },
    ],
  },
];


const FAQ_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ_GROUPS.flatMap((group) => group.items).map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
};

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-xl border border-[#E7DFF5] overflow-hidden transition-all"
      style={{ background: open ? '#F3ECFB' : '#FFFFFF' }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-white/[0.02] transition-all"
      >
        <span className="text-sm font-semibold text-[#170B2E]">{q}</span>
        <span
          className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-xs text-[#3D3650] transition-all"
          style={{ background: open ? 'rgba(127,64,232,0.12)' : '#F3ECFB', color: open ? '#6425C4' : '#3D3650' }}
        >
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-[#E7DFF5]">
          <p className="text-sm text-[#3D3650] leading-relaxed pt-4">{a}</p>
        </div>
      )}
    </div>
  );
}

export default function FaqPage() {
  const [rates, setRates] = useState<{
    audioPaise: number;
    videoPaise: number;
    screenSharePaise: number;
    freeAudioMins: number;
    freeVideoMins: number;
    taxPercent: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get('/billing/rates')
      .then((res) => { if (active) setRates(res.data); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const paiseToINR = (p: number) => `₹${((p ?? 0) / 100).toFixed(2)}`;
  const freeAudio = rates?.freeAudioMins;
  const freeVideo = rates?.freeVideoMins;
  const gst = rates?.taxPercent;
  const audioRate = rates ? paiseToINR(rates.audioPaise) : null;
  const videoRate = rates ? paiseToINR(rates.videoPaise) : null;
  const screenRate = rates ? paiseToINR(rates.screenSharePaise) : null;

  const pricingItems = [
    { q: 'Is there a free tier?', a: freeAudio === undefined || freeVideo === undefined ? 'Current free allowances are loading from the billing service.' : `Yes. You get ${freeAudio} audio and ${freeVideo} video participant-minutes free every month, plus unlimited projects and developers. No credit card is required to start.` },
    { q: 'How does usage-based pricing work?', a: !audioRate || !videoRate || !screenRate ? 'Current rates are loading from the billing service.' : `There are no subscriptions or up-front fees. Audio (${audioRate}/min), video (${videoRate}/min), and screen sharing (${screenRate}/min) are separate participant-minute usage categories. Free allowances apply to audio and video; screen sharing has no free allowance.` },
    { q: 'Is screen sharing billable separately?', a: !screenRate ? 'Current screen-sharing pricing is loading from the billing service.' : `Yes. Screen sharing is tracked as its own usage category at ${screenRate} per participant-minute. It is not automatically added as a surcharge to video minutes and has no free allowance.` },
    { q: 'Do I need to add a payment method to start?', a: 'No. Your free allowance covers development and prototyping. You only add a payment method when you go to production and exceed the free minutes.' },
    { q: 'When and how am I charged?', a: gst === undefined ? 'Current tax information is loading from the billing service.' : `At the end of each billing cycle (monthly, anchored to the date you started your plan) we generate an invoice for your billable usage and charge your saved card automatically. A GST of ${gst}% applies on billable usage.` },
    { q: 'What happens if a payment fails?', a: 'We retry, notify you, and enter a 7-day grace period. During grace you can keep existing calls, but you cannot start new ones until the payment succeeds. Active calls are never interrupted.' },
    { q: 'Can I see my usage and invoices?', a: 'Yes. The dashboard Usage page shows per-type minutes and estimated month-end cost, and the Billing page lists your payment methods and past invoices.' },
    { q: 'Is every feature included on the free tier?', a: 'Yes. Hosted UI, React Components, Headless SDK, REST API, WebSocket signaling, and the developer dashboard are all available. You only pay for minutes beyond the free allowance.' },
  ];

  return (
    <div style={{ background: '#FFFFFF', color: '#170B2E', minHeight: '100vh' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_SCHEMA).replace(/</g, '\\u003c') }} />

      {/* Hero */}
      <div className="max-w-4xl mx-auto px-6 pt-28 pb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono mb-4 border" style={{ background: 'rgba(127,64,232,0.08)', borderColor: 'rgba(127,64,232,0.25)', color: '#6425C4' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#7F40E8] animate-pulse" />
          Frequently asked questions
        </div>
        <h1 className="font-bold text-[#170B2E] mb-3" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', letterSpacing: '-0.03em' }}>
          Everything you need to know
        </h1>
        <p className="text-[#3D3650] text-base leading-relaxed max-w-2xl">
          Can't find what you're looking for? Email{' '}
          <a href="mailto:purplecallio@gmail.com" className="text-[#6425C4] hover:underline">purplecallio@gmail.com</a>{' '}
          and an engineer will get back to you.
        </p>
      </div>

      {/* FAQ groups */}
      <div className="max-w-4xl mx-auto px-6 pb-24">
<div className="flex flex-col gap-12">
{FAQ_GROUPS.map((g) => (
            <div key={g.group}>
              <h2 className="font-semibold text-[#170B2E] mb-4" style={{ fontSize: '1.1rem' }}>
                <span className="gradient-text font-mono text-xs tracking-widest uppercase mr-3">{g.group}</span>
              </h2>
              <div className="flex flex-col gap-3">
                {g.items.map((item) => (
                  <FaqItem key={item.q} q={item.q} a={item.a} />
                ))}
              </div>
            </div>
          ))}

          {/* Pricing & Billing (dynamic rates) */}
          <div id="pricing" className="scroll-mt-24">
            <h2 className="font-semibold text-[#170B2E] mb-4" style={{ fontSize: '1.1rem' }}>
              <span className="gradient-text font-mono text-xs tracking-widest uppercase mr-3">Pricing &amp; Billing</span>
            </h2>
            <div className="flex flex-col gap-3">
              <PricingAuthority />
              {pricingItems.map((item) => (
                <FaqItem key={item.q} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-xl p-8 text-center border border-[#D6C4EE]" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.05))' }}>
          <p className="font-bold text-[#170B2E] mb-2 text-lg">Still have questions?</p>
          <p className="text-[#3D3650] text-sm mb-6">Try the playground or read the docs — or talk to the engineers who built it.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/dashboard/playground" className="inline-flex items-center gap-2 text-white font-medium text-sm px-6 py-2.5 rounded-lg transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}>
              Open playground →
            </Link>
            <Link href="/signup" className="inline-flex items-center gap-2 text-[#3D3650] font-medium text-sm px-6 py-2.5 rounded-lg border border-[#E7DFF5] hover:border-[#D6C4EE] transition-all">
              Get API key
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
