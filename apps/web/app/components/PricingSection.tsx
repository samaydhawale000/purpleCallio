'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Building2, CreditCard, Mic, Monitor, Video, CircleCheck } from 'lucide-react';
import { api } from '../lib/api';

interface BillingRates {
  audioPaise: number;
  videoPaise: number;
  screenSharePaise: number;
  freeAudioMins: number;
  freeVideoMins: number;
  taxPercent: number;
}

const paiseToINR = (p: number) => `₹${((p ?? 0) / 100).toFixed(2)}`;

const FREE_TIER = [
  'Unlimited projects & developers',
  'Hosted Meeting UI',
  'React UI Components',
  'Headless SDK',
  'REST API + WebSocket Signaling',
  'Device selection & screen sharing',
  'Developer Dashboard',
  'API Playground & documentation',
];

const EVERY_PLAN_INCLUDES = [
  'Hosted Meeting UI',
  'React UI Components',
  'Headless SDK',
  'REST API',
  'WebSocket Signaling',
  'Authentication',
  'Video Calling',
  'Audio Calling',
  'Screen Sharing',
  'Device Selection',
  'API Playground',
  'Documentation',
  'Dashboard',
  'Per-project API Keys',
  'Webhook Events',
  'TURN Relay',
];

const ENTERPRISE_FEATURES = [
  'Volume-based pricing',
  'Custom usage rates',
  'Higher concurrency requirements',
  'Dedicated TURN infrastructure',
  'Custom SLA & support',
  'Priority engineering support',
  'Custom integrations & migration',
  'Private deployment options (where supported)',
  'White-label / custom branding',
  'Dedicated account manager',
];

