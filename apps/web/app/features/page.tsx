import Link from "next/link";
import { ArrowRight, Check, Languages } from "lucide-react";
import { LIVE_TRANSLATE_PATH, LIVE_TRANSLATE_STATUS } from "../lib/live-translate";
import { Breadcrumbs } from "../components/seo/Breadcrumbs";
import { JsonLd } from "../components/seo/JsonLd";
import { pageMetadata, siteUrl } from "../lib/seo";
import { CORE_FEATURES, PLATFORM_FEATURES } from "../lib/feature-catalog";
import { Reveal, RevealGroup, RevealItem } from "../components/motion/Reveal";

export const metadata = pageMetadata({
   title: "Features: Video, Audio & AI Voice Agents",
   description:
      "PurpleCallio features: browser video calling, audio calling and real-time AI voice agents, plus screen sharing, signaling and TURN relay.",
   path: "/features",
});

export default function FeaturesPage() {
   return (
      <main className="min-h-screen bg-white px-6 pb-24 pt-28 text-[#3D3650]">
         <JsonLd
            data={{
               "@context": "https://schema.org",
               "@type": "ItemList",
               name: "PurpleCallio features",
               itemListElement: CORE_FEATURES.map((f, i) => ({
                  "@type": "ListItem",
                  position: i + 1,
                  name: f.name,
                  url: new URL(`/features/${f.slug}`, siteUrl).toString(),
               })),
            }}
         />
         <div className="mx-auto max-w-6xl">
            <Breadcrumbs
               items={[
                  { label: "Home", href: "/" },
                  { label: "Features", href: "/features" },
               ]}
            />
            <p className="mb-4 font-mono text-xs uppercase tracking-widest text-[#6425C4]">
               PurpleCallio features
            </p>
            <h1 className="max-w-4xl text-4xl font-bold tracking-tight text-[#170B2E] md:text-5xl">
               Three ways to talk to your users, one platform.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8">
               Add video calls, audio calls, or an AI voice agent that answers for you. They share the
               same API keys, dashboard, webhooks and prepaid credit balance, so you can start with one
               and add the others when you need them.
            </p>

            <RevealGroup stagger={0.12} className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
               {CORE_FEATURES.map((f) => {
                  const ai = f.slug === "ai-voice-agents";
                  return (
                     <RevealItem key={f.slug} variant="zoom-up" duration={0.7} className="h-full">
                     <Link
                        href={`/features/${f.slug}`}
                        data-testid={`feature-card-${f.slug}`}
                        className={`group relative flex h-full flex-col rounded-2xl border p-7 transition-all hover:-translate-y-1 ${
                           ai
                              ? "border-transparent text-white shadow-[0_24px_60px_-12px_rgba(65,6,134,0.45)]"
                              : "border-[#E7DFF5] bg-white hover:border-[#D6C4EE] hover:shadow-[0_20px_45px_-20px_rgba(65,6,134,0.25)]"
                        }`}
                        style={
                           ai
                              ? { background: "radial-gradient(120% 80% at 0% 0%, #8B4DF0 0%, #5B1BB5 45%, #2B0F52 100%)" }
                              : undefined
                        }
                     >
                        <div className="flex items-center justify-between">
                           <span
                              className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                                 ai ? "bg-white/15 text-white" : "bg-[#7F40E8]/10 text-[#7F40E8]"
                              }`}
                           >
                              <f.icon size={24} aria-hidden="true" />
                           </span>
                           {f.badge && (
                              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#5B1BB5]">
                                 {f.badge}
                              </span>
                           )}
                        </div>
                        <h2 className={`mt-6 text-xl font-bold ${ai ? "text-white" : "text-[#170B2E]"}`}>{f.name}</h2>
                        <p className={`mt-1 text-sm font-medium ${ai ? "text-white/85" : "text-[#3D3650]"}`}>
                           {f.tagline}
                        </p>
                        <p className={`mt-4 text-sm leading-relaxed ${ai ? "text-white/75" : "text-[#3D3650]"}`}>
                           {f.body}
                        </p>
                        <ul className="mt-6 flex-1 space-y-2">
                           {f.highlights.map((h) => (
                              <li key={h} className="flex items-start gap-2 text-sm">
                                 <Check
                                    size={16}
                                    className={`mt-0.5 shrink-0 ${ai ? "text-white" : "text-[#7F40E8]"}`}
                                    aria-hidden="true"
                                 />
                                 <span className={ai ? "text-white/90" : ""}>{h}</span>
                              </li>
                           ))}
                        </ul>
                        <span
                           className={`mt-8 inline-flex items-center gap-1.5 text-sm font-semibold ${
                              ai ? "text-white" : "text-[#6425C4]"
                           }`}
                        >
                           Learn more about {f.name}
                           <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
                        </span>
                     </Link>
                     </RevealItem>
                  );
               })}
            </RevealGroup>

            <Reveal variant="zoom-up" duration={0.7} className="mt-6">
               <Link
                  href={LIVE_TRANSLATE_PATH}
                  data-testid="feature-card-live-translation"
                  className="group flex flex-col gap-6 rounded-2xl border border-[#D6C4EE] bg-[#7F40E8]/5 p-7 transition-all hover:-translate-y-1 hover:shadow-[0_20px_45px_-20px_rgba(65,6,134,0.25)] md:flex-row md:items-center"
               >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#7F40E8]/10 text-[#7F40E8]">
                     <Languages size={24} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                     <span className="flex flex-wrap items-center gap-2">
                        <span className="text-xl font-bold text-[#170B2E]">Live Translate</span>
                        <span className="rounded-full bg-[#7F40E8] px-2 py-0.5 text-[10px] font-semibold text-white">New</span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">{LIVE_TRANSLATE_STATUS}</span>
                     </span>
                     <span className="mt-1 block text-sm font-medium">Real-time voice translation and captions for 1:1 calls</span>
                     <span className="mt-2 block text-sm leading-relaxed">
                        Each person hears and reads the other in their own language, with DualView Translation, PurpleLex,
                        MeaningGuard, Translation Observability, CostGuard, Post-Call Suite and the Translation UI Kit.
                     </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[#6425C4]">
                     Explore Live Translate
                     <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </span>
               </Link>
            </Reveal>

            <section className="mt-20">
               <Reveal>
                  <h2 className="text-2xl font-bold text-[#170B2E]">Included with every call</h2>
                  <p className="mt-3 max-w-3xl">
                     The infrastructure underneath video and audio calls, available on every plan.
                  </p>
               </Reveal>
               <RevealGroup stagger={0.08} className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {PLATFORM_FEATURES.map((f) => (
                     <RevealItem key={f.slug} variant="scale" className="h-full">
                     <Link
                        href={`/features/${f.slug}`}
                        className="group flex h-full items-start gap-4 rounded-xl border border-[#E7DFF5] p-5 transition-colors hover:border-[#D6C4EE]"
                     >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#7F40E8]/10 text-[#7F40E8]">
                           <f.icon size={20} aria-hidden="true" />
                        </span>
                        <span>
                           <span className="flex items-center gap-1.5 font-semibold text-[#170B2E]">
                              {f.name}
                              <ArrowRight size={14} className="text-[#6425C4] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                           </span>
                           <span className="mt-1 block text-sm leading-relaxed">{f.body}</span>
                        </span>
                     </Link>
                     </RevealItem>
                  ))}
               </RevealGroup>
            </section>

            <Reveal as="section" variant="zoom-up" duration={0.8} className="mt-16 rounded-2xl border border-[#D6C4EE] bg-[#7F40E8]/5 p-8">
               <h2 className="text-2xl font-bold text-[#170B2E]">Not sure where to start?</h2>
               <p className="mt-3 max-w-2xl">
                  Create an account, add prepaid credits when you need them, and use one wallet across eligible
                  calling and AI features. Feature consumption rates are shown before you buy.
               </p>
               <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/signup" className="btn-primary rounded-lg px-5 py-3 text-sm font-medium text-white">
                     Create a free account
                  </Link>
                  <Link href="/pricing" className="rounded-lg border border-[#D6C4EE] px-5 py-3 text-sm font-medium text-[#3D3650]">
                     Explore pricing
                  </Link>
               </div>
            </Reveal>
         </div>
      </main>
   );
}
