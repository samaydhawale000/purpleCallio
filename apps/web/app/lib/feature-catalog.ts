import { Bot, Mic, MonitorUp, Network, Video, type LucideIcon } from "lucide-react";

export interface FeatureCard {
   slug: string;
   name: string;
   tagline: string;
   body: string;
   highlights: string[];
   icon: LucideIcon;
   badge?: string;
}

/** The three core products, in the order they're presented. */
export const CORE_FEATURES: FeatureCard[] = [
   {
      slug: "video-calling",
      name: "Video Calling",
      tagline: "Face-to-face calls inside your product.",
      body: "Browser video calls for interviews, consultations, tutoring and support, created from your backend and joined through hosted UI, React components or the headless SDK.",
      highlights: [
         "One-to-one and group calls",
         "Screen sharing and device selection",
         "Hosted UI, React or headless SDK",
      ],
      icon: Video,
   },
   {
      slug: "audio-calling",
      name: "Audio Calling",
      tagline: "Voice calls without the meeting app.",
      body: "Lightweight voice calls for sales, support and marketplaces. The same server-controlled call lifecycle as video, at a lower credit rate.",
      highlights: [
         "Low-bandwidth voice over WebRTC",
         "TURN relay for strict networks",
         "Webhooks for every call event",
      ],
      icon: Mic,
   },
   {
      slug: "ai-voice-agents",
      name: "AI Voice Agents",
      tagline: "Let an AI agent answer the call.",
      body: "Real-time voice agents that talk to your users, look things up in your systems and take actions through your own APIs, configured from the dashboard with no ML work.",
      highlights: [
         "Natural, interruptible conversations",
         "Calls your APIs through secure tools",
         "Transcripts, analytics and per-minute credits",
      ],
      icon: Bot,
      badge: "New",
   },
];

/** Building blocks that come with every plan. */
export const PLATFORM_FEATURES: FeatureCard[] = [
   {
      slug: "screen-sharing",
      name: "Screen Sharing",
      tagline: "Share a screen mid-call.",
      body: "Let participants share a desktop or window during video calls, with no extra integration.",
      highlights: [],
      icon: MonitorUp,
   },
   {
      slug: "webrtc",
      name: "WebRTC Infrastructure",
      tagline: "Signaling, auth and TURN, handled.",
      body: "WebSocket signaling, participant tokens and TURN relay around browser WebRTC, so you don't run it yourself.",
      highlights: [],
      icon: Network,
   },
];
