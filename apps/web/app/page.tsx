import Link from "next/link";
import Image from "next/image";
import heroPreview from "./assets/images/hero-preview.webp";
import StripeGradient from "./components/gradient/StripeGradient";
import PricingSection from "./components/PricingSection";
import { JsonLd } from "./components/seo/JsonLd";
import { pageMetadata, siteUrl } from "./lib/seo";
import { PURPLECALLIO_DESCRIPTION, PURPLECALLIO_NAME } from "./lib/brand";
import {
   FlowDiagram,
   IntegrationSelector,
} from "./components/marketing/InteractiveTools";
import {
   Atom,
   Blocks,
   BookOpen,
   BriefcaseBusiness,
   Globe2,
   Headphones,
   Monitor,
   ShoppingCart,
   Sparkles,
   Stethoscope,
   Target,
   Wrench,
} from "lucide-react";

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
         "Let agents and customers connect inside the support workflow without moving to a separate meeting product.",
   },
   {
      icon: BookOpen,
      label: "EdTech",
      description:
         "Live tutoring and classes built into your learning platform. Students never leave your product.",
   },
   {
      icon: ShoppingCart,
      label: "Marketplace",
      description:
         "Buyers and sellers meet face-to-face inside your platform before any transaction.",
   },
];

const FEATURES = [
   {
      title: "Audio & Video Calls",
      body: "Browser audio and video communication built on WebRTC, with simple prepaid plans and included usage credits — no surprise usage bills.",
   },
   {
      title: "Screen Sharing",
      body: "Share a desktop or application window mid-call — no extra integration required.",
   },
   {
      title: "Hosted Call UI",
      body: "A ready-made branded call page at a URL you control. No frontend SDK, no React dependency.",
   },
   {
      title: "REST API",
      body: "Create, accept, reject, end, join, and leave calls with plain HTTP. Any language, any framework.",
   },
   {
      title: "WebSocket Signaling",
      body: "Standardized real-time events — call.started, participant.joined, media state — handled server-side.",
   },
   {
      title: "React Components",
      body: "Reusable MeetingProvider, ParticipantGrid, and controls for a custom UI without implementing the media engine yourself.",
   },
   {
      title: "Headless SDK",
      body: "meeting.join(), camera.enable(), screenShare.start() — complete control with the @purplecallio/sdk engine.",
   },
   {
      title: "Waiting Room",
      body: "Built-in waiting room for scheduled meetings. Guests wait until the host lets them in.",
   },
   {
      title: "Device Selection",
      body: "Let users pick their camera, microphone, and speaker before and during a call.",
   },
   {
      title: "Hosted UI Branding",
      body: "Your logo, your company name, your colors. The hosted page matches your product on every call.",
   },
   {
      title: "Webhook Events",
      body: "Receive signed HTTP POSTs when call state changes. HMAC-SHA256 verified.",
   },
   {
      title: "Per-project API Keys",
      body: "Isolate credentials per product or environment. Rotate without downtime.",
   },
   {
      title: "TURN Relay",
      body: "Built-in TURN server for calls behind strict firewalls. Time-limited HMAC credentials.",
   },
   {
      title: "Developer Dashboard",
      body: "Manage projects, API keys, calls history, and usage minutes from one dashboard.",
   },
   {
      title: "Node.js SDK",
      body: "An npm package for the REST API and headless communication engine, with TypeScript support.",
   },
];

const PRODUCTS = [
   {
      icon: Monitor,
      tag: "5-minute integration",
      name: "Hosted UI",
      tagline: "The fastest way to integrate PurpleCallio.",
      body: "Create a call from your backend and redirect users to a PurpleCallio-hosted meeting page. No frontend implementation required.",
      features: [
         "Ready-made meeting interface",
         "Video, audio & screen sharing",
         "Device selection",
         "Waiting room",
         "Branding support",
         "Fully responsive",
      ],
      code: "POST /calls → hostedUrl + participant tokens",
      cta: "Create a call, redirect your users, done.",
   },
   {
      icon: Atom,
      tag: "Custom UI, zero WebRTC",
      name: "React Components",
      tagline: "A custom interface without building a meeting app.",
      body: "Reusable React components for developers who want a branded experience without touching WebRTC, signaling, or media handling.",
      features: [
         "MeetingProvider & MeetingRoom",
         "ParticipantGrid / ParticipantTile",
         "Control bar buttons",
         "DeviceSelector panel",
         "WaitingRoom panel",
         "Connection & speaking indicators",
      ],
      code: "<MeetingProvider token={token}><ParticipantGrid /><ControlBar /></MeetingProvider>",
      cta: "Build a fully branded meeting experience.",
   },
   {
      icon: Blocks,
      tag: "Full control",
      name: "Headless SDK",
      tagline: "Complete control over the meeting experience.",
      body: "Just the communication engine — no UI included. You build the interface, PurpleCallio handles signaling, auth, and media infrastructure.",
      features: [
         "join() / leave()",
         "camera & microphone controls",
         "screenShare.start() / stop()",
         "participants() & connectionState()",
         "Full event system",
         "Type-safe TypeScript",
      ],
      code: "const meeting = new PurpleCallio({ token }); await meeting.join();",
      cta: "Build your own UI on a proven engine.",
   },
];

