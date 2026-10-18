import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, Sparkles, Wrench, Server, Mic } from "lucide-react";
import {
   ArchitectureExplorer,
   IntegrationSelector,
} from "../components/marketing/InteractiveTools";
import { ContentSection, PublicPage } from "../components/marketing/PublicPage";
import { JsonLd } from "../components/seo/JsonLd";
import { pageMetadata, siteUrl } from "../lib/seo";
import { sdks } from "../lib/sdks";

const AI_STEPS = [
   {
      icon: Bot,
      title: "Configure an agent",
      body: "Instructions, greeting, voice, language and tools, set in the dashboard.",
      href: "/docs/ai-agents#tools",
   },
   {
      icon: Server,
      title: "Create a session on your server",
      body: "client.ai.createSession() returns a short-lived token for the browser.",
      href: "/docs/ai-agents#server-session",
   },
   {
      icon: Mic,
      title: "Talk to it in the browser",
      body: "Use the headless PurpleCallioAgentCall or the drop-in React component.",
      href: "/docs/ai-agents#browser-sdk",
   },
   {
      icon: Wrench,
      title: "Let it call your APIs",
      body: "Signed tool requests to your endpoints, with optional user confirmation.",
      href: "/docs/ai-agents#tool-signatures",
   },
] as const;

export const metadata: Metadata = pageMetadata({
   title: "Developer Platform: Video, Audio & AI Voice",
   description:
      "Choose PurpleCallio hosted UI, React components or a headless SDK to add video, audio, screen sharing and AI voice agents to your application.",
   path: "/developers",
});

const tools = [
   [
      "REST API",
      "Create and manage calls from trusted backend code.",
      "/docs/rest-api",
   ],
   [
      "React SDK",
      "Compose a branded call interface from reusable components.",
      "/docs/react",
   ],
   [
      "JavaScript SDK",
      "Build a fully custom meeting experience with the headless engine.",
      "/docs/javascript",
   ],
   [
      "Hosted UI",
      "Send authorized participants to a ready-made meeting interface.",
      "/docs/hosted-ui",
   ],
   [
      "Webhooks",
      "Synchronize your backend with signed call-state notifications.",
      "/docs/webhooks",
   ],
   [
      "Screen sharing",
      "Add browser-native sharing to a communication experience.",
      "/docs/screen-sharing",
   ],
   [
      "AI voice agents",
      "Real-time voice agents that talk to users and call your APIs.",
      "/docs/ai-agents",
   ],
] as const;

