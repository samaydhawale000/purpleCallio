import Link from "next/link";
import Image from "next/image";
import heroPreview from "./assets/images/hero-preview.webp";
import HeroGlow from "./components/gradient/HeroGlow";
import PricingSection from "./components/PricingSection";
import { JsonLd } from "./components/seo/JsonLd";
import { pageMetadata, siteUrl } from "./lib/seo";
import { PURPLECALLIO_DESCRIPTION, PURPLECALLIO_NAME } from "./lib/brand";
import { CORE_FEATURES } from "./lib/feature-catalog";
import { IntegrationSelector } from "./components/marketing/InteractiveTools";
import {
   ArrowRight,
   Atom,
   Blocks,
   BookOpen,
   Bot,
   BriefcaseBusiness,
   CalendarCheck,
   Check,
   Code2,
   DoorOpen,
   Globe2,
   Headphones,
   KeyRound,
   Monitor,
   MonitorUp,
   Network,
   PackageSearch,
   Palette,
   Radio,
   ShoppingCart,
   SlidersHorizontal,
   Sparkles,
   Stethoscope,
   Target,
   Webhook,
   Wrench,
} from "lucide-react";

const HERO_POINTS = [
   "Video, audio & AI voice agents",
   "TURN relay included",
   "Prepaid credits, no surprise bills",
];

const STACK = ["React", "Next.js", "Vue", "Angular", "Svelte", "React Native", "Node.js", "REST"];

const USE_CASES = [
   {
      icon: Target,
      label: "HR & Recruitment",
      description:
         "Interview candidates inside your hiring platform. No third-party meeting links, no context switching.",
   },
   {
      icon: Stethoscope,
      label: "Telemedicine",
      description:
         "Doctor-patient consultations embedded in a healthcare product, with the product team controlling its own access flow.",
   },
   {
      icon: BriefcaseBusiness,
      label: "CRM & Sales",
      description:
         "Call leads without leaving the CRM. Call records attach to the contact automatically.",
   },
   {
      icon: Headphones,
      label: "Customer Support",
      description:
         "Agents and customers connect inside the support workflow, or an AI agent answers first.",
   },
   {
      icon: BookOpen,
      label: "EdTech",
      description:
         "One-to-one tutoring and coaching sessions built into your learning platform. Students never leave your product.",
   },
   {
      icon: ShoppingCart,
      label: "Marketplace",
      description:
         "Buyers and sellers meet face-to-face inside your platform before any transaction.",
   },
];

const FEATURES = [
   { icon: MonitorUp, title: "Screen Sharing", body: "Share a desktop or window mid-call with no extra integration." },
   { icon: Monitor, title: "Hosted Call UI", body: "A ready-made call page at a URL you control. No frontend SDK needed." },
   { icon: Code2, title: "REST API", body: "Create, accept, end, join and leave calls with plain HTTP from any language." },
   { icon: Radio, title: "WebSocket Signaling", body: "Real-time call events like call.started and participant.joined, handled for you." },
   { icon: Atom, title: "React Components", body: "MeetingProvider, ParticipantGrid and controls for a custom UI without WebRTC." },
   { icon: Blocks, title: "Headless SDK", body: "meeting.join(), camera.enable(), screenShare.start(): full control of the UI." },
   { icon: DoorOpen, title: "Waiting Room", body: "Guests wait until the host lets them in to a scheduled meeting." },
   { icon: SlidersHorizontal, title: "Device Selection", body: "Pick camera, microphone and speaker before and during a call." },
   { icon: Palette, title: "Hosted UI Branding", body: "Your logo, company name and colours on every hosted call page." },
   { icon: Webhook, title: "Webhook Events", body: "Signed HTTP POSTs on every call state change, HMAC-SHA256 verified." },
   { icon: KeyRound, title: "Per-project API Keys", body: "Separate credentials per product or environment. Rotate without downtime." },
   { icon: Network, title: "TURN Relay", body: "Built-in TURN for calls behind strict firewalls, with time-limited credentials." },
];

const AI_USE_CASES = [
   {
      icon: Headphones,
      title: "24/7 support",
      body: "Answers questions and checks accounts, then hands off to a person with a summary.",
   },
   {
      icon: CalendarCheck,
      title: "Bookings",
      body: "Finds a free slot and books it once the user confirms.",
   },
   {
      icon: PackageSearch,
      title: "Order status",
      body: "Looks up the order and explains exactly where it is.",
   },
   {
      icon: Target,
      title: "Lead qualification",
      body: "Asks your qualifying questions and books the demo.",
   },
];

