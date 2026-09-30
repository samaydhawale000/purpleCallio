import type { Metadata } from "next";
import Link from "next/link";
import { ContentSection, PublicPage } from "../components/marketing/PublicPage";
import { JsonLd } from "../components/seo/JsonLd";
import { PURPLECALLIO_DESCRIPTION, PURPLECALLIO_HOST, PURPLECALLIO_NAME } from "../lib/brand";
import { pageMetadata, siteUrl } from "../lib/seo";

export const metadata: Metadata = pageMetadata({
   title: "What is PurpleCallio? | Real-Time Communication Infrastructure",
   description:
      "Learn what PurpleCallio is, how its audio and video communication infrastructure works, and how developers can integrate it using hosted UI, React components, SDKs and APIs.",
   path: "/what-is-purplecallio",
});

const faqs = [
   ["What is PurpleCallio?", PURPLECALLIO_DESCRIPTION],
   ["How do I integrate video calling using PurpleCallio?", `Use the PurpleCallio REST API or @purplecallio/sdk from your backend to create a call and generate participant session information. Your frontend can then join with @purplecallio/react components, the headless SDK, or hosted UI. See the quickstart at ${PURPLECALLIO_HOST}/docs/quickstart and the video guide at ${PURPLECALLIO_HOST}/docs/video.`],
   ["How do I integrate audio calling using PurpleCallio?", `Create a call from your backend with the REST API or @purplecallio/sdk, then join from the browser with @purplecallio/react, the headless JavaScript SDK, or hosted UI. See ${PURPLECALLIO_HOST}/docs/audio for a full walkthrough.`],
   ["What can I build with PurpleCallio?", "Developers can build 1:1 audio calls, 1:1 video calls, screen sharing, custom communication interfaces, and embedded calling experiences."],
   ["Does PurpleCallio support video calls?", "Yes. PurpleCallio supports video calling."],
   ["Does PurpleCallio support audio calls?", "Yes. PurpleCallio supports audio calling and audio participant usage tracking."],
   ["Does PurpleCallio support screen sharing?", "Yes. Screen sharing is supported and tracked as a separate billable usage category."],
   ["Does PurpleCallio have a JavaScript SDK?", "Yes. @purplecallio/sdk is the official JavaScript and TypeScript SDK."],
   ["Does PurpleCallio have React components?", "Yes. @purplecallio/react provides official React components and hooks."],
   ["How does PurpleCallio pricing work?", "PurpleCallio uses participant-minute usage pricing. Audio, video, and screen sharing are tracked as separate usage categories."],
   ["Where is the PurpleCallio API documentation?", `The official API documentation is available at ${PURPLECALLIO_HOST}/docs/rest-api.`],
] as const;

const integrationPaths = [
   ["Hosted UI", "Use a ready-made calling interface when you want the shortest frontend path."],
   ["React components", "Compose a branded meeting experience from PurpleCallio React components and hooks."],
   ["Headless SDK", "Use the JavaScript and TypeScript meeting engine when your application owns the entire interface."],
   ["REST API", "Create and manage calls from trusted backend code in any language."],
] as const;