export default function PricingSection() {
  const [rates, setRates] = useState<BillingRates | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get('/billing/rates')
      .then((res) => {
        if (active) setRates(res.data);
      })
      .catch(() => {
        /* fall back to defaults */
      });
    return () => {
      active = false;
    };
  }, []);

  const audio = rates ? paiseToINR(rates.audioPaise) : 'Loading…';
  const video = rates ? paiseToINR(rates.videoPaise) : 'Loading…';
  const screen = rates ? paiseToINR(rates.screenSharePaise) : 'Loading…';
  const freeAudio = rates?.freeAudioMins;
  const freeVideo = rates?.freeVideoMins;
  const gst = rates?.taxPercent;

  const RATES = [
    {
      media: 'Audio',
      icon: Mic,
      price: audio,
      unit: '/ participant-minute',
      note: freeAudio === undefined ? 'Loading current allowance…' : `Free tier: first ${freeAudio} audio min/month included.`,
    },
    {
      media: 'Video',
      icon: Video,
      price: video,
      unit: '/ participant-minute',
      note: freeVideo === undefined ? 'Loading current allowance…' : `Free tier: first ${freeVideo} video min/month included.`,
      highlight: true,
    },
    {
      media: 'Screen Share',
      icon: Monitor,
      price: screen,
      unit: '/ participant-minute',
      note: 'A separate usage category. No free allowance.',
    },
  ];

  const freeTierItems = [
    freeAudio === undefined ? 'Current audio allowance loading' : `${freeAudio} audio participant-minutes / month`,
    freeVideo === undefined ? 'Current video allowance loading' : `${freeVideo} video participant-minutes / month`,
    ...FREE_TIER,
  ];

  return (
    <>
      {/* ── Pricing ── */}
      <section id="pricing" className="section-base py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <p className="section-label font-mono text-xs tracking-widest uppercase mb-4">
            Pricing
          </p>
          <h2 className="lp-h2 font-bold text-[#170B2E] mb-4">
            Start free. Pay only for what you use.
          </h2>
          <p className="text-[#3D3650] mb-14 max-w-2xl">
            Audio, video, and screen sharing are tracked as separate participant-minute
            categories. Current rates and allowances are loaded from PurpleCallio's billing service.
          </p>

          {/* Free tier + rates */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-stretch mb-5">
            {/* Free tier */}
            <div
              className="lg:col-span-2 relative rounded-xl border border-[#D6C4EE] p-7 flex flex-col"
              style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.08), rgba(65,6,134,0.05))' }}
            >
              <div className="badge-gradient absolute -top-3 left-6 text-xs font-mono px-3 py-0.5 rounded-full text-white whitespace-nowrap">
                Free tier
              </div>
              <div className="flex items-center gap-2 mb-1">
                <CircleCheck size={18} className="text-emerald-600" />
                <p className="font-semibold text-[#170B2E]">Start Free</p>
              </div>
              <p className="text-[#3D3650] text-xs mb-4 leading-relaxed">
                Build, test and prototype free. Add a card only when you go to production.
              </p>
              <div className="mb-5 rounded-lg p-4" style={{ background: 'rgba(127,64,232,0.05)', border: '1px solid #E7DFF5' }}>
                <span className="price-text font-bold text-[#170B2E]">₹0</span>
                <span className="text-[#3D3650] text-xs ml-1">/ month</span>
                <p className="text-xs text-[#3D3650] mt-2">
                  Every paid plan starts free. No credit card required to begin.
                </p>
              </div>
              <div className="space-y-2 flex-1">
                {freeTierItems.map((f) => (
                  <div key={f} className="flex items-start gap-2">
                    <span className="check-indigo text-xs mt-0.5">✓</span>
                    <p className="text-sm text-[#3D3650]">{f}</p>
                  </div>
                ))}
              </div>
              <Link href="/signup" className="btn-primary block text-center text-sm font-medium text-white px-4 py-2.5 rounded-lg transition-all hover:opacity-90 mt-6">
                Start Free →
              </Link>
            </div>

            {/* Rates */}
            <div className="lg:col-span-3 flex flex-col gap-4">
              <div className="rounded-xl border border-[#E7DFF5] p-6 flex flex-col" style={{ background: '#FFFFFF' }}>
                <p className="font-semibold text-[#170B2E] mb-1">Pay only for what you use</p>
                <p className="text-xs text-[#3D3650] mb-5">
                  No subscriptions. No up-front fees. Billed per participant-minute at the end of each month.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                  {RATES.map((r) => (
                    <div
                      key={r.media}
                      className="rounded-xl border p-4 text-center"
                      style={{
                        background: r.highlight ? 'linear-gradient(135deg, rgba(127,64,232,0.12), rgba(65,6,134,0.08))' : '#F8F4FD',
                        borderColor: r.highlight ? '#D6C4EE' : '#E7DFF5',
                      }}
                    >
                      <div className="mb-2 flex justify-center text-[#7F40E8]"><r.icon size={22} /></div>
                      <p className="text-xs text-[#3D3650]">{r.media}</p>
                      <p className="price-text font-bold text-[#170B2E] text-xl mt-1">{r.price}</p>
                      <p className="text-[10px] text-[#3D3650]">{r.unit}</p>
                      <p className="text-[11px] text-[#3D3650] mt-2 leading-relaxed">{r.note}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[#3D3650] leading-relaxed px-1">
                  <CreditCard size={14} className="mr-1 inline-block align-text-bottom" /> Add a payment method in the dashboard — you'll only be charged for minutes beyond the
                  free allowance. GST of {gst}% applies on billable usage.
                </p>
              </div>

              {/* Enterprise & High Volume */}
              <div className="rounded-xl border border-[#D6C4EE] p-6 flex flex-col sm:flex-row sm:items-center gap-6" style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.06), rgba(65,6,134,0.03))' }}>
                <div className="sm:w-2/5">
                  <div className="flex items-center gap-2 mb-1">
                    <Building2 size={22} className="text-[#7F40E8]" />
                    <p className="font-bold text-[#170B2E] text-lg">Enterprise &amp; High Volume</p>
                  </div>
                  <p className="text-[#3D3650] text-sm mb-3 leading-relaxed">
                    Built for organizations with large-scale communication needs. Running high call
                    volumes or integrating PurpleCallio deeply into your product? Talk to our team
                    about volume-based pricing tailored to your usage, dedicated infrastructure, and
                    enterprise support.
                  </p>
                  <a href="mailto:purplecallio@gmail.com" className="inline-block text-center text-sm font-medium text-[#170B2E] px-5 py-2.5 rounded-lg border border-[#D6C4EE] hover:border-[#7F40E8] transition-all">
                    Talk to Sales →
                  </a>
                </div>
                <div className="sm:w-3/5 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2">
                  {ENTERPRISE_FEATURES.map((f) => (
                    <div key={f} className="flex items-start gap-2">
                      <span className="check-indigo text-xs mt-0.5">✓</span>
                      <p className="text-sm text-[#3D3650]">{f}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Every plan includes */}
          <div
            className="rounded-xl border border-[#E7DFF5] mt-14 p-8"
            style={{ background: '#FFFFFF' }}
          >
            <p className="text-center font-bold text-[#170B2E] text-lg mb-2">
              Every account includes
            </p>
            <p className="text-center text-sm text-[#3D3650] mb-8">
              The complete platform — same features on the free tier and pay-as-you-go. You only pay for minutes beyond the free allowance.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {EVERY_PLAN_INCLUDES.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2.5 rounded-lg px-4 py-3"
                  style={{ background: '#F8F4FD', border: '1px solid #E7DFF5' }}
                >
                  <span className="check-indigo text-sm mt-0.5">✓</span>
                  <p className="text-sm text-[#3D3650]">{item}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Pricing FAQ CTA */}
          <div
            className="mt-12 rounded-xl border border-[#E7DFF5] p-8 text-center"
            style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.06), rgba(65,6,134,0.03))' }}
          >
            <p className="font-bold text-[#170B2E] text-lg mb-2">
              Questions about pricing?
            </p>
            <p className="text-sm text-[#3D3650] mb-6 max-w-xl mx-auto">
              We've answered the most common questions about the free tier,
              metered rates, payment methods, and monthly invoices. If you
              still need help, our engineers are one email away.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="/faq#pricing"
                className="inline-flex items-center gap-2 text-white font-medium text-sm px-6 py-2.5 rounded-lg transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}
              >
                View pricing FAQ →
              </Link>
              <a
                href="mailto:purplecallio@gmail.com"
                className="inline-flex items-center gap-2 text-[#3D3650] font-medium text-sm px-6 py-2.5 rounded-lg border border-[#E7DFF5] hover:border-[#D6C4EE] transition-all"
              >
                Talk to an engineer
              </a>
            </div>
          </div>

          <p className="text-center text-xs text-[#3D3650] mt-10">
            All rates in INR. Audio, video, and screen sharing are billed as separate
            participant-minute categories. GST of {gst}% applies on billable usage.
          </p>
        </div>
      </section>
    </>
  );
}