const STEPS = [
   {
      step: "Create a call",
      body: "Your backend calls POST /calls with a caller and a receiver. PurpleCallio returns a secure token for each participant.",
   },
   {
      step: "Send your users in",
      body: "Redirect each participant to their hosted URL, or join with the React components or headless SDK.",
   },
   {
      step: "PurpleCallio takes over",
      body: "Signaling, WebRTC negotiation, TURN relay, media controls and screen sharing, all handled.",
   },
];

const PLAYGROUND_STEPS = [
   { step: "1", label: "Start a demo call", done: true },
   { step: "2", label: "Create one session", done: true },
   { step: "3", label: "Share the invite link or QR code", done: true },
   { step: "4", label: "Connect and test media controls", done: false },
];

const SUPPORT_ITEMS = [
   {
      icon: Sparkles,
      title: "Fast Response",
      body: "Technical engineers, not marketing bots.",
   },
   {
      icon: BookOpen,
      title: "Clear Docs",
      body: "Quick start, copy buttons, examples in multiple languages.",
   },
   {
      icon: Wrench,
      title: "Working Examples",
      body: "Node.js, Python, cURL — drop in and it works.",
   },
   {
      icon: Globe2,
      title: "Developer support",
      body: "Get help with implementation and product questions.",
   },
];

export const metadata = pageMetadata({
   title: "PurpleCallio: Video, Audio & AI Voice Agent APIs",
   description: PURPLECALLIO_DESCRIPTION,
   path: "/",
});

function SectionHeading({
   label,
   title,
   intro,
   center = false,
   className = "",
}: {
   label: string;
   title: string;
   intro?: string;
   center?: boolean;
   className?: string;
}) {
   return (
      <div className={`${center ? "mx-auto text-center" : ""} max-w-3xl ${className}`}>
         <p className="section-label font-mono text-xs tracking-widest uppercase mb-4">{label}</p>
         <h2 className="lp-h2 font-bold leading-tight text-[#170B2E]">{title}</h2>
         {intro && <p className={`mt-4 text-[#3D3650] leading-relaxed ${center ? "mx-auto" : ""} max-w-2xl`}>{intro}</p>}
      </div>
   );
}

