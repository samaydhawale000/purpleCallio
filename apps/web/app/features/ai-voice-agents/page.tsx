import Link from "next/link";
import {
   ArrowRight,
   BarChart3,
   BookOpenCheck,
   Bot,
   BriefcaseBusiness,
   CalendarCheck,
   Check,
   FileText,
   FlaskConical,
   GraduationCap,
   Headphones,
   Languages,
   LifeBuoy,
   MessagesSquare,
   PackageSearch,
   ShieldCheck,
   Sparkles,
   Stethoscope,
   Timer,
   UtensilsCrossed,
   Wrench,
} from "lucide-react";
import { Breadcrumbs } from "../../components/seo/Breadcrumbs";
import { JsonLd } from "../../components/seo/JsonLd";
import { CodeBlock } from "../../components/marketing/InteractiveTools";
import { AiRateNote } from "../../components/marketing/AiRateNote";
import { Reveal, RevealGroup, RevealItem } from "../../components/motion/Reveal";
import { pageMetadata, siteUrl } from "../../lib/seo";
import { AI_REACT_COMPONENT_EXAMPLE, AI_SECURITY_NOTES, AI_SERVER_SESSION_EXAMPLE } from "../../lib/ai-docs";

const PATH = "/features/ai-voice-agents";
const TITLE = "AI Voice Agents for Your Product";
const DESCRIPTION =
   "Add real-time AI voice agents to your app: natural, interruptible conversations that call your APIs, with transcripts, analytics and per-minute credits.";

export const metadata = pageMetadata({
   title: "AI Voice Agents API & Voice AI SDK",
   description: DESCRIPTION,
   path: PATH,
});

const STATS = [
   { icon: MessagesSquare, label: "Natural conversation", body: "Users can interrupt mid-sentence, like a real call." },
   { icon: Languages, label: "13 languages", body: "English, Hindi, Spanish, French, German, Japanese and more." },
   { icon: Wrench, label: "Takes real actions", body: "Looks up and updates data through your own APIs." },
   { icon: Sparkles, label: "No ML work", body: "Write instructions in plain language in the dashboard." },
];

const STEPS = [
   {
      title: "Create an agent",
      body: "In the dashboard, give it a name, instructions, a greeting, a voice, a language and a maximum call length. Every change is saved as a new version.",
   },
   {
      title: "Add tools (optional)",
      body: "Point the agent at HTTPS endpoints on your server, like lookup_order or book_slot. PurpleCallio signs every request so you know it's genuine.",
   },
   {
      title: "Test it in the playground",
      body: "Talk to the agent from your browser, watch the live transcript and tool calls, and refine the instructions until it sounds right.",
   },
   {
      title: "Start sessions from your backend",
      body: "When a signed-in user wants to talk, your server creates a session with your API key and hands the browser a short-lived, single-use token.",
   },
   {
      title: "Your user talks to the agent",
      body: "The browser SDK or the drop-in React component streams their voice. The agent answers, calls your tools, and the call is billed per minute in credits.",
   },
];

