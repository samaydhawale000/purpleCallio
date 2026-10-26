import Link from "next/link";
import {
   ArrowRight,
   Check,
   CircleMinus,
   Ear,
   EyeOff,
   GraduationCap,
   Headphones,
   Languages,
   Lock,
   MessageSquareWarning,
   ShieldCheck,
   ShoppingBag,
   Stethoscope,
} from "lucide-react";
import { Breadcrumbs } from "../../components/seo/Breadcrumbs";
import { JsonLd } from "../../components/seo/JsonLd";
import { CodeBlock } from "../../components/marketing/InteractiveTools";
import { FaqList } from "../../components/marketing/FaqItem";
import { Reveal, RevealGroup, RevealItem } from "../../components/motion/Reveal";
import { DualViewDemo } from "../../components/marketing/live-translate/DualViewDemo";
import { LanguageGrid } from "../../components/marketing/live-translate/LanguageGrid";
import { TranslationRateList } from "../../components/marketing/live-translate/TranslationPricing";
import { FEATURE_MOCKS } from "./_components/FeatureMocks";
import { pageMetadata, siteUrl } from "../../lib/seo";
import {
   COMPARISON_ROWS,
   LIVE_TRANSLATE_DOCS_PATH,
   LIVE_TRANSLATE_FAQ,
   LIVE_TRANSLATE_FEATURES,
   LIVE_TRANSLATE_PATH,
   LIVE_TRANSLATE_SIGNUP,
   LIVE_TRANSLATE_STATUS,
   LT_CONTEXT_SNIPPET,
   LT_COSTGUARD_SNIPPET,
   LT_GUARD_SNIPPET,
   LT_METRICS_SNIPPET,
   LT_REACT_EXAMPLE,
   LT_REPORT_SNIPPET,
   LT_REST_CREATE,
   LT_SDK_EXAMPLE,
   PROVIDERS_TEXT,
} from "../../lib/live-translate";

const TITLE = "Live Translate: Real-Time Voice Translation for Calls";
const DESCRIPTION =
   "Real-time voice translation API for calls: two-way voice and captions with the original text, misunderstanding flags and budgets. 60 languages, any to any.";

export const metadata = pageMetadata({
   title: "Live Translate: Real-Time Voice Translation API",
   description: DESCRIPTION,
   path: LIVE_TRANSLATE_PATH,
});

const PROBLEMS = [
   { title: "Amounts and dates", body: "“₹2,450” heard as “₹2,540”, or Tuesday heard as Thursday. Small slips like these lose money and trust." },
   { title: "Names and terms", body: "Product names, medicines and legal terms get “translated” into ordinary words, or mangled." },
   { title: "Nobody can tell", body: "With translation alone, neither person can see what the other actually said, so mistakes go unnoticed." },
];

const STEPS = [
   { title: "Set each person's language", body: "Pass callerLanguage and receiverLanguage when you create the call, or let each person pick “I speak” in the call. Use auto to detect it." },
   { title: "Talk normally", body: "Each person speaks in their own language, including code-mixed speech like Spanglish or Hinglish. PurpleCallio runs speech recognition, translation and voice on the server." },
   { title: "Each hears and reads the other", body: "The listener hears a translated voice a short moment behind the speaker, with the original voice turned down, and both see DualView captions." },
];

const SNIPPETS: Record<string, { code: string; filename: string } | undefined> = {
   purplelex: { code: LT_CONTEXT_SNIPPET, filename: "POST /calls · translation" },
   meaningguard: { code: LT_GUARD_SNIPPET, filename: "POST /calls · translation" },
   costguard: { code: LT_COSTGUARD_SNIPPET, filename: "POST /calls · translation" },
   observability: { code: LT_METRICS_SNIPPET, filename: "metrics.http" },
   "post-call": { code: LT_REPORT_SNIPPET, filename: "report.http" },
};