const STEPS = [
   {
      step: "Create a call",
      body: "Your backend sends POST /calls with a caller ID and receiver ID. PurpleCallio returns a secure token for each participant.",
   },
   {
      step: "Redirect your users",
      body: "Send each participant to the PurpleCallio hosted URL with their token. That's the only frontend work you do.",
   },
   {
      step: "PurpleCallio takes over",
      body: "Signaling, WebRTC negotiation, media controls, screen sharing, and the call UI — all handled.",
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
   title: "PurpleCallio | Real-Time Communication Infrastructure for Developers",
   description: PURPLECALLIO_DESCRIPTION,
   path: "/",
});

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
                  logo: new URL("/opengraph-image", siteUrl).toString(),
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
               },
            ]}
         />
         {/* ── Hero ── */}
         <section className="section-base relative pt-24 pb-32 px-6 overflow-hidden">
            <div className="absolute inset-0 pointer-events-none">
               <StripeGradient />
            </div>

            <div className="relative max-w-6xl mx-auto">
               <div className="hero-badge inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono mb-8 border">
                  <span className="hero-badge-dot w-1.5 h-1.5 rounded-full animate-pulse" />
                  Simple prepaid plans &nbsp;·&nbsp; No surprise usage bills
               </div>

               <h1 className="lp-h1 font-bold text-[#170B2E] leading-tight mb-6">
                  Build real-time communication into your product
                  <span className="gradient-text-hero">
                     {" "}
                     in minutes, not weeks.
                  </span>
               </h1>

               <p className="text-balance text-[#3D3650] text-lg leading-relaxed mb-6">
                  {PURPLECALLIO_DESCRIPTION} Instead of building WebRTC
                  signaling, authentication, participant sessions, and calling
                  interfaces from scratch, developers can integrate PurpleCallio
                  through hosted UI, React components, a headless SDK, or REST
                  APIs.
               </p>

               <p className="text-balance text-[#170B2E] text-base font-medium leading-relaxed mb-6">
                  Build real-time communication without unpredictable billing.
                  Choose a plan. Pay upfront. Get usage credits. Build and
                  scale with confidence.
               </p>

               <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
                  <div>
                     <div className="flex flex-wrap gap-4 mb-8">
                        <Link
                           href="/dashboard"
                           className="btn-primary inline-flex items-center gap-2 text-white font-medium text-sm px-6 py-3 rounded-lg transition-all hover:opacity-90"
                        >
                           Start building free<span>→</span>
                        </Link>
                        <Link
                           href="/docs"
                           className="btn-secondary inline-flex items-center gap-2 font-medium text-sm px-6 py-3 rounded-lg border border-[#E7DFF5] transition-all hover:border-[#D6C4EE] hover:text-[#170B2E] text-[#3D3650]"
                        >
                           Read the docs
                        </Link>
                     </div>

                     {/* Code snippet */}
                     <div className="lp-code-block rounded-xl overflow-hidden border border-[#E7DFF5]">
                        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E7DFF5]">
                           <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                           <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
                           <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
                           <span className="font-mono text-[#3D3650] text-xs ml-2">
                              your-server.js
                           </span>
                           <span className="ml-auto text-xs text-[#3D3650] font-mono hidden sm:inline">
                              integration takes minutes, not days
                           </span>
                        </div>
                        <pre className="lp-pre font-mono text-sm px-5 py-5 overflow-x-auto">
                           <span className="tok-comment">{`// 1. Create a call from your backend\n`}</span>
                           <span className="tok-keyword">{"const "}</span>
                           <span className="tok-base">
                              {"{ callId, hostedUrl, participants } = "}
                           </span>
                           <span className="tok-async">{"await "}</span>
                           <span className="tok-base">{"PurpleCallio."}</span>
                           <span className="tok-fn">{"createCall"}</span>
                           <span className="tok-base">
                              {"({ callerId, receiverId })\n\n"}
                           </span>
                           <span className="tok-comment">{`// 2. Redirect each user — you're done\n`}</span>
                           <span className="tok-async">{"redirect"}</span>
                           <span className="tok-base">{`(alice, participants[0].hostedUrl)\n`}</span>
                           <span className="tok-async">{"redirect"}</span>
                           <span className="tok-base">{`(bob, participants[1].hostedUrl)`}</span>
                        </pre>
                     </div>
                  </div>

                  {/* Product preview */}
                  <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
                     <Image
                        src={heroPreview}
                        alt="PurpleCallio video call interface with quick integration code and API response preview"
                        className="w-full h-auto"
                        priority
                        sizes="(min-width: 1024px) 42vw, (min-width: 640px) 80vw, 100vw"
                     />
                  </div>
               </div>
            </div>
         </section>

         {/* ── Integration paths ── */}
         <section className="section-alt py-24 px-6">
            <div className="max-w-6xl mx-auto">
               <p className="section-label font-mono text-xs tracking-widest uppercase mb-4">
                  Choose your integration
               </p>
               <h2 className="lp-h2 font-bold text-[#170B2E] mb-4">
                  You build the product. PurpleCallio handles communication.
               </h2>
               <p className="text-[#3D3650] mb-10 max-w-3xl">
                  Keep your authentication, business logic, permissions,
                  branding, and database. PurpleCallio provides the call
                  lifecycle, participant sessions, signaling, WebRTC setup, TURN
                  relay, media controls, webhooks, and usage tracking.
               </p>
               <IntegrationSelector />
            </div>
         </section>

         {/* ── Problem / Solution ── */}
         <section className="section-alt py-24 px-6">
            <div className="max-w-6xl mx-auto">
               <p className="section-label font-mono text-xs tracking-widest uppercase mb-4">
                  Why PurpleCallio
               </p>
               <h2 className="lp-h2 font-bold text-[#170B2E] mb-4">
                  Real-time communication built for modern products.
               </h2>
               <p className="text-[#3D3650] mb-14 max-w-2xl">
                  Building browser communication means connecting product logic
                  to participant access, signaling, media controls, and the
                  WebRTC connection lifecycle.
               </p>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="card-problem rounded-xl border border-red-900/30 p-8">
                     <p className="font-mono text-xs tracking-widest uppercase mb-6 text-red-700">
                        The problem today
                     </p>
                     <div className="space-y-3">
                        {[
                           "A server-controlled call and participant-access flow",
                           "Real-time signaling alongside application state",
                           "WebRTC connection setup and restrictive-network paths",
                           "Media controls, device selection, and screen sharing",
                           "Usage tracking that belongs with the product integration",
                        ].map((item) => (
                           <div key={item} className="flex items-start gap-3">
                              <span className="text-red-700 mt-0.5 text-sm">
                                 ✕
                              </span>
                              <p className="text-sm text-[#3D3650]">{item}</p>
                           </div>
                        ))}
                     </div>
                  </div>

                  <div className="card-gradient rounded-xl border border-[#D6C4EE] p-8">
                     <p className="section-label font-mono text-xs tracking-widest uppercase mb-6">
                        The PurpleCallio way
                     </p>
                     <div className="space-y-3">
                        {[
                           "Server APIs for call creation and participant access",
                           "Hosted UI, React components, or a headless SDK",
                           "WebSocket signaling and TURN relay around browser WebRTC",
                           "Documentation and copyable integration examples",
                           "Prepaid plans, credit balance and usage tracking in the dashboard",
                        ].map((item) => (
                           <div key={item} className="flex items-start gap-3">
                              <span className="text-green-700 mt-0.5 text-sm">
                                 ✓
                              </span>
                              <p className="text-sm text-[#3D3650]">{item}</p>
                           </div>
                        ))}
                     </div>
                  </div>
               </div>
            </div>
         </section>

         <section className="section-base py-24 px-6">
            <div className="max-w-6xl mx-auto">
               <p className="section-label font-mono text-xs tracking-widest uppercase mb-4">
                  How it works
               </p>
               <h2 className="lp-h2 font-bold text-[#170B2E] mb-4">
                  A clear path from backend call creation to browser media.
               </h2>
               <p className="text-[#3D3650] mb-10 max-w-3xl">
                  Select a step to see where PurpleCallio fits into the
                  communication flow.
               </p>
               <FlowDiagram />
            </div>
         </section>

         {/* ── Use cases ── */}
         <section className="section-base py-24 px-6">
            <div className="max-w-6xl mx-auto">
               <p className="section-label font-mono text-xs tracking-widest uppercase mb-4">
                  Who it&apos;s for
               </p>
               <h2 className="lp-h2 font-bold text-[#170B2E] mb-4">
                  Any product that needs real-time video between two people
               </h2>
               <p className="text-[#3D3650] mb-14 max-w-2xl">
                  PurpleCallio is B2B infrastructure. Your customers never know it
                  exists — it just works, invisibly, inside your product.
               </p>
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {USE_CASES.map((uc) => (
                     <div
                        key={uc.label}
                        className="card-gradient rounded-xl border border-[#E7DFF5] p-6 transition-all hover:border-[#D6C4EE]"
                     >
                        <div className="mb-4 text-[#7F40E8]">
                           <uc.icon size={24} />
                        </div>
                        <p className="font-semibold text-[#170B2E] mb-2 text-sm">
                           {uc.label}
                        </p>
                        <p className="text-sm text-[#3D3650] leading-relaxed">
                           {uc.description}
                        </p>
                     </div>
                  ))}
               </div>
            </div>
         </section>

         {/* ── Products ── */}
         <section id="products" className="section-base py-24 px-6">
            <div className="max-w-6xl mx-auto">
               <p className="section-label font-mono text-xs tracking-widest uppercase mb-4">
                  Products
               </p>
               <h2 className="lp-h2 font-bold text-[#170B2E] mb-4">
                  Three ways to integrate.
               </h2>
               <p className="text-[#3D3650] mb-14 max-w-2xl">
                  Choose the integration style that fits your product. All three
                  are powered by the same REST + WebSocket backend — so you can
                  move between them without changing your server-side code.
               </p>

               <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {PRODUCTS.map((product) => (
                     <div
                        key={product.name}
                        className="card-surface rounded-xl border border-[#E7DFF5] p-7 flex flex-col transition-all hover:border-[#D6C4EE]"
                     >
                        <div className="flex items-center justify-between mb-5">
                           <div
                              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                              style={{
                                 background:
                                    "linear-gradient(135deg, rgba(127,64,232,0.14), rgba(65,6,134,0.1))",
                                 border: "1px solid rgba(127,64,232,0.25)",
                                 color: "#7F40E8",
                              }}
                           >
                              <product.icon size={24} />
                           </div>
                           <span
                              className="text-[10px] font-mono px-2.5 py-1 rounded-full uppercase tracking-widest"
                              style={{
                                 background: "rgba(127,64,232,0.08)",
                                 border: "1px solid rgba(127,64,232,0.25)",
                                 color: "#6425C4",
                              }}
                           >
                              {product.tag}
                           </span>
                        </div>

                        <h3 className="font-bold text-[#170B2E] text-lg mb-1">
                           {product.name}
                        </h3>
                        <p className="text-sm font-medium text-[#3D3650] mb-3">
                           {product.tagline}
                        </p>
                        <p className="text-sm text-[#3D3650] leading-relaxed mb-6">
                           {product.body}
                        </p>

                        <div className="space-y-2 mb-6">
                           {product.features.map((f) => (
                              <div key={f} className="flex items-start gap-2">
                                 <span className="check-indigo text-xs mt-0.5">
                                    ✓
                                 </span>
                                 <p className="text-sm text-[#3D3650]">{f}</p>
                              </div>
                           ))}
                        </div>

                        <div
                           className="rounded-lg px-3 py-2.5 mb-6 font-mono text-[11px] text-[#3D3650]"
                           style={{
                              background: "#F8F4FD",
                              border: "1px solid #E7DFF5",
                              overflowX: "auto",
                              whiteSpace: "nowrap",
                           }}
                        >
                           {product.code}
                        </div>

                        <p className="text-xs text-[#3D3650] mb-5 flex-1">
                           {product.cta}
                        </p>

                        <Link
                           href="/docs"
                           className={`block text-center text-sm font-medium px-4 py-2.5 rounded-lg transition-all hover:opacity-90 ${
                              product.name === "React Components"
                                 ? "text-white"
                                 : "text-[#6425C4]"
                           }`}
                           style={{
                              background:
                                 product.name === "React Components"
                                    ? "linear-gradient(135deg, #7F40E8, #410686)"
                                    : "rgba(127,64,232,0.06)",
                              border:
                                 product.name === "React Components"
                                    ? "none"
                                    : "1px solid rgba(127,64,232,0.2)",
                           }}
                        >
                           Learn more in docs →
                        </Link>
                     </div>
                  ))}
               </div>
            </div>
         </section>

         {/* ── Features ── */}
         <section id="features" className="section-base py-24 px-6">
            <div className="max-w-6xl mx-auto">
               <p className="section-label font-mono text-xs tracking-widest uppercase mb-4">
                  What you get
               </p>
               <h2 className="lp-h2 font-bold text-[#170B2E] mb-14">
                  Everything in the box
               </h2>
               <div className="features-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px">
                  {FEATURES.map((f) => (
                     <div key={f.title} className="feature-cell p-6">
                        <div className="feature-bar w-1 h-4 rounded-full mb-4" />
                        <p className="font-semibold text-[#170B2E] text-sm mb-2">
                           {f.title}
                        </p>
                        <p className="text-sm text-[#3D3650] leading-relaxed">
                           {f.body}
                        </p>
                     </div>
                  ))}
               </div>
            </div>
         </section>

         {/* ── Playground ── */}
         <section className="section-alt py-24 px-6">
            <div className="max-w-6xl mx-auto">
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                  <div>
                     <p className="section-label font-mono text-xs tracking-widest uppercase mb-4">
                        Live Playground
                     </p>
                     <h2 className="lp-h2 font-bold text-[#170B2E] mb-4">
                        Test before you integrate
                     </h2>
                     <p className="text-[#3D3650] mb-8 leading-relaxed">
                        Start a demo session, then share its invite link or QR
                        code with another device. Test audio, video, and screen
                        sharing before integrating.
                     </p>
                     <Link
                        href="/signup"
                        className="btn-primary inline-flex items-center gap-2 text-white font-medium text-sm px-6 py-3 rounded-lg transition-all hover:opacity-90"
                     >
                        Start building →
                     </Link>
                  </div>

                  <div className="card-surface rounded-xl border border-[#E7DFF5] overflow-hidden">
                     <div className="px-5 py-4 border-b border-[#E7DFF5] flex items-center gap-2">
                        <span className="hero-badge-dot w-2 h-2 rounded-full" />
                        <span className="text-xs text-[#3D3650] font-mono">
                           PurpleCallio Playground
                        </span>
                     </div>
                     <div className="p-6">
                        <div className="flex flex-col gap-3">
                           {PLAYGROUND_STEPS.map((item) => (
                              <div
                                 key={item.step}
                                 className="flex items-center gap-3"
                              >
                                 <div
                                    className={`${item.done ? "step-done" : "step-pending"} w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0`}
                                 >
                                    {item.done ? "✓" : item.step}
                                 </div>
                                 <p
                                    className={`text-sm ${item.done ? "text-[#170B2E]" : "text-[#3D3650]"}`}
                                 >
                                    {item.label}
                                 </p>
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
         <section className="section-alt py-24 px-6">
            <div className="max-w-6xl mx-auto">
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                  <div>
                     <p className="section-label font-mono text-xs tracking-widest uppercase mb-4">
                        Support
                     </p>
                     <h2 className="lp-h2 font-bold text-[#170B2E] mb-4">
                        Real answers from technical people
                     </h2>
                     <p className="text-[#3D3650] leading-relaxed">
                        When something breaks, you need a fast answer from
                        someone who actually knows the stack — not a chatbot
                        pointing to a FAQ. PurpleCallio support is run by the
                        engineers who built it.
                     </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                     {SUPPORT_ITEMS.map((item) => (
                        <div
                           key={item.title}
                           className="card-surface rounded-xl border border-[#E7DFF5] p-5"
                        >
                           <div className="mb-3 text-[#7F40E8]">
                              <item.icon size={20} />
                           </div>
                           <p className="font-semibold text-[#170B2E] text-sm mb-1">
                              {item.title}
                           </p>
                           <p className="text-xs text-[#3D3650] leading-relaxed">
                              {item.body}
                           </p>
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
               <h2 className="lp-h2-cta font-bold text-white mb-4">
                  Ready to ship video calls?
               </h2>
               <p className="text-slate-100 text-base mb-10">
                  Create an account, make a project, get your API key. First
                  call in under ten minutes.
               </p>
               <div className="flex flex-wrap justify-center gap-4">
                  <Link
                     href="/signup"
                     className="inline-flex items-center gap-2 bg-white text-slate-900 font-semibold text-sm px-8 py-3.5 rounded-lg transition-all hover:bg-slate-100"
                  >
                     Create free account →
                  </Link>
                  <Link
                     href="/docs"
                     className="inline-flex items-center gap-2 text-white font-medium text-sm px-8 py-3.5 rounded-lg border border-white/20 hover:border-white/40 transition-all"
                  >
                     Read the docs
                  </Link>
               </div>
            </div>
         </section>
      </div>
   );
}