const USE_CASES = [
   {
      icon: Headphones,
      title: "First-line customer support",
      scenario: "A customer clicks “Talk to support” at 11 pm.",
      does: [
         "Answers common questions from your policies",
         "Checks the customer's account or order",
         "Hands off to a human with a summary when it can't help",
      ],
      tools: ["get_account", "create_ticket"],
   },
   {
      icon: CalendarCheck,
      title: "Appointment booking",
      scenario: "A patient or client wants the next free slot on Tuesday.",
      does: [
         "Finds open slots in your calendar",
         "Books, moves or cancels after the user confirms",
         "Reads back the date, time and location",
      ],
      tools: ["find_slots", "book_slot"],
   },
   {
      icon: BriefcaseBusiness,
      title: "Lead qualification",
      scenario: "A visitor on your pricing page has questions before buying.",
      does: [
         "Asks your qualifying questions naturally",
         "Explains plans and answers objections",
         "Saves the lead to your CRM and books a demo",
      ],
      tools: ["save_lead", "book_demo"],
   },
   {
      icon: PackageSearch,
      title: "Order and delivery status",
      scenario: "A shopper asks, “Where's my order?”",
      does: [
         "Looks up the order and delivery tracking",
         "Explains delays and next steps",
         "Starts a return or refund only after the shopper approves",
      ],
      tools: ["lookup_order", "start_return"],
   },
   {
      icon: Bot,
      title: "Candidate screening",
      scenario: "Hundreds of applicants need a first-round conversation.",
      does: [
         "Runs the same structured screening for everyone",
         "Answers questions about the role and company",
         "Saves answers to your applicant tracking system",
      ],
      tools: ["get_job", "save_screening"],
   },
   {
      icon: Stethoscope,
      title: "Patient intake",
      scenario: "A patient prepares for a telemedicine visit.",
      does: [
         "Collects symptoms, history and medications before the visit",
         "Gives the doctor a structured summary",
         "Never diagnoses; it follows your clinic's instructions",
      ],
      tools: ["save_intake"],
   },
   {
      icon: GraduationCap,
      title: "Tutoring and language practice",
      scenario: "A student wants to practise spoken Spanish for 10 minutes.",
      does: [
         "Holds a conversation at the student's level",
         "Corrects pronunciation and grammar gently",
         "Records progress against the lesson plan",
      ],
      tools: ["get_lesson", "save_progress"],
   },
   {
      icon: UtensilsCrossed,
      title: "Reservations and hospitality",
      scenario: "A guest wants a table for four at 8 pm.",
      does: [
         "Checks availability and special requests",
         "Confirms the booking and sends the details",
         "Answers questions about the menu and opening hours",
      ],
      tools: ["check_table", "reserve_table"],
   },
   {
      icon: LifeBuoy,
      title: "Internal helpdesk",
      scenario: "An employee needs to reset access or check a leave policy.",
      does: [
         "Answers HR and IT policy questions",
         "Opens tickets with the right category",
         "Checks the status of existing requests",
      ],
      tools: ["search_policy", "open_ticket"],
   },
];

const CAPABILITIES = [
   { icon: MessagesSquare, title: "Real-time, interruptible voice", body: "Low-latency speech in and out. When the user talks over the agent, it stops and listens." },
   { icon: FileText, title: "Your instructions, your voice", body: "Plain-language instructions, a greeting, a voice and a language per agent, with full version history." },
   { icon: Wrench, title: "Secure tools", body: "HMAC-signed HTTPS calls to your endpoints, argument validation, timeouts, and protection against requests to private networks." },
   { icon: ShieldCheck, title: "Confirm before acting", body: "Mark risky tools (refunds, bookings) as “requires confirmation” so the user must approve each call in the browser." },
   { icon: FlaskConical, title: "Playground", body: "Talk to any agent from the dashboard, with a live transcript, tool activity and a call timer." },
   { icon: BarChart3, title: "Call history and analytics", body: "Every call with its duration, outcome and credits, plus totals, success rate and peak usage." },
   { icon: BookOpenCheck, title: "Optional transcripts", body: "Store transcripts per agent, with card numbers, keys and emails redacted, and delete them after 7, 30 or 90 days." },
   { icon: Sparkles, title: "Gemini or OpenAI", body: "Choose the voice model per agent. Provider keys stay on our servers and never reach the browser." },
   { icon: Timer, title: "Built-in limits", body: "Maximum call length per agent, concurrency and daily limits, and calls capped by the credits left." },
];

const CONVERSATION: { who: "agent" | "user" | "tool"; text: string }[] = [
   { who: "agent", text: "Hi Priya, this is Ava from ShopCo. How can I help today?" },
   { who: "user", text: "My order hasn't arrived yet. It was supposed to come yesterday." },
   { who: "tool", text: "lookup_order · success · 412 ms" },
   { who: "agent", text: "I see order 4821 is with the courier and out for delivery today, before 6 pm. Would you like an SMS when it's nearby?" },
   { who: "user", text: "Yes please." },
   { who: "tool", text: "enable_sms_alert · success · 230 ms" },
   { who: "agent", text: "Done. You'll get a text when the driver is about 15 minutes away. Anything else?" },
];

const FAQ: [string, string][] = [
   [
      "What is an AI voice agent?",
      "A program that holds a spoken conversation with your user in real time. It listens, understands, replies with a natural voice, and can call your APIs to look up or change data.",
   ],
   [
      "Do I need machine-learning experience?",
      "No. You describe how the agent should behave in plain language in the dashboard, and optionally connect tools that point at your existing APIs.",
   ],
   [
      "Which plans include AI voice agents?",
      "Every paid plan, including custom plans. The Free plan doesn't include AI calls, but you can still explore the dashboard.",
   ],
   [
      "How are AI calls billed?",
      "Per minute, in credits from the same prepaid balance as your video and audio calls. A call can't run longer than your remaining credits cover. See the pricing page for the current rate.",
   ],
   [
      "Can the agent take actions, like booking or refunding?",
      "Yes, through tools: HTTPS endpoints on your server that the agent calls with validated arguments. For actions with side effects, require confirmation so the user approves each one.",
   ],
   [
      "Is the conversation recorded?",
      "Audio is never stored. Text transcripts are stored only if you turn them on for an agent, with sensitive data redacted, and deleted after the retention period you choose.",
   ],
   [
      "Can users interrupt the agent?",
      "Yes. When the user starts speaking, the agent stops talking and listens, just like a phone call with a person.",
   ],
];