const USE_CASES = [
   { icon: Stethoscope, title: "Telehealth", body: "A doctor in Pune and a patient who speaks Tamil talk directly. Medicine names stay intact, and a changed dose gets flagged." },
   { icon: ShoppingBag, title: "Marketplaces and gig platforms", body: "A buyer and a seller, or a customer and a delivery partner, sort out an address or a price without a shared language." },
   { icon: GraduationCap, title: "Edtech tutoring", body: "A tutor teaches in English while the student hears Hindi, and both can check the original words when a concept is unclear." },
   { icon: Headphones, title: "Support and sales", body: "An English-speaking agent helps a customer in Marathi. PurpleLex keeps plan and product names right, and the call ends with notes." },
];

const PRIVACY = [
   { icon: EyeOff, text: "No audio or transcript storage by default. Audio is streamed to the translation provider for the call and not stored by PurpleCallio." },
   { icon: ShieldCheck, text: "Replay of the original audio is off by default. A project can opt in; the buffer then lives in memory only (about 30 seconds), is cleared at the end of the call, and both people see a “Replay enabled” indicator." },
   { icon: Lock, text: "Transcripts are kept only if you turn on the Post-Call Suite, with redaction and the retention period you choose." },
   { icon: Languages, text: "Translation is processed by Soniox as a sub-processor. Provider keys stay on our servers and never reach the browser." },
   { icon: MessageSquareWarning, text: "An honest statement on accuracy: AI translation can be wrong. MeaningGuard flags phrases that may be misunderstood, but a phrase that isn't flagged can still be wrong, so confirm anything important." },
];