export default function LandingPage() {
   return (
      <div className="lp-root">
         <JsonLd
            data={[
               {
                  "@context": "https://schema.org",
                  "@type": "Organization",
                  name: PURPLECALLIO_NAME,
                  url: siteUrl.toString(),
                  logo: new URL("/icon.png", siteUrl).toString(),
                  description: PURPLECALLIO_DESCRIPTION,
                  email: "purplecallio@gmail.com",
               },
               {
                  "@context": "https://schema.org",
                  "@type": "WebSite",
                  name: PURPLECALLIO_NAME,
                  url: siteUrl.toString(),
               },
               {
                  "@context": "https://schema.org",
                  "@type": "SoftwareApplication",
                  name: PURPLECALLIO_NAME,
                  applicationCategory: "DeveloperApplication",
                  operatingSystem: "Web",
                  url: siteUrl.toString(),
                  description: PURPLECALLIO_DESCRIPTION,
                  offers: { "@type": "Offer", price: "0", priceCurrency: "INR", description: "Free plan with monthly usage credits" },
               },
            ]}
         />

         {/* ── Hero ── */}
         <section className="section-base relative px-6 pt-28 pb-20 overflow-hidden">
            <div className="absolute inset-0 pointer-events-none">
               <HeroGlow />
            </div>

            <div className="relative max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-10 items-center">
               <div className="min-w-0">
                  <Link
                     href="/features/ai-voice-agents"
                     className="hero-badge group inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium mb-7 transition-colors hover:border-[#7F40E8]/50"
                  >
                     <span className="rounded-full bg-[#7F40E8] px-2 py-0.5 text-[10px] font-semibold text-white">New</span>
                     AI voice agents are here
                     <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </Link>

                  <h1 className="lp-h1 font-bold text-[#170B2E] leading-[1.05] mb-6" style={{ fontSize: "clamp(2.4rem, 4.6vw, 3.9rem)" }}>
                     Build real-time communication into your product
                     <span className="gradient-text-hero"> in minutes, not weeks.</span>
                  </h1>

                  <p className="text-lg text-[#3D3650] leading-relaxed mb-8 max-w-xl">
                     Add video calls, audio calls and AI voice agents to your app
                     through hosted UI, React components, a headless SDK or REST
                     APIs. We run the signaling, WebRTC and TURN; you keep your
                     product.
                  </p>

                  <div className="flex flex-wrap gap-3 mb-8">
                     <Link
                        href="/dashboard"
                        className="btn-primary inline-flex items-center gap-2 text-white font-semibold text-sm px-6 py-3.5 rounded-xl shadow-[0_10px_30px_-10px_rgba(100,37,196,0.7)] transition-all hover:-translate-y-0.5 hover:opacity-95"
                     >
                        Start building free <ArrowRight size={16} aria-hidden="true" />
                     </Link>
                     <Link
                        href="/docs"
                        className="btn-secondary inline-flex items-center gap-2 font-semibold text-sm px-6 py-3.5 rounded-xl border border-[#E7DFF5] text-[#170B2E] transition-all hover:border-[#D6C4EE]"
                     >
                        Read the docs
                     </Link>
                  </div>

                  <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#3D3650]">
                     {HERO_POINTS.map((point) => (
                        <li key={point} className="flex items-center gap-2">
                           <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#7F40E8]/10 text-[#6425C4]">
                              <Check size={12} strokeWidth={3} aria-hidden="true" />
                           </span>
                           {point}
                        </li>
                     ))}
                  </ul>
               </div>

               <div className="relative min-w-0">
                  <div
                     aria-hidden="true"
                     className="absolute -inset-8 rounded-full opacity-60 blur-3xl"
                     style={{ background: "radial-gradient(closest-side, rgba(127,64,232,0.28), transparent)" }}
                  />
                  <Image
                     src={heroPreview}
                     alt="PurpleCallio video call interface with quick integration code and API response preview"
                     className="relative w-full h-auto"
                     priority
                     sizes="(min-width: 1024px) 45vw, (min-width: 640px) 80vw, 100vw"
                  />
               </div>
            </div>

            {/* Works with your stack */}
            <div className="relative max-w-6xl mx-auto mt-16">
               <p className="text-center text-xs font-mono uppercase tracking-widest text-[#3D3650]/80 mb-5">
                  Works with your stack
               </p>
               <ul className="flex flex-wrap justify-center gap-x-8 gap-y-3">
                  {STACK.map((name) => (
                     <li key={name} className="text-base font-semibold text-[#3D3650]/70">
                        {name}
                     </li>
                  ))}
               </ul>
            </div>
         </section>

         {/* ── Products: video, audio, AI ── */}
         <section className="section-alt px-6 py-24">
            <div className="max-w-6xl mx-auto">
               <SectionHeading
                  center
                  label="One platform"
                  title="Three ways to talk to your users."
                  intro="Video calls, audio calls and AI voice agents share the same API keys, dashboard, webhooks and prepaid credit balance. Start with one, add the others when you need them."
               />
               <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-3">
                  {CORE_FEATURES.map((f) => {
                     const ai = f.slug === "ai-voice-agents";
                     return (
                        <Link
                           key={f.slug}
                           href={`/features/${f.slug}`}
                           className={`group relative flex flex-col overflow-hidden rounded-3xl p-8 transition-all duration-300 hover:-translate-y-1 ${
                              ai
                                 ? "text-white shadow-[0_30px_60px_-20px_rgba(65,6,134,0.55)]"
                                 : "bg-white border border-[#E7DFF5] hover:shadow-[0_24px_50px_-24px_rgba(65,6,134,0.3)]"
                           }`}
                           style={
                              ai
                                 ? { background: "radial-gradient(120% 90% at 0% 0%, #8B4DF0 0%, #5B1BB5 45%, #2B0F52 100%)" }
                                 : undefined
                           }
                        >
                           <div className="flex items-center justify-between">
                              <span
                                 className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                                    ai ? "bg-white/15" : "bg-[#7F40E8]/10 text-[#7F40E8]"
                                 }`}
                              >
                                 <f.icon size={24} aria-hidden="true" />
                              </span>
                              {f.badge && (
                                 <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#5B1BB5]">{f.badge}</span>
                              )}
                           </div>
                           <h3 className={`mt-7 text-2xl font-bold ${ai ? "" : "text-[#170B2E]"}`}>{f.name}</h3>
                           <p className={`mt-2 text-sm leading-relaxed ${ai ? "text-white/80" : "text-[#3D3650]"}`}>{f.body}</p>
                           <ul className="mt-6 flex-1 space-y-2.5">
                              {f.highlights.map((h) => (
                                 <li key={h} className="flex items-start gap-2 text-sm">
                                    <Check size={16} className={`mt-0.5 shrink-0 ${ai ? "" : "text-[#7F40E8]"}`} aria-hidden="true" />
                                    <span className={ai ? "text-white/90" : "text-[#3D3650]"}>{h}</span>
                                 </li>
                              ))}
                           </ul>
                           <span className={`mt-8 inline-flex items-center gap-1.5 text-sm font-semibold ${ai ? "" : "text-[#6425C4]"}`}>
                              Explore {f.name}
                              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
                           </span>
                        </Link>
                     );
                  })}
               </div>
            </div>
         </section>

         {/* ── AI voice agents spotlight ── */}
         <section id="ai-voice-agents" className="px-6 py-8 sm:px-8">
            <div
               className="relative max-w-7xl mx-auto overflow-hidden rounded-[2rem] px-6 py-16 text-white sm:px-12 lg:py-20"
               style={{ background: "radial-gradient(120% 90% at 0% 0%, #8B4DF0 0%, #5B1BB5 45%, #2B0F52 100%)" }}
            >
               <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 opacity-[0.07]"
                  style={{
                     backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
                     backgroundSize: "32px 32px",
                  }}
               />
               <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                  <div className="min-w-0">
                     <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold mb-5">
                        <Sparkles size={14} aria-hidden="true" /> New · AI Voice Agents
                     </p>
                     <h2 className="lp-h2 font-bold mb-4">Let an AI agent answer the call.</h2>
                     <p className="text-white/80 leading-relaxed mb-8 max-w-xl">
                        Add a natural-sounding voice agent to your product. It
                        talks to your users in real time, looks things up in your
                        systems and takes actions through your APIs. Configure it
                        in the dashboard; no machine-learning work needed.
                     </p>
                     <div className="flex flex-wrap gap-3">
                        <Link
                           href="/features/ai-voice-agents"
                           className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#5B1BB5] transition-all hover:-translate-y-0.5"
                        >
                           Explore AI voice agents <ArrowRight size={16} aria-hidden="true" />
                        </Link>
                        <Link
                           href="/docs/ai-agents"
                           className="rounded-xl border border-white/30 px-5 py-3 text-sm font-medium text-white hover:bg-white/10"
                        >
                           Read the docs
                        </Link>
                     </div>
                     <p className="mt-4 text-sm text-white/70">Included on every paid plan.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
                     {AI_USE_CASES.map((uc) => (
                        <div key={uc.title} className="rounded-2xl bg-white/10 p-5 ring-1 ring-white/20 backdrop-blur-sm">
                           <uc.icon size={22} aria-hidden="true" />
                           <p className="mt-3 font-semibold">{uc.title}</p>
                           <p className="mt-1 text-sm text-white/75 leading-relaxed">{uc.body}</p>
                        </div>
                     ))}
                     <Link
                        href="/features/ai-voice-agents#use-cases"
                        className="sm:col-span-2 inline-flex items-center justify-center gap-2 rounded-2xl border border-white/25 p-4 text-sm font-medium hover:bg-white/10"
                     >
                        <Bot size={18} aria-hidden="true" /> See all use cases <ArrowRight size={16} aria-hidden="true" />
                     </Link>
                  </div>
               </div>
            </div>
         </section>

         {/* ── Three steps + code ── */}
         <section className="section-base px-6 py-24">
            <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
               <div className="min-w-0">
                  <SectionHeading
                     label="How it works"
                     title="Your first call in three steps."
                     intro="Keep your authentication, business logic and database. PurpleCallio adds the call lifecycle, participant sessions, signaling and media."
                  />
                  <ol className="mt-10 space-y-6">
                     {STEPS.map((s, i) => (
                        <li key={s.step} className="flex gap-4">
                           <span className="btn-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white">
                              {i + 1}
                           </span>
                           <div>
                              <p className="font-semibold text-[#170B2E]">{s.step}</p>
                              <p className="mt-1 text-sm text-[#3D3650] leading-relaxed">{s.body}</p>
                           </div>
                        </li>
                     ))}
                  </ol>
               </div>

               <div className="min-w-0">
                  <div className="lp-code-block rounded-2xl overflow-hidden border border-[#E7DFF5] shadow-[0_30px_60px_-30px_rgba(65,6,134,0.35)]">
                     <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E7DFF5]">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                        <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
                        <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
                        <span className="font-mono text-[#3D3650] text-xs ml-2">your-server.js</span>
                     </div>
                     <pre className="lp-pre font-mono text-sm px-5 py-6 overflow-x-auto leading-relaxed">
                        <span className="tok-comment">{`// 1. Create a call from your backend\n`}</span>
                        <span className="tok-keyword">{"const "}</span>
                        <span className="tok-base">{"{ participants } =\n  "}</span>
                        <span className="tok-async">{"await "}</span>
                        <span className="tok-base">{"PurpleCallio."}</span>
                        <span className="tok-fn">{"createCall"}</span>
                        <span className="tok-base">{"({ callerId, receiverId })\n\n"}</span>
                        <span className="tok-comment">{`// 2. Send each user to their call — done\n`}</span>
                        <span className="tok-async">{"redirect"}</span>
                        <span className="tok-base">{`(alice, participants[0].hostedUrl)\n`}</span>
                        <span className="tok-async">{"redirect"}</span>
                        <span className="tok-base">{`(bob, participants[1].hostedUrl)`}</span>
                     </pre>
                  </div>
                  <Link href="/docs/quickstart" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#6425C4]">
                     Follow the quickstart <ArrowRight size={16} aria-hidden="true" />
                  </Link>
               </div>
            </div>
         </section>

         {/* ── Integration paths ── */}
         <section className="section-alt px-6 py-24">
            <div className="max-w-6xl mx-auto">
               <SectionHeading
                  label="Choose your integration"
                  title="Hosted UI, React, headless SDK or REST."
                  intro="All four run on the same backend, so you can start with hosted UI and move to your own interface later without changing server code."
                  className="mb-10"
               />
               <IntegrationSelector />
            </div>
         </section>

         {/* ── Use cases ── */}
         <section className="section-base px-6 py-24">
            <div className="max-w-6xl mx-auto">
               <SectionHeading
                  center
                  label="Who it's for"
                  title="Built for products where people need to talk."
                  intro="PurpleCallio is B2B infrastructure. Your customers never see it; calls just work inside your product."
               />
               <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {USE_CASES.map((uc) => (
                     <div
                        key={uc.label}
                        className="group rounded-2xl border border-[#E7DFF5] bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-[#D6C4EE] hover:shadow-[0_20px_40px_-24px_rgba(65,6,134,0.3)]"
                     >
                        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#7F40E8]/10 text-[#7F40E8] transition-colors group-hover:bg-[#7F40E8] group-hover:text-white">
                           <uc.icon size={22} aria-hidden="true" />
                        </span>
                        <p className="mt-5 font-semibold text-[#170B2E]">{uc.label}</p>
                        <p className="mt-2 text-sm text-[#3D3650] leading-relaxed">{uc.description}</p>
                     </div>
                  ))}
               </div>
            </div>
         </section>

         {/* ── Features ── */}
         <section id="features" className="section-alt px-6 py-24">
            <div className="max-w-6xl mx-auto">
               <SectionHeading
                  center
                  label="What you get"
                  title="Everything in the box."
                  intro="The building blocks every calling product needs, included on every plan."
               />
               <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {FEATURES.map((f) => (
                     <div key={f.title} className="rounded-2xl bg-white p-6 ring-1 ring-[#E7DFF5] transition-shadow hover:shadow-[0_16px_36px_-20px_rgba(65,6,134,0.3)]">
                        <f.icon size={22} className="text-[#7F40E8]" aria-hidden="true" />
                        <p className="mt-4 font-semibold text-[#170B2E] text-sm">{f.title}</p>
                        <p className="mt-1.5 text-sm text-[#3D3650] leading-relaxed">{f.body}</p>
                     </div>
                  ))}
               </div>
               <div className="mt-10 text-center">
                  <Link href="/features" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#6425C4]">
                     See all features <ArrowRight size={16} aria-hidden="true" />
                  </Link>
               </div>
            </div>
         </section>

         {/* ── Playground ── */}
         <section className="section-base px-6 py-24">
            <div className="max-w-6xl mx-auto">
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                  <div>
                     <SectionHeading
                        label="Live Playground"
                        title="Test before you integrate."
                        intro="Start a demo session, then share its invite link or QR code with another device. Test audio, video and screen sharing before writing any code."
                     />
                     <Link
                        href="/signup"
                        className="btn-primary mt-8 inline-flex items-center gap-2 text-white font-semibold text-sm px-6 py-3.5 rounded-xl transition-all hover:-translate-y-0.5"
                     >
                        Try the playground <ArrowRight size={16} aria-hidden="true" />
                     </Link>
                  </div>

                  <div className="rounded-2xl border border-[#E7DFF5] bg-white overflow-hidden shadow-[0_30px_60px_-30px_rgba(65,6,134,0.3)]">
                     <div className="px-5 py-4 border-b border-[#E7DFF5] flex items-center gap-2">
                        <span className="hero-badge-dot w-2 h-2 rounded-full" />
                        <span className="text-xs text-[#3D3650] font-mono">PurpleCallio Playground</span>
                     </div>
                     <div className="p-6">
                        <div className="flex flex-col gap-3">
                           {PLAYGROUND_STEPS.map((item) => (
                              <div key={item.step} className="flex items-center gap-3">
                                 <div
                                    className={`${item.done ? "step-done" : "step-pending"} w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0`}
                                 >
                                    {item.done ? "✓" : item.step}
                                 </div>
                                 <p className={`text-sm ${item.done ? "text-[#170B2E]" : "text-[#3D3650]"}`}>{item.label}</p>
                              </div>
                           ))}
                        </div>
                        <div className="feature-cell mt-6 rounded-lg p-3 border border-[#E7DFF5] text-center text-xs text-[#3D3650] font-mono">
                           Sign in to create and manage a demo session.
                        </div>
                     </div>
                  </div>
               </div>
            </div>
         </section>

         {/* ── Pricing ── */}
         <PricingSection />

         {/* ── Support ── */}
         <section className="section-alt px-6 py-24">
            <div className="max-w-6xl mx-auto">
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                  <SectionHeading
                     label="Support"
                     title="Real answers from technical people."
                     intro="When something breaks, you need a fast answer from someone who knows the stack, not a chatbot pointing to a FAQ. PurpleCallio support is run by the engineers who built it."
                  />
                  <div className="grid grid-cols-2 gap-4">
                     {SUPPORT_ITEMS.map((item) => (
                        <div key={item.title} className="rounded-2xl bg-white p-5 ring-1 ring-[#E7DFF5]">
                           <item.icon size={20} className="text-[#7F40E8]" aria-hidden="true" />
                           <p className="mt-3 font-semibold text-[#170B2E] text-sm">{item.title}</p>
                           <p className="mt-1 text-xs text-[#3D3650] leading-relaxed">{item.body}</p>
                        </div>
                     ))}
                  </div>
               </div>
            </div>
         </section>

         {/* ── CTA ── */}
         <section className="py-28 px-6 relative overflow-hidden">
            <div className="cta-bg absolute inset-0" />
            <div className="cta-grid absolute inset-0 pointer-events-none" />
            <div className="relative max-w-2xl mx-auto text-center">
               <h2 className="lp-h2-cta font-bold leading-tight text-white mb-4">
                  Ready to add calls and AI agents to your product?
               </h2>
               <p className="text-slate-100 text-base mb-10">
                  Create an account, make a project, get your API key. First
                  call in under ten minutes.
               </p>
               <div className="flex flex-wrap justify-center gap-4">
                  <Link
                     href="/signup"
                     className="inline-flex items-center gap-2 bg-white text-[#2B0F52] font-semibold text-sm px-8 py-3.5 rounded-xl transition-all hover:-translate-y-0.5"
                  >
                     Create free account <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                  <Link
                     href="/docs"
                     className="inline-flex items-center gap-2 text-white font-medium text-sm px-8 py-3.5 rounded-xl border border-white/25 hover:border-white/50 transition-all"
                  >
                     Read the docs
                  </Link>
               </div>
            </div>
         </section>
      </div>
   );
}
