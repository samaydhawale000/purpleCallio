import type { Metadata } from "next";
import Link from "next/link";
import {
   ArchitectureExplorer,
   IntegrationSelector,
} from "../components/marketing/InteractiveTools";
import { ContentSection, PublicPage } from "../components/marketing/PublicPage";
import { JsonLd } from "../components/seo/JsonLd";
import { pageMetadata, siteUrl } from "../lib/seo";
import { sdks } from "../lib/sdks";

export const metadata: Metadata = pageMetadata({
   title: "PurpleCallio Developer Platform | Audio, Video & WebRTC",
   description:
      "Choose PurpleCallio hosted UI, React components, or a headless SDK to add audio, video, screen sharing, and WebRTC communication to your application.",
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
] as const;

export default function DevelopersPage() {
   return (
      <PublicPage
         eyebrow="For developers"
         title="Build real-time communication into your application."
         intro="Add audio, video and screen sharing using PurpleCallio's hosted UI, React components, headless SDK or REST APIs."
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
                  "Developer tools for integrating real-time audio, video, and screen sharing.",
            }}
         />
         <section
            className="grid gap-4 md:grid-cols-3"
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