export default function DevelopersPage() {
   return (
      <PublicPage
         eyebrow="For developers"
         title="Build real-time communication into your application."
         intro="Add audio, video, screen sharing and AI voice agents using PurpleCallio's hosted UI, React components, headless SDK or REST APIs."
         crumbs={[
            { label: "Home", href: "/" },
            { label: "Developers", href: "/developers" },
         ]}
      >
         <JsonLd
            data={{
               "@context": "https://schema.org",
               "@type": "SoftwareApplication",
               name: "PurpleCallio",
               applicationCategory: "DeveloperApplication",
               operatingSystem: "Web",
               url: new URL("/developers", siteUrl).toString(),
               description:
                  "Developer tools for integrating real-time audio, video, screen sharing and AI voice agents.",
            }}
         />
         <section
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            aria-label="Integration paths"
         >
            {[
               [
                  "Hosted UI",
                  "Fastest integration",
                  "A ready-made meeting interface.",
               ],
               [
                  "React",
                  "Custom UI",
                  "Composable components for React products.",
               ],
               [
                  "Headless SDK",
                  "Full control",
                  "The engine beneath your own interface.",
               ],
               [
                  "REST API",
                  "Backend integration",
                  "Create and manage calls from any trusted server environment.",
               ],
            ].map(([name, label, description]) => (
               <article
                  key={name}
                  className="rounded-2xl border border-[#E7DFF5] bg-white p-6"
               >
                  <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">
                     {label}
                  </p>
                  <h2 className="mt-3 text-xl font-bold text-[#170B2E]">{name}</h2>
                  <p className="mt-2 text-sm leading-6 text-[#3D3650]">
                     {description}
                  </p>
               </article>
            ))}
         </section>
         <section
            id="ai-voice-agents"
            aria-labelledby="ai-voice-agents-title"
            className="relative overflow-hidden rounded-3xl p-6 text-white sm:p-10"
            style={{ background: "radial-gradient(120% 90% at 0% 0%, #8B4DF0 0%, #5B1BB5 45%, #2B0F52 100%)" }}
         >
            <div className="flex flex-wrap items-start justify-between gap-6">
               <div className="max-w-2xl">
                  <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                     <Sparkles size={14} aria-hidden="true" /> New · AI Voice Agents
                  </p>
                  <h2 id="ai-voice-agents-title" className="mt-4 text-2xl font-bold sm:text-3xl">
                     Build AI voice agents with the same API keys and SDK.
                  </h2>
                  <p className="mt-3 leading-7 text-white/80">
                     Real-time, interruptible voice conversations that look things up and take actions
                     through your own APIs. PurpleCallio runs the audio relay, the model connection, tool
                     calls, transcripts and per-minute credit billing. Available on paid plans.
                  </p>
               </div>
               <Link
                  href="/docs/ai-agents"
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#5B1BB5] transition-all hover:-translate-y-0.5"
               >
                  Read the AI agents docs <ArrowRight size={16} aria-hidden="true" />
               </Link>
            </div>

            <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
               {AI_STEPS.map((step, i) => (
                  <li key={step.title}>
                     <Link
                        href={step.href}
                        className="group flex h-full flex-col rounded-2xl bg-white/10 p-5 ring-1 ring-white/20 transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                     >
                        <span className="flex items-center justify-between">
                           <step.icon size={20} aria-hidden="true" />
                           <span className="font-mono text-xs text-white/60">0{i + 1}</span>
                        </span>
                        <span className="mt-4 font-semibold">{step.title}</span>
                        <span className="mt-1 flex-1 text-sm leading-6 text-white/75">{step.body}</span>
                        <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-white/90">
                           Read this step
                           <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        </span>
                     </Link>
                  </li>
               ))}
            </ol>

            <pre className="mt-6 overflow-x-auto rounded-2xl bg-[#1A0B33]/70 p-5 font-mono text-[13px] leading-6 text-white/90 ring-1 ring-white/10">
               <code>{`// Server: create a session with your API key
const { token } = await client.ai.createSession({ agentId, participant: { id: user.id } });

// Browser: start the conversation from a click
const call = new PurpleCallioAgentCall({ token, apiUrl });
await call.start();`}</code>
            </pre>

            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
               <Link href="/docs/ai-agents#react" className="text-white/85 hover:text-white">React hook &amp; component →</Link>
               <Link href="/docs/ai-agents#errors" className="text-white/85 hover:text-white">Error codes →</Link>
               <Link href="/docs/ai-agents#limits" className="text-white/85 hover:text-white">Limits →</Link>
               <Link href="/features/ai-voice-agents" className="text-white/85 hover:text-white">Use cases &amp; overview →</Link>
            </div>
         </section>
         <ContentSection title="Official SDKs for every platform">
            <p>
               The React path above is one of several client SDKs. Available
               packages share the same participant-token security and call
               protocol, with connection state, participants, and platform
               media controls exposed through idiomatic APIs.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
               {sdks
                  .filter((sdk) => sdk.status === "available")
                  .map((sdk) => (
                     <Link
                        key={sdk.platform}
                        href={sdk.href!}
                        className="rounded-xl border border-[#E7DFF5] p-5 transition hover:border-[#A05DF9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#A05DF9]"
                     >
                        <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">
                           {sdk.package}
                        </p>
                        <h3 className="mt-2 font-semibold text-[#170B2E]">
                           {sdk.platform} <span className="text-[#6425C4]">→</span>
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-[#3D3650]">
                           {sdk.description}
                        </p>
                     </Link>
                  ))}
            </div>
            <p className="text-sm text-[#3D3650]">
               Flutter, iOS, and Android SDK implementations are available for
               preview but have not completed release validation. See{" "}
               <Link href="/sdks" className="text-[#6425C4] hover:text-[#170B2E]">
                  the full SDK list
               </Link>{" "}
               for current status.
            </p>
         </ContentSection>
         <ContentSection title="Choose the integration that fits your product">
            <p>
               Start with the amount of frontend control you need. Every path
               keeps call creation and authorization in your backend.
            </p>
            <IntegrationSelector />
         </ContentSection>
         <ContentSection title="How the pieces connect">
            <p>
               Select a node to see its role in a production communication flow.
               PurpleCallio works around browser WebRTC; it does not replace the
               browser media layer.
            </p>
            <ArchitectureExplorer />
         </ContentSection>
         <ContentSection title="What do I actually have to build?">
            <div className="grid gap-4 md:grid-cols-3">
               {[
                  [
                     "Hosted UI",
                     "You build authentication, business logic, and call creation.",
                     "PurpleCallio handles the meeting UI, media controls, signaling, WebRTC setup, and TURN relay.",
                  ],
                  [
                     "React",
                     "You build your product layout, business logic, and branded UI.",
                     "PurpleCallio handles participant state, media streams, controls, and the connection lifecycle.",
                  ],
                  [
                     "Headless SDK",
                     "You control the full UI, interactions, and application state.",
                     "PurpleCallio provides the communication engine, signaling, WebRTC media lifecycle, and relay path.",
                  ],
               ].map(([name, build, handles]) => (
                  <article
                     key={name}
                     className="rounded-xl border border-[#E7DFF5] p-5"
                  >
                     <h3 className="font-semibold text-[#170B2E]">{name}</h3>
                     <p className="mt-3 text-sm text-[#3D3650]">
                        <strong className="text-[#3D3650]">You build:</strong>{" "}
                        {build}
                     </p>
                     <p className="mt-3 text-sm text-[#3D3650]">
                        <strong className="text-[#3D3650]">
                           PurpleCallio handles:
                        </strong>{" "}
                        {handles}
                     </p>
                  </article>
               ))}
            </div>
         </ContentSection>
         <ContentSection title="Developer toolbox">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
               {tools.map(([name, description, href]) => (
                  <Link
                     key={name}
                     href={href}
                     className="rounded-xl border border-[#E7DFF5] p-5 transition hover:border-[#A05DF9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#A05DF9]"
                  >
                     <h3 className="font-semibold text-[#170B2E]">
                        {name} <span className="text-[#6425C4]">→</span>
                     </h3>
                     <p className="mt-2 text-sm leading-6 text-[#3D3650]">
                        {description}
                     </p>
                  </Link>
               ))}
            </div>
         </ContentSection>
         <ContentSection title="Start with a server-controlled call">
            <p>
               Keep API keys on the server, issue participant-specific access
               only after your application authorizes a user, and then choose
               the meeting surface that fits the product.
            </p>
            <div className="flex flex-wrap gap-4">
               <Link
                  href="/docs/quickstart"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  Read the quickstart →
               </Link>
               <Link
                  href="/pricing"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  Understand usage pricing →
               </Link>
            </div>
         </ContentSection>
      </PublicPage>
   );
}