export default function AiVoiceAgentsPage() {
   return (
      <main className="min-h-screen bg-white pb-24 text-[#3D3650]">
         <JsonLd
            data={[
               {
                  "@context": "https://schema.org",
                  "@type": "WebPage",
                  name: TITLE,
                  url: new URL(PATH, siteUrl).toString(),
                  description: DESCRIPTION,
               },
               {
                  "@context": "https://schema.org",
                  "@type": "FAQPage",
                  mainEntity: FAQ.map(([name, text]) => ({
                     "@type": "Question",
                     name,
                     acceptedAnswer: { "@type": "Answer", text },
                  })),
               },
            ]}
         />

         {/* ── Hero: an inset card, so the transparent site header sits on white ── */}
         <div className="px-3 pt-20 sm:px-4">
         <section
            className="rounded-3xl px-6 pb-20 pt-10 text-white"
            style={{ background: "radial-gradient(120% 90% at 0% 0%, #8B4DF0 0%, #5B1BB5 45%, #2B0F52 100%)" }}
         >
            <div className="mx-auto max-w-6xl">
               <div className="[&_a]:text-white/80 [&_a:hover]:text-white [&_*]:text-white/80">
                  <Breadcrumbs
                     items={[
                        { label: "Home", href: "/" },
                        { label: "Features", href: "/features" },
                        { label: "AI Voice Agents", href: PATH },
                     ]}
                  />
               </div>
               <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
                  <div className="min-w-0">
                     <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                        <Sparkles size={14} aria-hidden="true" /> New · AI Voice Agents
                     </p>
                     <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
                        AI voice agents that talk to your users and get things done.
                     </h1>
                     <p className="mt-6 text-lg leading-8 text-white/80">
                        Put a natural-sounding AI agent inside your product. It answers questions, looks things
                        up in your systems and takes actions through your APIs, in real time, in your users&apos;
                        language. You configure it in the dashboard; PurpleCallio runs the voice, the model
                        connection, the tools and the billing.
                     </p>
                     <div className="mt-8 flex flex-wrap gap-3">
                        <Link
                           href="/dashboard/ai"
                           className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-[#5B1BB5] hover:bg-white/90"
                        >
                           Build your first agent <ArrowRight size={16} aria-hidden="true" />
                        </Link>
                        <Link
                           href="/docs/ai-agents"
                           className="rounded-lg border border-white/30 px-5 py-3 text-sm font-medium text-white hover:bg-white/10"
                        >
                           Read the docs
                        </Link>
                     </div>
                     <p className="mt-4 text-sm text-white/70">Included on every paid plan.</p>
                  </div>

                  {/* Example conversation */}
                  <div className="min-w-0 rounded-2xl bg-white/10 p-5 ring-1 ring-white/20 backdrop-blur" aria-label="Example AI voice agent conversation">
                     <div className="mb-4 flex items-center justify-between text-xs text-white/70">
                        <span className="inline-flex items-center gap-2">
                           <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> Live call · Order support agent
                        </span>
                        <span className="font-mono">01:12</span>
                     </div>
                     <div className="space-y-3">
                        {CONVERSATION.map((line, i) =>
                           line.who === "tool" ? (
                              <p key={i} className="flex items-center gap-2 font-mono text-[11px] text-white/60">
                                 <Wrench size={12} aria-hidden="true" /> {line.text}
                              </p>
                           ) : (
                              <div key={i} className={`flex ${line.who === "user" ? "justify-end" : ""}`}>
                                 <p
                                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                                       line.who === "user" ? "bg-white text-[#2B0F52]" : "bg-white/15 text-white"
                                    }`}
                                 >
                                    {line.text}
                                 </p>
                              </div>
                           ),
                        )}
                     </div>
                  </div>
               </div>
            </div>
         </section>
         </div>

         <div className="mx-auto max-w-6xl px-6">
            {/* ── At a glance ── */}
            <RevealGroup as="section" stagger={0.08} className="-mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
               {STATS.map((s) => (
                  <RevealItem key={s.label} variant="scale" className="rounded-xl border border-[#E7DFF5] bg-white p-5 shadow-sm">
                     <s.icon size={22} className="text-[#7F40E8]" aria-hidden="true" />
                     <p className="mt-3 font-semibold text-[#170B2E]">{s.label}</p>
                     <p className="mt-1 text-sm">{s.body}</p>
                  </RevealItem>
               ))}
            </RevealGroup>

            {/* ── How it works ── */}
            <section className="mt-24">
               <Reveal>
                  <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">How it works</p>
                  <h2 className="mt-3 text-3xl font-bold text-[#170B2E]">From idea to live agent in five steps</h2>
               </Reveal>
               <RevealGroup as="ol" stagger={0.1} className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-5">
                  {STEPS.map((s, i) => (
                     <RevealItem as="li" key={s.title} variant="left" className="rounded-xl border border-[#E7DFF5] p-5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7F40E8] text-sm font-bold text-white">
                           {i + 1}
                        </span>
                        <p className="mt-4 font-semibold text-[#170B2E]">{s.title}</p>
                        <p className="mt-2 text-sm leading-relaxed">{s.body}</p>
                     </RevealItem>
                  ))}
               </RevealGroup>
            </section>

            {/* ── Use cases ── */}
            <section className="mt-24" id="use-cases">
               <Reveal>
                  <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">Use cases</p>
                  <h2 className="mt-3 text-3xl font-bold text-[#170B2E]">What teams build with AI voice agents</h2>
                  <p className="mt-4 max-w-3xl">
                     Anywhere your users would otherwise wait for a person, fill in a form, or search a help
                     centre, an agent can talk them through it. Each example shows the tools it would connect to.
                  </p>
               </Reveal>
               <RevealGroup stagger={0.08} className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {USE_CASES.map((u) => (
                     <RevealItem as="article" key={u.title} variant="zoom-up" className="flex h-full flex-col rounded-2xl border border-[#E7DFF5] p-6 transition-colors hover:border-[#D6C4EE]">
                        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#7F40E8]/10 text-[#7F40E8]">
                           <u.icon size={22} aria-hidden="true" />
                        </span>
                        <h3 className="mt-4 text-lg font-bold text-[#170B2E]">{u.title}</h3>
                        <p className="mt-1 text-sm italic">{u.scenario}</p>
                        <ul className="mt-4 flex-1 space-y-2">
                           {u.does.map((d) => (
                              <li key={d} className="flex items-start gap-2 text-sm">
                                 <Check size={16} className="mt-0.5 shrink-0 text-[#7F40E8]" aria-hidden="true" />
                                 {d}
                              </li>
                           ))}
                        </ul>
                        <div className="mt-5 flex flex-wrap gap-1.5">
                           {u.tools.map((t) => (
                              <code key={t} className="rounded-md bg-[#F8F4FD] px-2 py-1 text-[11px] text-[#6425C4] ring-1 ring-[#E7DFF5]">
                                 {t}
                              </code>
                           ))}
                        </div>
                     </RevealItem>
                  ))}
               </RevealGroup>
            </section>

            {/* ── Capabilities ── */}
            <section className="mt-24">
               <Reveal>
                  <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">Capabilities</p>
                  <h2 className="mt-3 text-3xl font-bold text-[#170B2E]">Everything you need to run voice AI in production</h2>
               </Reveal>
               <RevealGroup stagger={0.06} className="mt-10 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                  {CAPABILITIES.map((c) => (
                     <RevealItem key={c.title} variant="up" className="flex gap-4">
                        <c.icon size={22} className="mt-0.5 shrink-0 text-[#7F40E8]" aria-hidden="true" />
                        <div>
                           <p className="font-semibold text-[#170B2E]">{c.title}</p>
                           <p className="mt-1 text-sm leading-relaxed">{c.body}</p>
                        </div>
                     </RevealItem>
                  ))}
               </RevealGroup>
            </section>

            {/* ── Integrate ── */}
            <section className="mt-24">
               <Reveal>
                  <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">Integrate</p>
                  <h2 className="mt-3 text-3xl font-bold text-[#170B2E]">Two small pieces of code</h2>
                  <p className="mt-4 max-w-3xl">
                     Your server creates a session for a signed-in user, then your page renders the agent. The
                     API key stays on your server; the browser only ever sees a short-lived token.
                  </p>
               </Reveal>
               <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <Reveal variant="left" className="min-w-0">
                     <p className="mb-3 text-sm font-semibold text-[#170B2E]">1. Your backend: create a session</p>
                     <CodeBlock code={AI_SERVER_SESSION_EXAMPLE} filename="server.ts" />
                  </Reveal>
                  <Reveal variant="right" delay={0.1} className="min-w-0">
                     <p className="mb-3 text-sm font-semibold text-[#170B2E]">2. Your page: drop in the agent</p>
                     <CodeBlock code={AI_REACT_COMPONENT_EXAMPLE} filename="SupportWidget.tsx" />
                     <p className="mt-3 text-sm">
                        Prefer your own UI? Use the <code>usePurpleCallioAI</code> hook or the headless{" "}
                        <code>PurpleCallioAgentCall</code> class from <code>@purplecallio/sdk</code>.
                     </p>
                  </Reveal>
               </div>
            </section>

            {/* ── Pricing + security ── */}
            <section className="mt-24 grid grid-cols-1 gap-6 lg:grid-cols-2">
               <Reveal variant="left" className="rounded-2xl border border-[#E7DFF5] p-7">
                  <h2 className="text-2xl font-bold text-[#170B2E]">Simple per-minute pricing</h2>
                  <ul className="mt-5 space-y-3 text-sm">
                     <li className="flex items-start gap-2">
                        <Check size={16} className="mt-0.5 shrink-0 text-[#7F40E8]" aria-hidden="true" />
                        <span>
                           <AiRateNote />
                        </span>
                     </li>
                     {[
                        "Included on every paid plan, including custom plans.",
                        "One prepaid balance for video, audio and AI calls. Top up any time.",
                        "A call can't run longer than your remaining credits cover, so there are no surprise bills.",
                        "Failed connections are never charged.",
                     ].map((t) => (
                        <li key={t} className="flex items-start gap-2">
                           <Check size={16} className="mt-0.5 shrink-0 text-[#7F40E8]" aria-hidden="true" />
                           {t}
                        </li>
                     ))}
                  </ul>
                  <Link href="/pricing" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[#6425C4]">
                     See plans and credit rates <ArrowRight size={16} aria-hidden="true" />
                  </Link>
               </Reveal>
               <Reveal variant="right" delay={0.1} className="rounded-2xl border border-[#E7DFF5] p-7">
                  <h2 className="text-2xl font-bold text-[#170B2E]">Security and privacy</h2>
                  <ul className="mt-5 space-y-3 text-sm">
                     {AI_SECURITY_NOTES.slice(0, 5).map((t) => (
                        <li key={t} className="flex items-start gap-2">
                           <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#7F40E8]" aria-hidden="true" />
                           {t}
                        </li>
                     ))}
                  </ul>
               </Reveal>
            </section>

            {/* ── FAQ ── */}
            <Reveal as="section" amount={0.1} className="mt-24">
               <h2 className="text-3xl font-bold text-[#170B2E]">Frequently asked questions</h2>
               <div className="mt-8 divide-y divide-[#E7DFF5] rounded-2xl border border-[#E7DFF5]">
                  {FAQ.map(([q, a]) => (
                     <details key={q} className="group p-6">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-[#170B2E]">
                           {q}
                           <ArrowRight size={16} className="shrink-0 text-[#6425C4] transition-transform group-open:rotate-90" aria-hidden="true" />
                        </summary>
                        <p className="mt-3 text-sm leading-relaxed">{a}</p>
                     </details>
                  ))}
               </div>
            </Reveal>

            {/* ── CTA ── */}
            <Reveal as="section" variant="zoom-up" duration={0.8} className="mt-20 rounded-2xl border border-[#D6C4EE] bg-[#7F40E8]/5 p-8">
               <h2 className="text-2xl font-bold text-[#170B2E]">Give your product a voice</h2>
               <p className="mt-3 max-w-2xl">
                  Create an agent, talk to it in the playground, and embed it with a few lines of code.
               </p>
               <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/dashboard/ai" className="btn-primary rounded-lg px-5 py-3 text-sm font-medium text-white">
                     Build your first agent
                  </Link>
                  <Link href="/docs/ai-agents" className="rounded-lg border border-[#D6C4EE] px-5 py-3 text-sm font-medium text-[#3D3650]">
                     AI voice agents docs
                  </Link>
                  <Link href="/features" className="rounded-lg border border-[#D6C4EE] px-5 py-3 text-sm font-medium text-[#3D3650]">
                     All features
                  </Link>
               </div>
            </Reveal>
         </div>
      </main>
   );
}
