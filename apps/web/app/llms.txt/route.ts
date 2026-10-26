import { PURPLECALLIO_DESCRIPTION, PURPLECALLIO_NAME, PURPLECALLIO_URL } from "../lib/brand";

// Plain-text site summary for AI answer engines (llmstxt.org). Static: rebuilt on deploy.
export const dynamic = "force-static";

const link = (path: string, title: string, note: string) => `- [${title}](${PURPLECALLIO_URL}${path}): ${note}`;

const BODY = `# ${PURPLECALLIO_NAME}

> ${PURPLECALLIO_DESCRIPTION}

Key facts:
- Products: video calling API, audio calling API, screen sharing, Live Translate (real-time speech translation) and AI voice agents.
- Integration paths: hosted UI, React components (@purplecallio/react), a headless JavaScript/TypeScript SDK (@purplecallio/sdk), a REST API and webhooks. Guides also cover Angular, Vue, Svelte and React Native, with native Flutter, iOS and Android SDKs in preview.
- Live Translate: two people on a 1:1 call each speak their own language; each hears a translated voice a moment behind the speaker and sees captions with the original text. 60 languages, any to any, with automatic language detection. Extras: PurpleLex (custom terms), MeaningGuard (flags likely misunderstandings), CostGuard (per-call limits and budgets) and post-call reports.
- Pricing: prepaid credits, no subscriptions. Audio, video and screen sharing are charged per participant-minute at separate rates; Live Translate per minute for each person translating (one side 1×, both sides 2×); AI voice agents per call-minute. Free welcome or promotional credits cover audio, video and screen share only; AI features always use purchased credits. GST is added at checkout. Current rates: ${PURPLECALLIO_URL}/pricing
- API keys stay on your backend; browsers join with participant-specific session tokens.

## Product
${[
   link("/what-is-purplecallio", "What is PurpleCallio?", "overview, integration paths and common questions"),
   link("/features/video-calling", "Video calling API", "1:1 video calls"),
   link("/features/audio-calling", "Audio calling API", "1:1 voice calls"),
   link("/features/screen-sharing", "Screen sharing", "share a screen during a call"),
   link("/features/live-translation", "Live Translate", "real-time voice translation and captions for calls"),
   link("/features/ai-voice-agents", "AI voice agents", "AI agents that hold voice conversations in calls"),
   link("/features/webrtc", "WebRTC infrastructure", "signaling, TURN relay and SDKs on top of WebRTC"),
   link("/pricing", "Pricing", "prepaid credits, per-minute rates and pricing questions"),
   link("/faq", "FAQ", "answers about the product, billing and usage"),
].join("\n")}

## Docs
${[
   link("/docs/quickstart", "Quickstart", "create a call and join it"),
   link("/docs/authentication", "Authentication", "API keys and participant tokens"),
   link("/docs/rest-api", "REST API", "endpoints for calls and usage"),
   link("/docs/javascript", "JavaScript SDK", "the headless meeting engine"),
   link("/docs/react", "React", "components and hooks"),
   link("/docs/hosted-ui", "Hosted UI", "ready-made call interface"),
   link("/docs/calls", "Calls", "call lifecycle"),
   link("/docs/audio", "Audio calls", "audio integration guide"),
   link("/docs/video", "Video calls", "video integration guide"),
   link("/docs/screen-sharing", "Screen sharing", "screen sharing guide"),
   link("/docs/live-translate", "Live Translate", "translation block on POST /calls, TranslationClient SDK, reports and webhooks"),
   link("/docs/ai-agents", "AI voice agents", "creating and running AI agents"),
   link("/docs/webhooks", "Webhooks", "events and signatures"),
   link("/docs/security", "Security", "keys, tokens and data handling"),
   link("/docs/usage-billing", "Usage and billing", "how usage becomes credits"),
].join("\n")}

## Optional
${[
   link("/developers", "Developer platform", "choosing an integration path"),
   link("/sdks", "SDKs", "official SDK packages"),
   link("/examples", "Examples", "minimal JavaScript and React examples"),
   link("/billing-terms", "Billing and usage terms", "credit purchases, expiry and taxes"),
   link("/privacy", "Privacy policy", "how data is handled"),
].join("\n")}
`;

export function GET() {
   return new Response(BODY, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
   });
}