export default function LiveTranslationPage() {
   return (
      <main className="min-h-screen bg-white pb-24 text-[#3D3650]">
         <JsonLd
            data={[
               {
                  "@context": "https://schema.org",
                  "@type": "WebPage",
                  name: TITLE,
                  url: new URL(LIVE_TRANSLATE_PATH, siteUrl).toString(),
                  description: DESCRIPTION,
               },
               {
                  "@context": "https://schema.org",
                  "@type": "FAQPage",
                  mainEntity: LIVE_TRANSLATE_FAQ.map(([name, text]) => ({
                     "@type": "Question",
                     name,
                     acceptedAnswer: { "@type": "Answer", text },
                  })),
               },
            ]}
         />

         {/* 1. Hero */}
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
                           { label: "Live Translate", href: LIVE_TRANSLATE_PATH },
                        ]}
                     />
                  </div>
                  <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
                     <div className="min-w-0">
                        <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-amber-300 px-3 py-1 text-xs font-semibold text-amber-950" data-testid="early-access-badge">
                           <Languages size={14} aria-hidden="true" /> {LIVE_TRANSLATE_STATUS} · Live Translate
                        </p>
                        <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
                           Talk to anyone on a call, in their own language.
                        </h1>
                        <p className="mt-6 text-lg leading-8 text-white/80">
                           Two-way voice translation and captions for 1:1 calls, built so possible misunderstandings get
                           flagged, costs stay predictable and quality is measurable. One flag on your call, 60 languages.
                        </p>
                        <div className="mt-8 flex flex-wrap gap-3">
                           <Link
                              href={LIVE_TRANSLATE_SIGNUP}
                              className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-[#5B1BB5] hover:bg-white/90"
                           >
                              Join early access <ArrowRight size={16} aria-hidden="true" />
                           </Link>
                           <Link
                              href={LIVE_TRANSLATE_DOCS_PATH}
                              className="rounded-lg border border-white/30 px-5 py-3 text-sm font-medium text-white hover:bg-white/10"
                           >
                              Read the docs
                           </Link>
                        </div>
                        <p className="mt-4 text-sm text-white/70">
                           Early access: features, languages and pricing may change before general availability.
                        </p>
                     </div>
                     <DualViewDemo dark />
                  </div>
               </div>
            </section>
         </div>

         <div className="mx-auto max-w-6xl px-6">
            {/* 2. Why translation alone isn't enough */}
            <section className="mt-24">
               <Reveal>
                  <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">The problem</p>
                  <h2 className="mt-3 text-3xl font-bold text-[#170B2E]">Why translation alone isn&apos;t enough</h2>
                  <p className="mt-4 max-w-3xl">
                     In healthcare, sales and support, the costly mistakes are rarely whole sentences. They&apos;re a
                     wrong amount, a changed name or a misheard term that nobody notices until later.
                  </p>
               </Reveal>
               <RevealGroup stagger={0.08} className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
                  {PROBLEMS.map((p) => (
                     <RevealItem key={p.title} variant="scale" className="rounded-xl border border-[#E7DFF5] p-5">
                        <p className="font-semibold text-[#170B2E]">{p.title}</p>
                        <p className="mt-2 text-sm leading-relaxed">{p.body}</p>
                     </RevealItem>
                  ))}
               </RevealGroup>
            </section>

            {/* 3. How it works */}
            <section className="mt-24">
               <Reveal>
                  <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">How it works</p>
                  <h2 className="mt-3 text-3xl font-bold text-[#170B2E]">Three steps, no pipeline to build</h2>
               </Reveal>
               <RevealGroup as="ol" stagger={0.1} className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
                  {STEPS.map((s, i) => (
                     <RevealItem as="li" key={s.title} variant="left" className="rounded-xl border border-[#E7DFF5] p-5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7F40E8] text-sm font-bold text-white">{i + 1}</span>
                        <p className="mt-4 font-semibold text-[#170B2E]">{s.title}</p>
                        <p className="mt-2 text-sm leading-relaxed">{s.body}</p>
                     </RevealItem>
                  ))}
               </RevealGroup>
            </section>

            {/* 4. Seven feature blocks */}
            <section className="mt-24" aria-labelledby="lt-features">
               <Reveal>
                  <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">Seven features</p>
                  <h2 id="lt-features" className="mt-3 text-3xl font-bold text-[#170B2E]">More than a translation toggle</h2>
                  <p className="mt-4 max-w-3xl">All seven are part of early access and roll out to early-access accounts in stages.</p>
               </Reveal>
               <div className="mt-12 space-y-20">
                  {LIVE_TRANSLATE_FEATURES.map((f, i) => {
                     const Mock = FEATURE_MOCKS[f.id];
                     const snippet = SNIPPETS[f.id];
                     return (
                        <article key={f.id} id={f.id} className="scroll-mt-24 grid grid-cols-1 items-center gap-10 lg:grid-cols-2" data-testid={`lt-feature-${f.id}`}>
                           <Reveal variant={i % 2 ? "right" : "left"} className={`min-w-0 ${i % 2 ? "lg:order-2" : ""}`}>
                              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#7F40E8]/10 text-[#7F40E8]">
                                 <f.icon size={22} aria-hidden="true" />
                              </span>
                              <p className="mt-4 font-mono text-xs text-[#6425C4]">0{i + 1} · {f.theme}</p>
                              <h3 className="mt-1 text-2xl font-bold text-[#170B2E]">{f.brand}</h3>
                              <p className="text-sm font-medium text-[#6425C4]">{f.description}</p>
                              <p className="mt-4 text-lg font-semibold text-[#170B2E]">{f.promise}</p>
                              <p className="mt-2 leading-relaxed">
                                 <span className="font-semibold text-[#170B2E]">Why it matters: </span>
                                 {f.why}
                              </p>
                              {snippet && (
                                 <div className="mt-5">
                                    <CodeBlock code={snippet.code} filename={snippet.filename} />
                                 </div>
                              )}
                           </Reveal>
                           <Reveal variant={i % 2 ? "left" : "right"} delay={0.1} className={`min-w-0 ${i % 2 ? "lg:order-1" : ""}`}>
                              {Mock ? <Mock /> : null}
                           </Reveal>
                        </article>
                     );
                  })}
               </div>
            </section>

            {/* 5. Global languages */}
            <section className="mt-24" id="languages">
               <Reveal>
                  <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">60 languages</p>
                  <h2 className="mt-3 text-3xl font-bold text-[#170B2E]">Built for how the world actually talks</h2>
                  <p className="mt-4 max-w-3xl">
                     Regional accents, code-mixed speech (Spanglish, Hinglish, Taglish and more) and everyday colloquial
                     speech, not just formal text. Every language supports voice and captions, and any one can be
                     translated into any other.
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[#170B2E]">{PROVIDERS_TEXT}.</p>
               </Reveal>
               <div className="mt-8">
                  <LanguageGrid />
               </div>
            </section>

            {/* 6. Use cases */}
            <section className="mt-24" id="use-cases">
               <Reveal>
                  <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">Use cases</p>
                  <h2 className="mt-3 text-3xl font-bold text-[#170B2E]">Where a shared language is missing</h2>
               </Reveal>
               <RevealGroup stagger={0.08} className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
                  {USE_CASES.map((u) => (
                     <RevealItem as="article" key={u.title} variant="zoom-up" className="flex gap-4 rounded-2xl border border-[#E7DFF5] p-6">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#7F40E8]/10 text-[#7F40E8]">
                           <u.icon size={22} aria-hidden="true" />
                        </span>
                        <div>
                           <h3 className="text-lg font-bold text-[#170B2E]">{u.title}</h3>
                           <p className="mt-1 text-sm leading-relaxed">{u.body}</p>
                        </div>
                     </RevealItem>
                  ))}
               </RevealGroup>
            </section>

            {/* 7. Comparison */}
            <section className="mt-24" id="compare">
               <Reveal>
                  <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">Compare</p>
                  <h2 className="mt-3 text-3xl font-bold text-[#170B2E]">Build it yourself, or have it built in</h2>
                  <p className="mt-4 max-w-3xl">
                     Most calling SDKs give you audio and video. Translation is usually left for you to assemble from
                     separate providers. Here&apos;s what that means, next to what comes with Live Translate.
                  </p>
               </Reveal>
               <div className="mt-8 overflow-hidden rounded-2xl border border-[#E7DFF5]" data-testid="lt-comparison">
                  <div className="hidden grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] bg-[#F8F4FD] text-xs font-semibold uppercase tracking-wider md:grid">
                     <p className="px-5 py-3">Capability</p>
                     <p className="px-5 py-3">Building it yourself</p>
                     <p className="px-5 py-3 text-[#6425C4]">With PurpleCallio</p>
                  </div>
                  <ul>
                     {COMPARISON_ROWS.map((r) => (
                        <li
                           key={r.label}
                           className="grid grid-cols-1 border-t border-[#E7DFF5] first:border-t-0 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] md:first:border-t"
                        >
                           <p className="px-5 pt-4 font-semibold text-[#170B2E] md:py-4">{r.label}</p>
                           <p className="flex gap-2 px-5 pt-2 text-sm md:py-4">
                              <CircleMinus size={16} className="mt-0.5 shrink-0 text-[#9A93A8]" aria-hidden="true" />
                              <span>
                                 <span className="sr-only">Building it yourself: </span>
                                 {r.diy}
                              </span>
                           </p>
                           <div className="flex gap-2 bg-[#7F40E8]/5 px-5 py-4 text-sm">
                              <Check size={16} className="mt-0.5 shrink-0 text-[#7F40E8]" aria-hidden="true" />
                              <p>
                                 <span className="sr-only">With PurpleCallio: </span>
                                 <strong className="text-[#170B2E]">{r.feature}</strong>
                                 <span className="block">{r.detail}</span>
                              </p>
                           </div>
                        </li>
                     ))}
                  </ul>
               </div>
               <p className="mt-3 text-xs">Live Translate features are in early access.</p>
            </section>

            {/* 8. Pricing + 9. Developers */}
            <section className="mt-24 grid grid-cols-1 gap-6 lg:grid-cols-2" id="pricing">
               <Reveal variant="left" className="min-w-0 rounded-2xl border border-[#E7DFF5] p-7">
                  <h2 className="text-2xl font-bold text-[#170B2E]">Pricing</h2>
                  <p className="mt-3 text-sm">
                     One rate per minute for each person who has translation on (one side 1×, both sides 2×), in credits from your prepaid balance.
                     Same-language calls aren&apos;t charged for translation. Rates are set by PurpleCallio and shown here
                     and in your dashboard.
                  </p>
                  <TranslationRateList className="mt-5" />
                  <Link href="/pricing#costguard-calculator" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[#6425C4]">
                     Estimate costs with the CostGuard calculator <ArrowRight size={16} aria-hidden="true" />
                  </Link>
               </Reveal>
               <Reveal variant="right" delay={0.1} className="min-w-0 rounded-2xl border border-[#E7DFF5] p-7">
                  <h2 className="text-2xl font-bold text-[#170B2E]">Privacy and trust</h2>
                  <ul className="mt-5 space-y-3 text-sm" data-testid="lt-privacy">
                     {PRIVACY.map((p) => (
                        <li key={p.text} className="flex items-start gap-2">
                           <p.icon size={16} className="mt-0.5 shrink-0 text-[#7F40E8]" aria-hidden="true" />
                           {p.text}
                        </li>
                     ))}
                  </ul>
               </Reveal>
            </section>

            <section className="mt-24" id="developers">
               <Reveal>
                  <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">Developers</p>
                  <h2 className="mt-3 text-3xl font-bold text-[#170B2E]">One flag on the call you already create</h2>
                  <p className="mt-4 max-w-3xl">
                     Hosted UI users get translation with no code. Otherwise, add a <code>translation</code> block to{" "}
                     <code>POST /calls</code>, then use the SDK or the React components in the browser.
                  </p>
               </Reveal>
               <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <Reveal variant="left" className="min-w-0">
                     <p className="mb-3 text-sm font-semibold text-[#170B2E]">REST: create a translated call</p>
                     <CodeBlock code={LT_REST_CREATE} filename="request.sh" />
                  </Reveal>
                  <div className="min-w-0 space-y-6">
                     <Reveal variant="right" delay={0.1}>
                        <p className="mb-3 text-sm font-semibold text-[#170B2E]">Browser SDK</p>
                        <CodeBlock code={LT_SDK_EXAMPLE} filename="translation.ts" />
                     </Reveal>
                     <Reveal variant="right" delay={0.15}>
                        <p className="mb-3 text-sm font-semibold text-[#170B2E]">React UI Kit</p>
                        <CodeBlock code={LT_REACT_EXAMPLE} filename="TranslatedCall.tsx" />
                     </Reveal>
                  </div>
               </div>
               <Link href={LIVE_TRANSLATE_DOCS_PATH} className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[#6425C4]">
                  Read the Live Translate docs <ArrowRight size={16} aria-hidden="true" />
               </Link>
            </section>

            {/* 11. FAQ */}
            <Reveal as="section" amount={0.1} className="mt-24">
               <h2 className="text-3xl font-bold text-[#170B2E]">Frequently asked questions</h2>
               <div className="mt-8">
                  <FaqList items={LIVE_TRANSLATE_FAQ} />
               </div>
            </Reveal>

            {/* 12. CTA */}
            <Reveal as="section" variant="zoom-up" duration={0.8} className="mt-20 rounded-2xl border border-[#D6C4EE] bg-[#7F40E8]/5 p-8">
               <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6425C4]">
                  <Ear size={14} aria-hidden="true" /> {LIVE_TRANSLATE_STATUS}
               </p>
               <h2 className="mt-2 text-2xl font-bold text-[#170B2E]">Let your users talk to anyone</h2>
               <p className="mt-3 max-w-2xl">
                  Join early access and we&apos;ll enable Live Translate for your account. Tell us your language pairs
                  and use case, and we&apos;ll share measured results as they come in.
               </p>
               <div className="mt-6 flex flex-wrap gap-3">
                  <Link href={LIVE_TRANSLATE_SIGNUP} className="btn-primary rounded-lg px-5 py-3 text-sm font-medium text-white">
                     Join early access
                  </Link>
                  <Link href={LIVE_TRANSLATE_DOCS_PATH} className="rounded-lg border border-[#D6C4EE] px-5 py-3 text-sm font-medium text-[#3D3650]">
                     Live Translate docs
                  </Link>
                  <Link href="/features" className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6C4EE] px-5 py-3 text-sm font-medium text-[#3D3650]">
                     <Check size={14} aria-hidden="true" /> All features
                  </Link>
               </div>
            </Reveal>
         </div>
      </main>
   );
}
