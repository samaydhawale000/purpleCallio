import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage, ContentSection } from "../components/marketing/PublicPage";
import { JsonLd } from "../components/seo/JsonLd";
import { pageMetadata, siteUrl } from "../lib/seo";
import { PURPLECALLIO_NPM } from "../lib/brand";
import { sdks } from "../lib/sdks";

export const metadata: Metadata = pageMetadata({
   title: "PurpleCallio Developer SDKs | Voice & Video for Every Platform",
   description:
      "Add real-time voice and video communication to JavaScript, React, Angular, React Native, Vue, and Svelte apps with PurpleCallio's official SDKs, built on a developer-first WebRTC platform.",
   path: "/sdks",
});

export default function SdksPage() {
   const available = sdks.filter((s) => s.status === "available");
   const comingSoon = sdks.filter((s) => s.status === "coming-soon");

   return (
      <PublicPage
         eyebrow="Developer SDKs"
         title="Build real-time communication into your application."
         intro="Official PurpleCallio SDKs give you the same call engine — connection handling, signaling, and WebRTC media — with an API that feels native to the platform you're already building on."
         crumbs={[
            { label: "Home", href: "/" },
            { label: "SDKs", href: "/sdks" },
         ]}
      >
         <JsonLd
            data={{
               "@context": "https://schema.org",
               "@type": "SoftwareApplication",
               name: "PurpleCallio SDKs",
               applicationCategory: "DeveloperApplication",
               operatingSystem: "Web, iOS, Android",
               url: new URL("/sdks", siteUrl).toString(),
               description:
                  "Official PurpleCallio SDKs for JavaScript, React, Angular, and React Native, for adding real-time voice and video communication to an application.",
            }}
         />

         <ContentSection title="Available now">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
               {available.map((sdk) => (
                  <Link
                     key={sdk.platform}
                     href={sdk.href!}
                     className="rounded-2xl border border-[#E7DFF5] bg-white p-6 transition hover:border-[#A05DF9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#A05DF9]"
                  >
                     <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">
                        {sdk.package}
                     </p>
                     <h3 className="mt-3 text-xl font-bold text-[#170B2E]">
                        {sdk.platform} <span className="text-[#6425C4]">→</span>
                     </h3>
                     <p className="mt-2 text-sm leading-6 text-[#3D3650]">
                        {sdk.description}
                     </p>
                  </Link>
               ))}
            </div>
         </ContentSection>

         <ContentSection title="Coming soon">
            <p>
               These platforms use the same underlying call model — rooms,
               participants, connection state, and media controls — but
               aren&apos;t ready for production use yet. They aren&apos;t
               published, and we don&apos;t recommend building on them until
               they are.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
               {comingSoon.map((sdk) => (
                  <div
                     key={sdk.platform}
                     className="rounded-2xl border border-dashed border-[#E7DFF5] bg-[#F8F4FD] p-6 opacity-80"
                  >
                     <p className="font-mono text-xs uppercase tracking-widest text-[#3D3650]">
                        {sdk.package}
                     </p>
                     <h3 className="mt-3 text-xl font-bold text-[#170B2E]">
                        {sdk.platform}
                     </h3>
                     <p className="mt-2 text-sm leading-6 text-[#3D3650]">
                        {sdk.description}
                     </p>
                  </div>
               ))}
            </div>
         </ContentSection>

         <ContentSection title="Every SDK, one conceptual model">
            <p>
               Whichever platform you build on, the underlying concepts stay
               the same: a participant token from your backend (never an API
               key), a call, a connection-state lifecycle, participants, and
               camera/microphone/screen-share controls. Learn the model once
               in the{" "}
               <Link href="/docs/quickstart" className="text-[#6425C4] hover:text-[#170B2E]">
                  quickstart
               </Link>{" "}
               and it carries over to every platform above.
            </p>
            <p>
               All packages are published under{" "}
               <Link
                  href={PURPLECALLIO_NPM}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  @purplecallio on npm
               </Link>
               .
            </p>
         </ContentSection>
      </PublicPage>
   );
}
