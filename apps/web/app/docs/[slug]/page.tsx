import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
   ContentSection,
   PublicPage,
} from "../../components/marketing/PublicPage";
import { JsonLd } from "../../components/seo/JsonLd";
import { pageMetadata, siteUrl } from "../../lib/seo";
import {
   CodeBlock,
   QuickstartStepper,
   ReactMeetingPreview,
} from "../../components/marketing/InteractiveTools";
import { PricingAuthority } from "../../components/PricingAuthority";

const docs = {
   quickstart: {
      title: "Quickstart: Create Your First Call",
      meta: "Video Calling API Quickstart",
      description:
         "Start a PurpleCallio call integration: create a call from your backend and choose hosted UI, React components, or the headless SDK.",
      lead: "Create a call from your backend, then direct each participant to the integration surface that fits your product. PurpleCallio provides a hosted call UI, React components, and a headless SDK.",
      sections: [
         [
            "Start with a call",
            "Use the REST API from your trusted backend to create a call and issue participant access. Keep API keys on the server; never expose them in browser code.",
         ],
         [
            "Choose an integration path",
            "Use hosted UI for the shortest path, React components for a composable interface, or the headless SDK when you own every part of the call experience.",
         ],
      ],
   },
   authentication: {
      title: "Authentication",
      meta: "API Authentication",
      description:
         "Learn how PurpleCallio authentication separates server API credentials from participant access for calls.",
      lead: "PurpleCallio integrations use server-side credentials for API requests and scoped participant access for joining a call.",
      sections: [
         [
            "Keep API keys on your server",
            "Create calls and manage project resources from a trusted backend. Do not put project API keys in a client application or a public URL.",
         ],
         [
            "Issue participant access",
            "Pass the participant-specific access returned when a call is created to the chosen call integration. Each participant should receive only their own access.",
         ],
      ],
   },
   javascript: {
      title: "Build Video Calling with JavaScript",
      meta: "JavaScript Video Calling SDK",
      description:
         "Use the PurpleCallio JavaScript headless SDK to build a custom video, audio, and screen sharing experience.",
      lead: "The PurpleCallio headless SDK gives JavaScript applications control over the meeting experience while the platform handles the call engine, signaling, authentication, and media infrastructure.",
      sections: [
         [
            "Build your own interface",
            "Use the headless SDK when a ready-made meeting UI does not match your product. Your application owns the controls and layout.",
         ],
         [
            "Handle call state",
            "Use the SDK's meeting and media controls to join or leave calls, manage devices, and start or stop screen sharing.",
         ],
      ],
   },
   react: {
      title: "Add Video Calling to React",
      meta: "React Video Calling SDK",
      description:
         "Use PurpleCallio React components to add a video, audio, and screen sharing experience to a React application.",
      lead: "PurpleCallio React components let product teams compose a branded calling experience without implementing WebRTC negotiation and signaling UI from scratch.",
      sections: [
         [
            "Compose the meeting UI",
            "Build with the MeetingProvider, participant views, controls, device selection, and waiting-room capabilities exposed by the React package.",
         ],
         [
            "Keep product control",
            "React components are a middle path between hosted UI and the headless SDK: integrate reusable UI while still shaping the experience around your application.",
         ],
      ],
   },
   angular: {
      title: "Add Video Calling to Angular",
      meta: "Angular Video Calling SDK",
      description:
         "Use the PurpleCallio Angular SDK — an injectable service and video directive — to add video, audio, and screen sharing to an Angular application.",
      lead: "The PurpleCallio Angular SDK wraps the same call engine as the JavaScript SDK in an Angular-idiomatic service, exposing connection state, participants, and media as RxJS observables.",
      sections: [
         [
            "Install the package",
            "npm install @purplecallio/angular @purplecallio/sdk. Requires Angular 16 or later — @angular/core, @angular/common, and rxjs 7.4+ are peer dependencies already present in any modern Angular app.",
         ],
         [
            "Configure and join with a service",
            "Inject PurpleCallioService, call configure() with a participant token from your backend, then join() to connect signaling and WebRTC. The service is provided in root, so a single instance is shared across your app.",
         ],
         [
            "Render with observables",
            "Bind connectionState$, participants$, remoteStream$, and localStream$ with the async pipe, and render streams with the purplecallioVideo directive on a plain <video> element.",
         ],
         [
            "What's supported",
            "Join/leave, camera and microphone enable/disable/toggle, screen sharing start/stop, live participant and connection-state tracking. The raw engine instance is intentionally not exposed, keeping the public surface small.",
         ],
      ],
   },
   "react-native": {
      title: "Add Video Calling to React Native",
      meta: "React Native Video Calling SDK",
      description:
         "Use the PurpleCallio React Native SDK to add video, audio, and screen sharing to iOS and Android apps, built on react-native-webrtc.",
      lead: "The PurpleCallio React Native SDK reuses the same call engine as the web SDKs on top of react-native-webrtc, adding the mobile-specific pieces: permissions, camera switching, and background/foreground lifecycle handling.",
      sections: [
         [
            "Install the package",
            "npm install @purplecallio/react-native @purplecallio/sdk react-native-webrtc, then call registerGlobals() from react-native-webrtc once at app startup, before joining a call.",
         ],
         [
            "Configure native permissions",
            "Add NSCameraUsageDescription and NSMicrophoneUsageDescription to Info.plist on iOS. On Android, camera and microphone runtime permissions are requested automatically before join() — no extra setup required.",
         ],
         [
            "Wrap your call screen",
            "Wrap your call screen in a PurpleCallioProvider with a participant token from your backend, then use useMeeting(), useParticipants(), and PurpleCallioVideoView to build the call UI.",
         ],
         [
            "Handle mobile specifics",
            "Camera and microphone permissions are requested automatically before joining, the camera pauses while the app is backgrounded and restores on foreground, and switchCamera() toggles between front and back cameras. Speaker/earpiece routing is available via the optional react-native-incall-manager package.",
         ],
         [
            "Known limitation: screen sharing",
            "Screen sharing is not yet supported on React Native — it requires native platform integration (an iOS Broadcast Upload Extension and Android MediaProjection) not yet implemented in this package.",
         ],
      ],
   },
   vue: {
      title: "Add Video Calling to Vue",
      meta: "Vue Video Calling SDK",
      description:
         "Use the PurpleCallio Vue SDK — a usePurpleCallio() composable — to add video, audio, and screen sharing to a Vue 3 application.",
      lead: "The PurpleCallio Vue SDK wraps the same call engine as the JavaScript SDK in a Composition API composable, exposing connection state, participants, and media as reactive refs.",
      sections: [
         [
            "Install the package",
            "npm install @purplecallio/vue @purplecallio/sdk. Requires Vue 3.2 or later.",
         ],
         [
            "Join a call with a composable",
            "Call usePurpleCallio() with a participant token from your backend, then join() to connect signaling and WebRTC. Each call to the composable creates its own engine instance.",
         ],
         [
            "Render reactive state",
            "Bind connectionState, participants, remoteStream, and localStream directly in your template, and render streams with the PurpleCallioVideo component.",
         ],
         [
            "What's supported",
            "Join/leave, camera and microphone enable/disable/toggle, screen sharing start/stop, live participant and connection-state tracking, and automatic cleanup when the component using the composable unmounts.",
         ],
      ],
   },
   svelte: {
      title: "Add Video Calling to Svelte",
      meta: "Svelte Video Calling SDK",
      description:
         "Use the PurpleCallio Svelte SDK — createPurpleCallio() and Svelte stores — to add video, audio, and screen sharing to a Svelte application.",
      lead: "The PurpleCallio Svelte SDK wraps the same call engine as the JavaScript SDK behind createPurpleCallio(), exposing connection state, participants, and media as Svelte stores.",
      sections: [
         [
            "Install the package",
            "npm install @purplecallio/svelte @purplecallio/sdk. Works with Svelte 4 or Svelte 5 — it uses the classic store contract (writable/readable) rather than runes, since runes only work inside .svelte files, not a plain library module.",
         ],
         [
            "Create a call",
            "Call createPurpleCallio() with a participant token from your backend, then join() to connect signaling and WebRTC.",
         ],
         [
            "Subscribe with $ syntax",
            "Read $call.connectionState, $call.participants, and $call.remoteStream directly in a .svelte file, and render streams with the PurpleCallioVideo component.",
         ],
         [
            "Clean up explicitly",
            "createPurpleCallio() isn't tied to any component lifecycle automatically — call call.destroy() from onDestroy() to unsubscribe from engine events and leave the call if it's still connected.",
         ],
      ],
   },
   "rest-api": {
      title: "REST API for Calls",
      meta: "Video Calling REST API",
      description:
         "Create, accept, reject, end, join, leave, and inspect PurpleCallio calls through the REST API.",
      lead: "The PurpleCallio REST API gives your backend a clear call lifecycle: create, accept, reject, join, leave, end, and inspect calls.",
      sections: [
         [
            "Call lifecycle",
            "Create calls on the server and use the returned information to connect participants through hosted UI or an SDK integration.",
         ],
         [
            "Use server-side requests",
            "REST operations are intended for trusted backend code. Pair API calls with your application's own authorization checks.",
         ],
      ],
   },
   calls: {
      title: "Calls and Participants",
      meta: "Calls API Guide",
      description:
         "Understand the PurpleCallio call lifecycle, participant access, hosted call URLs, and call management.",
      lead: "A PurpleCallio call represents the shared real-time session your application creates and manages for its participants.",
      sections: [
         [
            "Create and manage calls",
            "Your backend controls the lifecycle through the REST API, including creation and the actions available as a call progresses.",
         ],
         [
            "Connect participants",
            "A created call provides participant-specific connection information. Choose hosted UI for a ready-made page or connect through an SDK.",
         ],
      ],
   },
   "screen-sharing": {
      title: "Add Screen Sharing with WebRTC",
      meta: "WebRTC Screen Sharing API",
      description:
         "Add browser screen sharing with PurpleCallio's hosted UI, React components, or headless JavaScript SDK.",
      lead: "PurpleCallio supports browser screen sharing across hosted UI, React components, and the headless SDK.",
      sections: [
         [
            "Respect browser permissions",
            "Screen selection and permission are controlled by the participant's browser. Design your product flow so the user understands what they are sharing.",
         ],
         [
            "Understand usage",
            "Screen sharing is tracked and billed as its own participant-minute category. Check the current rates and billing terms for details.",
         ],
      ],
   },
   audio: {
      title: "Add Audio Calling with PurpleCallio",
      meta: "Audio Calling API & SDK",
      description:
         "Add browser audio calling with PurpleCallio's hosted UI, React components, or headless JavaScript SDK.",
      lead: "PurpleCallio supports 1:1 browser audio calls through hosted UI, React components, and the headless JavaScript SDK.",
      sections: [
         [
            "Permissions and devices",
            "Participants grant microphone permission in their browser. Use the React device tools or your own headless SDK interface to select available audio devices.",
         ],
         [
            "Mute and connection state",
            "Audio controls can mute or unmute the microphone while the meeting connection state shows whether the participant is connected.",
         ],
         [
            "Audio billing",
            "Audio usage is measured in audio participant-minutes. It is tracked separately from video and screen-sharing usage.",
         ],
      ],
   },
   video: {
      title: "Add Video Calling with PurpleCallio",
      meta: "Video Calling API & SDK",
      description:
         "Add browser video calling with PurpleCallio's hosted UI, React components, or headless JavaScript SDK.",
      lead: "PurpleCallio supports 1:1 browser video calls with camera controls, participant streams, and device selection across its integration surfaces.",
      sections: [
         [
            "Camera permissions and tracks",
            "Participants grant camera permission in their browser. The meeting engine manages the media track while your hosted or custom interface exposes the camera control.",
         ],
         [
            "Participant streams and layouts",
            "Use hosted UI for a ready-made layout, React components such as ParticipantGrid for a composable interface, or the headless SDK for a fully custom layout.",
         ],
         [
            "Video billing",
            "Video usage is measured in video participant-minutes. Video participant-minutes are separate from screen-sharing participant-minutes.",
         ],
      ],
   },
   "hosted-ui": {
      title: "Hosted Call UI",
      meta: "Hosted Video Call UI",
      description:
         "Use PurpleCallio hosted UI to add a ready-made audio, video, and screen sharing call experience to your product.",
      lead: "Hosted UI is the fastest PurpleCallio integration: create a call from your backend and direct participants to the returned hosted call URL.",
      sections: [
         [
            "A ready-made call experience",
            "Hosted UI includes the call interface, device selection, media controls, and screen sharing, so your team can avoid building a meeting frontend for the first release.",
         ],
         [
            "Keep call creation in your backend",
            "Your application remains responsible for deciding who can create or join a call. Generate call access only from trusted server code.",
         ],
      ],
   },
   webhooks: {
      title: "Webhooks",
      meta: "Call Event Webhooks",
      description:
         "Receive and verify PurpleCallio webhook events for changes in call state.",
      lead: "PurpleCallio can notify your backend when call state changes so your application can synchronize its own workflows.",
      sections: [
         [
            "Verify every request",
            "Webhook requests include an HMAC-SHA256 signature. Verify the signature before acting on an event.",
         ],
         [
            "Design for retries",
            "Treat webhook delivery as an event notification, not the only source of truth. Make event handling idempotent in your application.",
         ],
      ],
   },
   security: {
      title: "Security",
      meta: "API & Call Security",
      description:
         "Understand how PurpleCallio separates API keys, participant access, and TURN credentials, and how to keep your integration secure.",
      lead: "PurpleCallio separates credentials by trust boundary: your backend, the participant's browser, and the media relay each receive only the access they need.",
      sections: [
         [
            "API key: server only",
            "Your project API key authorizes creating and managing calls. Never expose it in browser code, a public repository, or a client-side environment variable. Use it only from trusted server code.",
         ],
         [
            "Participant access: session only",
            "When a call is created, each participant receives access scoped to that call. Pass only the participant's own access to hosted UI, the React components, or the headless SDK running in their browser.",
         ],
         [
            "Dashboard authentication",
            "The dashboard uses its own authenticated session to manage account and project resources. It is separate from both the API key and participant access.",
         ],
         [
            "TURN credentials",
            "Media relay (TURN) credentials are time-limited and generated per session using an HMAC-signed shared secret, so a leaked credential stops working after a short expiry window.",
         ],
         [
            "Transport and origin security",
            "API and signaling traffic is served over HTTPS/WSS. Configure CORS for your own domains and do not disable certificate validation in production.",
         ],
      ],
   },
   "usage-billing": {
      title: "Usage and Billing",
      meta: "Video Calling API Usage & Billing",
      description:
         "Understand PurpleCallio participant-minute usage, free allowances, billing cycles, invoices, and the usage dashboard.",
      lead: "PurpleCallio uses participant-minutes: each participant's time in a call is measured. For example, two participants in a ten-minute call use twenty participant-minutes.",
      sections: [
         [
            "What is included",
            "The current free allowance and media rates are shown on the pricing page and in the product. Billing begins only for usage beyond the applicable free allowance.",
         ],
         [
            "Track usage",
            "Use the dashboard to review usage and invoices. Audio, video, and screen sharing each appear as separate usage categories.",
         ],
      ],
   },
} as const;
type DocSlug = keyof typeof docs;
const examples: Partial<Record<DocSlug, { title: string; code: string }>> = {
   quickstart: {
      title: "Create a call from your backend",
      code: `import { PurpleCallioClient } from "@purplecallio/sdk";

const client = new PurpleCallioClient({ apiKey: process.env.PURPLECALLIO_API_KEY! });
const call = await client.createCall({
  callerId: "user_alice",
  receiverId: "user_bob",
});

`,
   },
   react: {
      title: "Compose a React meeting UI",
      code: `import { useEffect } from "react";
import { MeetingProvider, useMeeting, ParticipantTile, CameraButton, MicrophoneButton } from "@purplecallio/react";

function Call({ participantToken, callId, signalUrl }) {
  return (
    <MeetingProvider token={participantToken} callId={callId} signalUrl={signalUrl}>
      <Room />
    </MeetingProvider>
  );
}

function Room() {
  // MeetingProvider builds the engine but does not join automatically —
  // call join() yourself once the component mounts.
  const { join, localStream, remoteStream, participantId } = useMeeting();
  useEffect(() => { join(); }, [join]);

  return (
    <>
      <ParticipantTile participantId={participantId ?? "me"} stream={localStream} muted mirror />
      <ParticipantTile participantId="remote" stream={remoteStream} />
      <CameraButton />
      <MicrophoneButton />
    </>
  );
}`,
   },
   javascript: {
      title: "Initialize the headless meeting engine",
      code: `import { PurpleCallioMeeting } from "@purplecallio/sdk";

const meeting = new PurpleCallioMeeting({ token, callId, signalUrl });
await meeting.join();
// Build your own controls around the meeting instance.`,
   },
   angular: {
      title: "Join a call from an Angular component",
      code: `import { Component, OnDestroy, OnInit } from "@angular/core";
import { PurpleCallioService } from "@purplecallio/angular";

@Component({
  selector: "app-call",
  standalone: true,
  template: \`
    <video purplecallioVideo [stream]="call.localStream$ | async" [muted]="true"></video>
    <video purplecallioVideo [stream]="call.remoteStream$ | async"></video>
  \`,
})
export class CallComponent implements OnInit, OnDestroy {
  constructor(public call: PurpleCallioService) {}

  ngOnInit() {
    this.call.configure({ token: this.participantToken, callId: this.callId, signalUrl: this.signalUrl });
    this.call.join();
  }

  ngOnDestroy() {
    this.call.leave();
  }
}`,
   },
   "react-native": {
      title: "Join a call from a React Native screen",
      code: `import { PurpleCallioProvider, useMeeting, PurpleCallioVideoView } from "@purplecallio/react-native";

function CallScreen() {
  const { join, leave, remoteStream, localStream, toggleCamera } = useMeeting();

  return (
    <PurpleCallioVideoView stream={remoteStream} objectFit="cover" />
  );
}

export default function App() {
  return (
    <PurpleCallioProvider token={participantToken} callId={callId} signalUrl={signalUrl}>
      <CallScreen />
    </PurpleCallioProvider>
  );
}`,
   },
   vue: {
      title: "Join a call from a Vue component",
      code: `<script setup lang="ts">
import { usePurpleCallio } from "@purplecallio/vue";
import PurpleCallioVideo from "@purplecallio/vue/components/PurpleCallioVideo.vue";

const { join, leave, localStream, remoteStream, camera } = usePurpleCallio({
  token: participantToken,
  callId,
  signalUrl,
});

join();
</script>

<template>
  <PurpleCallioVideo :stream="localStream" muted />
  <PurpleCallioVideo :stream="remoteStream" />
  <button @click="camera.toggle()">Toggle camera</button>
</template>`,
   },
   svelte: {
      title: "Join a call from a Svelte component",
      code: `<script lang="ts">
  import { onDestroy } from "svelte";
  import { createPurpleCallio, PurpleCallioVideo } from "@purplecallio/svelte";

  const call = createPurpleCallio({ token: participantToken, callId, signalUrl });
  call.join();

  onDestroy(() => call.destroy());
</script>

<PurpleCallioVideo stream={$call.localStream} muted={true} />
<PurpleCallioVideo stream={$call.remoteStream} />
<button on:click={() => call.camera.toggle()}>Toggle camera</button>`,
   },
   "rest-api": {
      title: "Create a call with the REST API",
      code: `curl -X POST https://api.purplecallio.com/calls \\
  -H "x-api-key: $PURPLECALLIO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"callerId":"user_alice","receiverId":"user_bob"}'`,
   },
   "screen-sharing": {
      title: "Add a screen-share control in React",
      code: `import { ScreenShareButton } from "@purplecallio/react";

// Render inside a MeetingProvider.
<ScreenShareButton />`,
   },
   audio: {
      title: "Start an audio-focused headless meeting",
      code: `import { PurpleCallioMeeting } from "@purplecallio/sdk";

const meeting = new PurpleCallioMeeting({ token, callId, signalUrl, video: false });
await meeting.join();
await meeting.microphone.enable();`,
   },
   video: {
      title: "Render a React video meeting",
      code: `import { MeetingProvider, ParticipantGrid, CameraButton } from "@purplecallio/react";

<MeetingProvider token={participantToken} callId={callId} signalUrl={signalUrl}>
  <ParticipantGrid />
  <CameraButton />
</MeetingProvider>`,
   },
   "hosted-ui": {
      title: "Use the hosted URL returned by your backend",
      code: `const call = await client.createCall({ callerId, receiverId });

// Authorize the participant in your own app, then send them to their URL.
redirect(call.callerUrl);`,
   },
};
export function generateStaticParams() {
   return Object.keys(docs).map((slug) => ({ slug }));
}
export async function generateMetadata({
   params,
}: {
   params: Promise<{ slug: string }>;
}): Promise<Metadata> {
   const { slug } = await params;
   const doc = docs[slug as DocSlug];
   return doc
      ? pageMetadata({
           title: doc.meta,
           description: doc.description,
           path: `/docs/${slug}`,
        })
      : {};
}
export default async function DocPage({
   params,
}: {
   params: Promise<{ slug: string }>;
}) {
   const { slug } = await params;
   const doc = docs[slug as DocSlug];
   if (!doc) notFound();
   const path = `/docs/${slug}`;
   return (
      <PublicPage
         eyebrow="PurpleCallio documentation"
         title={doc.title}
         intro={doc.lead}
         crumbs={[
            { label: "Home", href: "/" },
            { label: "Docs", href: "/docs" },
            { label: doc.title, href: path },
         ]}
      >
         <JsonLd
            data={{
               "@context": "https://schema.org",
               "@type": "TechArticle",
               headline: doc.title,
               description: doc.description,
               url: new URL(path, siteUrl).toString(),
               publisher: {
                  "@type": "Organization",
                  name: "PurpleCallio",
                  url: siteUrl.toString(),
               },
            }}
         />
         <nav
            aria-label="On this page"
            className="rounded-xl border border-[#E7DFF5] bg-white p-4"
         >
            <p className="font-mono text-xs uppercase tracking-widest text-[#6425C4]">
               On this page
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
               {doc.sections.map((section) => {
                  const title = section[0];
                  return (
                     <a
                        key={title}
                        href={`#${title
                           .toLowerCase()
                           .replace(/[^a-z0-9]+/g, "-")
                           .replace(/(^-|-$)/g, "")}`}
                        className="text-[#3D3650] hover:text-[#170B2E]"
                     >
                        {title}
                     </a>
                  );
               })}
               {examples[slug as DocSlug] && (
                  <a
                     href="#example"
                     className="text-[#3D3650] hover:text-[#170B2E]"
                  >
                     Example
                  </a>
               )}
            </div>
         </nav>
         {doc.sections.map((section) => {
            const [title, body] = section;
            return (
               <section
                  id={title
                     .toLowerCase()
                     .replace(/[^a-z0-9]+/g, "-")
                     .replace(/(^-|-$)/g, "")}
                  key={title}
                  className="scroll-mt-24"
               >
                  <ContentSection title={title}>
                     <p>{body}</p>
                  </ContentSection>
               </section>
            );
         })}
         {slug === "authentication" && (
            <ContentSection title="Credential hierarchy">
               <div className="grid gap-3 sm:grid-cols-3">
                  {[
                     ["API key", "Your backend", "Create and manage calls."],
                     [
                        "Participant access",
                        "Participant browser",
                        "Join only the authorized call.",
                     ],
                     [
                        "Dashboard JWT",
                        "Dashboard",
                        "Manage account and project resources.",
                     ],
                  ].map(([name, location, detail]) => (
                     <article
                        key={name}
                        className="rounded-xl border border-[#E7DFF5] bg-white p-4"
                     >
                        <h3 className="font-semibold text-[#170B2E]">{name}</h3>
                        <p className="mt-2 text-sm text-[#6425C4]">
                           {location}
                        </p>
                        <p className="mt-2 text-sm text-[#3D3650]">{detail}</p>
                     </article>
                  ))}
               </div>
               <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <strong>Never expose your API key in browser code.</strong>{" "}
                  Create calls and authorize participants from trusted server
                  code.
               </p>
            </ContentSection>
         )}
         {slug === "usage-billing" && (
            <ContentSection title="Current rates and examples">
               <PricingAuthority />
            </ContentSection>
         )}
         {slug === "quickstart" && (
            <ContentSection title="First successful call in minutes">
               <QuickstartStepper />
            </ContentSection>
         )}
         {slug === "react" && (
            <ContentSection title="React meeting preview">
               <ReactMeetingPreview />
            </ContentSection>
         )}
         {examples[slug as DocSlug] && (
            <section id="example" className="scroll-mt-24">
               <ContentSection title={examples[slug as DocSlug]!.title}>
                  <CodeBlock
                     code={examples[slug as DocSlug]!.code}
                     filename={
                        slug === "rest-api"
                           ? "request.sh"
                           : slug === "react-native"
                             ? "CallScreen.tsx"
                             : slug === "vue"
                               ? "CallView.vue"
                               : slug === "svelte"
                                 ? "CallView.svelte"
                                 : "example.ts"
                     }
                  />
               </ContentSection>
            </section>
         )}
         <ContentSection title="Related documentation">
            <div className="flex flex-wrap gap-4">
               <Link
                  href="/docs/quickstart"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  Quickstart →
               </Link>
               <Link
                  href="/docs/authentication"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  Authentication →
               </Link>
               <Link
                  href="/docs/react"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  React SDK →
               </Link>
               <Link
                  href="/docs/angular"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  Angular SDK →
               </Link>
               <Link
                  href="/docs/react-native"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  React Native SDK →
               </Link>
               <Link
                  href="/docs/vue"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  Vue SDK →
               </Link>
               <Link
                  href="/docs/svelte"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  Svelte SDK →
               </Link>
               <Link
                  href="/sdks"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  All SDKs →
               </Link>
               <Link
                  href="/docs/security"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  Security →
               </Link>
               <Link
                  href="/features/video-calling"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  Video Calling →
               </Link>
               <Link
                  href="/pricing"
                  className="text-[#6425C4] hover:text-[#170B2E]"
               >
                  Pricing →
               </Link>
            </div>
         </ContentSection>
      </PublicPage>
   );
}
