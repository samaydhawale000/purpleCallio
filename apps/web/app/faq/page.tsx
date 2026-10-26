'use client';

import Link from 'next/link';
import { PURPLECALLIO_HOST } from '../lib/brand';
import { PricingAuthority } from '../components/PricingAuthority';
import { formatRate, usePublicPricing } from '../lib/public-pricing';
import { Reveal } from '../components/motion/Reveal';
import { FaqItem } from '../components/marketing/FaqItem';
import { LIVE_TRANSLATE_FAQ } from '../lib/live-translate';

const FAQ_GROUPS = [
  {
    group: 'Products & Integration',
    items: [
      {
        q: 'How do I integrate video calling using PurpleCallio?',
        a: `Create a call from your backend with the REST API or @purplecallio/sdk, then join from the browser with @purplecallio/react components, the headless JavaScript SDK, or hosted UI. See the quickstart and video docs at ${PURPLECALLIO_HOST}/docs/quickstart and ${PURPLECALLIO_HOST}/docs/video.`,
      },
      {
        q: 'How do I integrate audio calling using PurpleCallio?',
        a: `Create a call from your backend with the REST API or @purplecallio/sdk, then join from the browser with @purplecallio/react, the headless SDK, or hosted UI. See ${PURPLECALLIO_HOST}/docs/audio for a full walkthrough.`,
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
    group: 'Live Translate (early access)',
    items: LIVE_TRANSLATE_FAQ.map(([q, a]) => ({ q, a })),
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


const PRICING_FAQ = [
  { q: 'How do prepaid credits work?', a: 'Add a monetary amount to your PurpleCallio wallet and receive the estimated whole credits at the currently published price. Before payment, checkout shows the estimate, applicable taxes and final payable amount. Credits are added only after payment is confirmed.' },
  { q: 'How is my credit quantity calculated?', a: 'Your purchase amount, before taxes, is divided by the published price per credit and rounded down to whole credits. The checkout quote is authoritative and records the price and policy that apply to that purchase.' },
  { q: 'What is a participant-minute?', a: 'One connected participant for one minute. Two participants in a ten-minute video call use twenty video participant-minutes. Audio, video, and screen sharing each have their own credit rate; screen sharing is its own category, not a surcharge on video.' },
  { q: 'When are credits deducted?', a: 'Eligible calls and AI features deduct credits according to their configured consumption rates. The monetary price you pay for a credit is separate from those feature usage rates.' },
  { q: 'Do purchased credits expire?', a: 'Each credit purchase is a separate lot with the validity shown in its checkout quote. Your wallet shows the balance, transactions and applicable expiry dates; eligible credits are used earliest-expiring first.' },
  { q: 'Where can I see my wallet balance and transactions?', a: 'Open Dashboard → Billing → Credits to review your available balance, purchase history, usage transactions and expiry information.' },
  { q: 'How are taxes calculated?', a: 'Applicable taxes are calculated in the checkout quote and included in the final payable amount before you pay. The current tax rate is shown alongside the purchase summary where applicable.' },
  { q: 'What happens if a payment is pending or fails?', a: 'Credits are not added until the payment provider confirms a successful payment. A pending or failed payment does not create spendable wallet credits.' },
  { q: 'Can I add credits again when my balance is low?', a: 'Yes. Return to your wallet whenever you need additional credits. New calls may require an available balance, while calls already in progress are not cut off.' },
  { q: 'Does PurpleCallio offer Auto Top-Up?', a: 'Yes. Eligible accounts can set a credit threshold, top-up amount and monthly maximum in Dashboard → Billing → Credits, then authorize a Razorpay eMandate. A charge is made only after the mandate is confirmed and your balance reaches the threshold. You can disable Auto Top-Up at any time.' },
  { q: 'Can I get a refund?', a: 'Credit purchases are not refunded automatically. Refunds are issued where required by law, for duplicate or erroneous charges, or at PurpleCallio\'s discretion. See the Refund & Cancellation Policy for details.' },
  { q: 'What about my old pay-as-you-go invoices?', a: 'Usage invoices issued before PurpleCallio moved to prepaid plans remain valid historical records. You can still view and download them as legacy usage invoices from the Billing page.' },
];

const FAQ_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [...FAQ_GROUPS.flatMap((group) => group.items), ...PRICING_FAQ].map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a.replace('{GST}', 'the applicable rate') },
  })),
};

export default function FaqPage() {
  const pricing = usePublicPricing();
  const gst = pricing.status === 'ready' ? `${formatRate(pricing.data.creditRates.taxPercent)}%` : 'the applicable rate';
  return (
    <main style={{ background: '#FFFFFF', color: '#170B2E', minHeight: '100vh' }}>
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
            <Reveal key={g.group} amount={0.1}>
              <h2 className="font-semibold text-[#170B2E] mb-4" style={{ fontSize: '1.1rem' }}>
                <span className="gradient-text font-mono text-xs tracking-widest uppercase mr-3">{g.group}</span>
              </h2>
              <div className="flex flex-col gap-3">
                {g.items.map((item) => (
                  <FaqItem key={item.q} q={item.q} a={item.a} />
                ))}
              </div>
            </Reveal>
          ))}

          {/* Plans & Billing (current plans and credit rates from the API) */}
          <Reveal id="pricing" amount={0.1} className="scroll-mt-24">
            <h2 className="font-semibold text-[#170B2E] mb-4" style={{ fontSize: '1.1rem' }}>
              <span className="gradient-text font-mono text-xs tracking-widest uppercase mr-3">Plans, Credits &amp; Billing</span>
            </h2>
            <div className="flex flex-col gap-3">
              <PricingAuthority />
              {PRICING_FAQ.map((item) => (
                <FaqItem key={item.q} q={item.q} a={item.a.replace('{GST}', gst)} />
              ))}
            </div>
          </Reveal>
        </div>

        {/* CTA */}
        <Reveal variant="zoom-up" duration={0.8}>
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
        </Reveal>
      </div>
    </main>
  );
}
