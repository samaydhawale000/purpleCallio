import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import {
   ContentSection,
   PublicPage,
} from "../../components/marketing/PublicPage";
import { JsonLd } from "../../components/seo/JsonLd";
import { pageMetadata, siteUrl } from "../../lib/seo";
import {
   FeatureFlow,
   IntegrationSelector,
} from "../../components/marketing/InteractiveTools";
import { Reveal, RevealGroup, RevealItem } from "../../components/motion/Reveal";

const features = {
   "video-calling": {
      title: "Video Calling API for Your Application",
      meta: "Video Calling API | WebRTC Video SDK",
      description:
         "Add browser-based video calling with PurpleCallio's WebRTC API, hosted UI, React components, and headless SDK.",
      summary:
         "PurpleCallio is a developer-focused video calling API for products that need browser-based calls without assembling signaling, authentication, TURN, and meeting UI independently.",
      details: [
         "Create and manage calls through REST APIs, then connect participants with hosted UI or an interface built with the React or headless SDK.",
         "Video calls use WebRTC for browser media. PurpleCallio provides the surrounding call lifecycle, access, signaling, and relay infrastructure.",
      ],
      useCases: [
         "SaaS products",
         "Customer support",
         "Education",
         "Marketplaces",
      ],
      faq: [
         [
            "What is a video calling API?",
            "A video calling API gives an application the server-side and client-side building blocks needed to create calls and connect participants.",
         ],
         [
            "Can I use my own video call interface?",
            "Yes. Use React components for a composable interface or the headless SDK when your application owns the complete UI.",
         ],
         [
            "How is video usage measured?",
            "Video usage is measured in participant-minutes. Two participants in a ten-minute video call use twenty participant-minutes.",
         ],
      ],
   },
   "audio-calling": {
      title: "Audio Calling API for Web Applications",
      meta: "Audio Calling API | WebRTC Voice SDK",
      description:
         "Add browser audio calling with PurpleCallio's WebRTC APIs, hosted UI, React components, and headless SDK.",
      summary:
         "PurpleCallio provides a practical API path for adding real-time browser audio to web applications, with hosted UI and SDK choices for different product needs.",
      details: [
         "Audio calling follows the same server-controlled call lifecycle as video: your backend creates the call and issues participant access.",
         "Choose hosted UI for a ready-made meeting experience or use the React and headless SDKs to keep control of your product interface.",
      ],
      useCases: [
         "Customer support",
         "Sales workflows",
         "Education",
         "Marketplaces",
      ],
      faq: [
         [
            "Does audio calling use WebRTC?",
            "PurpleCallio uses WebRTC for browser media and provides the supporting signaling and connection infrastructure.",
         ],
         [
            "Can I start with hosted UI?",
            "Yes. Hosted UI lets your backend create a call and direct participants to a ready-made call page.",
         ],
         [
            "How is audio usage measured?",
            "Audio usage is measured in participant-minutes, with current allowances and rates listed on the pricing page.",
         ],
      ],
   },
   "screen-sharing": {
      title: "Add Screen Sharing to Your Application",
      meta: "Screen Sharing API & WebRTC SDK",
      description:
         "Add browser screen sharing to a calling experience with PurpleCallio's hosted UI, React components, and headless SDK.",
      summary:
         "PurpleCallio adds browser-native screen sharing to calling experiences through its hosted UI, React components, and headless SDK.",
      details: [
         "Participants select what to share through their browser's permission flow. Your interface can make the action available while the browser controls the final selection.",
         "Screen sharing can be used alongside a call and is tracked as its own participant-minute usage category.",
      ],
      useCases: [
         "Technical support",
         "Product demos",
         "Remote education",
         "Collaborative workflows",
      ],
      faq: [
         [
            "Does PurpleCallio support screen sharing?",
            "Yes. Screen sharing is available with hosted UI, React components, and the headless SDK.",
         ],
         [
            "Can an application choose what a participant shares?",
            "No. The participant chooses a screen, window, or tab through the browser's permission prompt.",
         ],
         [
            "Is screen sharing billed separately?",
            "Yes. It is billed in addition to video usage; see pricing for current rates.",
         ],
      ],
   },
   webrtc: {
      title: "WebRTC Infrastructure Without the Infrastructure Headache",
      meta: "WebRTC API & Infrastructure",
      description:
         "Use PurpleCallio's WebRTC APIs, signaling, TURN relay, hosted UI, React components, and headless SDK for real-time communication.",
      summary:
         "PurpleCallio is a developer-focused real-time communication platform that combines WebRTC media with APIs, authentication, signaling, TURN relay, SDKs, and optional hosted UI.",
      details: [
         "WebRTC handles peer media in the browser, but production integrations also need call state, access control, signaling, and reliable connectivity paths.",
         "PurpleCallio provides WebSocket signaling and time-limited TURN credentials, while letting teams choose hosted UI, React components, or a headless SDK.",
      ],
      useCases: [
         "Video calling products",
         "Audio calling workflows",
         "Screen-sharing experiences",
         "Embedded communication",
      ],
      faq: [
         [
            "What does PurpleCallio provide around WebRTC?",
            "PurpleCallio provides call APIs, authentication, WebSocket signaling, TURN relay, SDKs, and hosted UI around browser WebRTC media.",
         ],
         [
            "Do I need to build a call UI?",
            "No. Hosted UI is available, or you can use React components or the headless SDK for a custom interface.",
         ],
         [
            "What is TURN used for?",
            "TURN relays media when a direct peer connection is not possible, such as behind some restrictive networks.",
         ],
      ],
   },
} as const;