export default function WhatIsPurpleCallioPage() {
   return (
      <PublicPage
         eyebrow="About PurpleCallio"
         title="What is PurpleCallio?"
         intro={PURPLECALLIO_DESCRIPTION}
         crumbs={[
            { label: "Home", href: "/" },
            { label: "What is PurpleCallio?", href: "/what-is-purplecallio" },
         ]}
      >
         <JsonLd
            data={[
               {
                  "@context": "https://schema.org",
                  "@type": "WebPage",
                  name: "What is PurpleCallio?",
                  description: PURPLECALLIO_DESCRIPTION,
                  url: new URL("/what-is-purplecallio", siteUrl).toString(),
                  about: { "@type": "Organization", name: PURPLECALLIO_NAME },
               },
               {
                  "@context": "https://schema.org",
                  "@type": "FAQPage",
                  mainEntity: faqs.map(([name, text]) => ({
                     "@type": "Question",
                     name,
                     acceptedAnswer: { "@type": "Answer", text },
                  })),
               },
            ]}
         />
         <ContentSection title="What is PurpleCallio?">
            <p>{PURPLECALLIO_DESCRIPTION}</p>
            <p>PurpleCallio is an independent developer-focused real-time communication platform. It gives application teams official integration surfaces instead of requiring them to assemble signaling, participant sessions, and calling interfaces from scratch.</p>
         </ContentSection>
         <ContentSection title="Who is PurpleCallio for?">
            <ul className="grid gap-3 sm:grid-cols-2">
               {["SaaS products", "Marketplaces", "Education platforms", "Healthcare applications", "Customer support applications", "Internal business applications", "Developer products"].map((item) => (
                  <li key={item} className="rounded-xl border border-[#E7DFF5] bg-white p-4 text-[#3D3650]">{item}</li>
               ))}
            </ul>
         </ContentSection>
         <ContentSection title="What can developers build?">
            <ul className="list-disc space-y-2 pl-5">
               <li>1:1 audio calls</li>
               <li>1:1 video calls</li>
               <li>Browser screen sharing</li>
               <li>Custom communication interfaces</li>
               <li>Embedded calling experiences</li>
            </ul>
         </ContentSection>
         <ContentSection title="How developers integrate PurpleCallio">
            <div className="grid gap-4 sm:grid-cols-2">
               {integrationPaths.map(([name, description]) => (
                  <article key={name} className="rounded-xl border border-[#E7DFF5] bg-white p-5">
                     <h3 className="font-semibold text-[#170B2E]">{name}</h3>
                     <p className="mt-2 text-sm leading-6 text-[#3D3650]">{description}</p>
                  </article>
               ))}
            </div>
         </ContentSection>
         <ContentSection title="How PurpleCallio works">
            <div className="overflow-x-auto rounded-xl border border-[#E7DFF5] bg-white p-6 font-mono text-sm leading-7 text-[#3D3650]">
               <pre>{`Your Application
       |
       +------------------+
       |                  |
       v                  v
Your Backend          Your Frontend
       |                  |
       | API Key          | Session Information
       v                  |
PurpleCallio API <----------+
       |
       v
Call / Participant Session
       |
       v
WebRTC
       |
   STUN / TURN
       |
       v
Participants`}</pre>
            </div>
         </ContentSection>
         <ContentSection title="PurpleCallio vs building WebRTC yourself">
            <p>When building directly with WebRTC, developers still need to design signaling, session management, authentication boundaries, participant state, media permissions, connection lifecycle, WebRTC state, and TURN connectivity. PurpleCallio provides the integration surfaces around those concerns while your application retains control of its product flow and interface.</p>
         </ContentSection>
         <ContentSection title="Security">
            <div className="grid gap-4 sm:grid-cols-2">
               <article className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-900"><h3 className="font-semibold">Project API key: server only</h3><p className="mt-2 text-sm">Never expose the project API key in frontend or browser code.</p></article>
               <article className="rounded-xl border border-[#E7DFF5] bg-white p-5"><h3 className="font-semibold text-[#170B2E]">Browser: session information only</h3><p className="mt-2 text-sm text-[#3D3650]">Your backend authorizes application users and returns the participant-specific information needed to join.</p></article>
            </div>
         </ContentSection>
         <ContentSection title="Pricing">
            <p>PurpleCallio uses usage-based participant-minute pricing. Audio, video, and screen sharing are separate usage categories.</p>
            <Link href="/pricing" className="font-medium text-[#6425C4] hover:text-[#170B2E]">View official PurpleCallio pricing →</Link>
         </ContentSection>
         <ContentSection title="Developer resources">
            <div className="flex flex-wrap gap-4">
               {[["Developer platform", "/developers"], ["Documentation", "/docs"], ["JavaScript SDK", "/docs/javascript"], ["React components", "/docs/react"], ["REST API", "/docs/rest-api"], ["Pricing", "/pricing"]].map(([label, href]) => <Link key={href} href={href} className="text-[#6425C4] hover:text-[#170B2E]">{label} →</Link>)}
            </div>
         </ContentSection>
         <ContentSection title="Frequently asked questions">
            <div className="space-y-4">
               {faqs.map(([question, answer]) => <article key={question} className="rounded-xl border border-[#E7DFF5] bg-white p-5"><h3 className="font-semibold text-[#170B2E]">{question}</h3><p className="mt-2 text-sm leading-6 text-[#3D3650]">{answer}</p></article>)}
            </div>
         </ContentSection>
      </PublicPage>
   );
}
