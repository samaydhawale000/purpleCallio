import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CodeBlock } from "../../components/marketing/InteractiveTools";
import { ContentSection, PublicPage } from "../../components/marketing/PublicPage";
import { pageMetadata } from "../../lib/seo";

const examples = {
   "javascript-video": {
      title: "JavaScript video calling example",
      intro: "Create a video call on a trusted backend, then join it with the headless meeting engine in the browser.",
      code: `import { PurpleCallioClient } from "@purplecallio/sdk";

const client = new PurpleCallioClient({ apiKey: process.env.PURPLECALLIO_API_KEY! });
const call = await client.createCall({ callerId: "user_alice", receiverId: "user_bob", type: "VIDEO" });

// Return only the participant-specific token, call ID, and signal URL to the browser.`,
   },
   "javascript-audio": {
      title: "JavaScript audio calling example",
      intro: "Create an audio call from the backend and initialize the browser meeting with video disabled.",
      code: `import { PurpleCallioMeeting } from "@purplecallio/sdk";

const meeting = new PurpleCallioMeeting({ token, callId, signalUrl, video: false });
await meeting.join();
await meeting.microphone.enable();`,
   },
   "react-video": {
      title: "React video calling example",
      intro: "Compose a video meeting UI from official PurpleCallio React components.",
      code: `import { MeetingProvider, ParticipantGrid, CameraButton, MicrophoneButton } from "@purplecallio/react";

<MeetingProvider token={participantToken} callId={callId} signalUrl={signalUrl}>
  <ParticipantGrid />
  <CameraButton />
  <MicrophoneButton />
</MeetingProvider>`,
   },
   "react-audio": {
      title: "React audio calling example",
      intro: "Use the React provider and microphone control in an audio-focused calling interface.",
      code: `import { MeetingProvider, MicrophoneButton, ConnectionStatus } from "@purplecallio/react";

<MeetingProvider token={participantToken} callId={callId} signalUrl={signalUrl}>
  <ConnectionStatus />
  <MicrophoneButton />
</MeetingProvider>`,
   },
   "screen-sharing": {
      title: "Screen sharing example",
      intro: "Add the official React screen-share control inside an authenticated meeting provider.",
      code: `import { MeetingProvider, ScreenShareButton } from "@purplecallio/react";

<MeetingProvider token={participantToken} callId={callId} signalUrl={signalUrl}>
  <ScreenShareButton />
</MeetingProvider>`,
   },
   "hosted-ui": {
      title: "Hosted UI example",
      intro: "Create a call from trusted backend code and direct an authorized participant to their returned hosted URL.",
      code: `import { PurpleCallioClient } from "@purplecallio/sdk";

const client = new PurpleCallioClient({ apiKey: process.env.PURPLECALLIO_API_KEY! });
const call = await client.createCall({ callerId: "user_alice", receiverId: "user_bob" });

redirect(call.callerUrl);`,
   },
} as const;

type ExampleSlug = keyof typeof examples;

export function generateStaticParams() {
   return Object.keys(examples).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
   const { slug } = await params;
   const example = examples[slug as ExampleSlug];
   return example ? pageMetadata({ title: example.title, description: example.intro, path: `/examples/${slug}` }) : {};
}

export default async function ExamplePage({ params }: { params: Promise<{ slug: string }> }) {
   const { slug } = await params;
   const example = examples[slug as ExampleSlug];
   if (!example) notFound();
   return <PublicPage eyebrow="Official example" title={example.title} intro={example.intro} crumbs={[{ label: "Home", href: "/" }, { label: "Examples", href: "/examples" }, { label: example.title, href: `/examples/${slug}` }]}><ContentSection title="Example"><CodeBlock code={example.code} /></ContentSection><ContentSection title="Security"><p>Keep <code>PURPLECALLIO_API_KEY</code> on a trusted backend. Return participant-specific session information to the browser instead of exposing the project API key.</p></ContentSection></PublicPage>;
}