type Slug = keyof typeof features;
export function generateStaticParams() {
   return Object.keys(features).map((slug) => ({ slug }));
}
export async function generateMetadata({
   params,
}: {
   params: Promise<{ slug: string }>;
}): Promise<Metadata> {
   const { slug } = await params;
   const item = features[slug as Slug];
   return item
      ? pageMetadata({
           title: item.meta,
           description: item.description,
           path: `/features/${slug}`,
        })
      : {};
}

export default async function FeaturePage({
   params,
}: {
   params: Promise<{ slug: string }>;
}) {
   const { slug } = await params;
   const item = features[slug as Slug];
   if (!item) notFound();
   const path = `/features/${slug}`;
   const flowKind =
      slug === "video-calling"
         ? "video"
         : slug === "audio-calling"
           ? "audio"
           : slug === "screen-sharing"
             ? "screen"
             : "webrtc";
   return (
      <PublicPage
         eyebrow="PurpleCallio features"
         title={item.title}
         intro={item.summary}
         crumbs={[
            { label: "Home", href: "/" },
            { label: "Features", href: "/features" },
            { label: item.title, href: path },
         ]}
      >
         <JsonLd
            data={[
               {
                  "@context": "https://schema.org",
                  "@type": "WebPage",
                  name: item.title,
                  url: new URL(path, siteUrl).toString(),
                  description: item.description,
                  about: {
                     "@type": "Organization",
                     name: "PurpleCallio",
                     url: siteUrl.toString(),
                  },
               },
               {
                  "@context": "https://schema.org",
                  "@type": "FAQPage",
                  mainEntity: item.faq.map(([name, text]) => ({
                     "@type": "Question",
                     name,
                     acceptedAnswer: { "@type": "Answer", text },
                  })),
               },
            ]}
         />
         <Reveal>
            <ContentSection
               title={`What is PurpleCallio ${item.title.replace(" for Your Application", "").replace("Add ", "")}?`}
            >
               <p>{item.summary}</p>
            </ContentSection>
         </Reveal>
         <Reveal>
            <ContentSection title="How it works">
               <p>Select a stage to understand the workflow.</p>
               <FeatureFlow kind={flowKind} />
               <ol className="list-decimal space-y-2 pl-5">
                  <li>Create and manage the call from trusted backend code.</li>
                  <li>
                     Issue participant-specific access as part of your application
                     flow.
                  </li>
                  <li>
                     Connect participants through hosted UI, React components, or
                     the headless SDK.
                  </li>
                  <li>
                     Use your product UI to manage media controls and call state.
                  </li>
               </ol>
            </ContentSection>
         </Reveal>
         <Reveal variant="left">
            <ContentSection title="Technical capabilities">
               {item.details.map((detail) => (
                  <p key={detail}>{detail}</p>
               ))}
               <p>
                  PurpleCallio supports REST API call management, WebSocket
                  signaling, authentication, TURN relay, camera and microphone
                  controls, device selection, and screen sharing where applicable.
               </p>
            </ContentSection>
         </Reveal>
         <Reveal>
            <ContentSection title="Choose your integration">
               <p>
                  Compare the three integration surfaces, their responsibilities,
                  and a copyable starting point.
               </p>
               <IntegrationSelector />
            </ContentSection>
         </Reveal>
         <Reveal>
            <ContentSection title="Common use cases">
               <RevealGroup as="ul" stagger={0.08} className="list-disc space-y-2 pl-5">
                  {item.useCases.map((useCase) => (
                     <RevealItem as="li" key={useCase} variant="left">{useCase}</RevealItem>
                  ))}
               </RevealGroup>
            </ContentSection>
         </Reveal>
         <Reveal>
            <ContentSection title="Security and pricing">
               <p>
                  Keep API keys on your server and issue only participant-specific
                  access to clients. Webhook requests should be verified before
                  your application processes them. Usage is measured in
                  participant-minutes; see pricing for allowances and current
                  rates.
               </p>
            </ContentSection>
         </Reveal>
         <Reveal>
            <ContentSection title="Frequently asked questions">
               {item.faq.map(([question, answer]) => (
                  <article key={question}>
                     <h3 className="font-semibold text-[#3D3650]">{question}</h3>
                     <p>{answer}</p>
                  </article>
               ))}
            </ContentSection>
         </Reveal>
         <Reveal variant="fade">
            <ContentSection title="Related resources">
               <div className="flex flex-wrap gap-4">
                  <Link
                     href="/features"
                     className="text-[#6425C4] hover:text-[#170B2E]"
                  >
                     All features →
                  </Link>
                  <Link
                     href="/features/ai-voice-agents"
                     className="text-[#6425C4] hover:text-[#170B2E]"
                  >
                     AI voice agents →
                  </Link>
                  <Link
                     href="/docs/quickstart"
                     className="text-[#6425C4] hover:text-[#170B2E]"
                  >
                     Quickstart →
                  </Link>
                  <Link
                     href="/docs/react"
                     className="text-[#6425C4] hover:text-[#170B2E]"
                  >
                     React SDK →
                  </Link>
                  <Link
                     href="/docs/javascript"
                     className="text-[#6425C4] hover:text-[#170B2E]"
                  >
                     JavaScript SDK →
                  </Link>
                  <Link
                     href="/pricing"
                     className="text-[#6425C4] hover:text-[#170B2E]"
                  >
                     Pricing →
                  </Link>
               </div>
            </ContentSection>
         </Reveal>
      </PublicPage>
   );
}
