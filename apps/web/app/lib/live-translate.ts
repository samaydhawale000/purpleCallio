/**
 * Marketing + docs content for Live Translate (early access).
 *
 * Honesty rules (product plan §9): no accuracy percentages, no "100% accurate",
 * no "zero latency" / "under 1 second", MeaningGuard "flags phrases that may be
 * misunderstood", language lists keep voice and captions separate, and every
 * surface is marked Early access. Rates are never hard-coded: they come from
 * GET /translation/estimate (admin-managed in Admin → Billing).
 */
import {
   BarChart3,
   BookA,
   Columns2,
   FileText,
   LayoutTemplate,
   ShieldAlert,
   Wallet,
   type LucideIcon,
} from "lucide-react";
import { PURPLECALLIO_API_URL } from "./brand";
import { SONIOX_FALLBACK_LANGUAGES } from "./soniox-languages";

export const LIVE_TRANSLATE_PATH = "/features/live-translation";
export const LIVE_TRANSLATE_DOCS_PATH = "/docs/live-translate";
export const LIVE_TRANSLATE_SIGNUP = "/signup?intent=live-translate";
export const LIVE_TRANSLATE_STATUS = "Early access";

export type FeatureTheme = "Understand" | "Trust" | "Control";

export interface LiveTranslateFeature {
   id: string;
   brand: string;
   /** Plain description shown right under the brand name (naming rule, plan §9). */
   description: string;
   promise: string;
   why: string;
   theme: FeatureTheme;
   icon: LucideIcon;
}

export const LIVE_TRANSLATE_FEATURES: LiveTranslateFeature[] = [
   {
      id: "dualview",
      brand: "DualView Translation",
      description: "Original and translated captions, side by side",
      promise: "See what was said and what was heard, side by side.",
      why: "If a translation looks wrong, either person can compare it with the original words straight away instead of trusting the AI blindly.",
      theme: "Understand",
      icon: Columns2,
   },
   {
      id: "purplelex",
      brand: "PurpleLex",
      description: "Custom business vocabulary for translation",
      promise: "Your brand, people and industry terms, kept the way you define them.",
      why: "Generic translation struggles with product names and specialist terms. A reusable glossary keeps them consistent, and MeaningGuard flags any that still come through changed.",
      theme: "Understand",
      icon: BookA,
   },
   {
      id: "ui-kit",
      brand: "Translation UI Kit",
      description: "Drop-in multilingual call components",
      promise: "A multilingual call screen without building the UI yourself.",
      why: "Split views, language pickers, Indian scripts and right-to-left text are already handled, so you ship the feature instead of the plumbing.",
      theme: "Understand",
      icon: LayoutTemplate,
   },
   {
      id: "meaningguard",
      brand: "MeaningGuard",
      description: "Misunderstanding detection and recovery",
      promise: "Catch a possible misunderstanding before it costs you.",
      why: "It flags phrases that may be misunderstood, like a changed amount, date or name, so people can check, ask to repeat and move on.",
      theme: "Trust",
      icon: ShieldAlert,
   },
   {
      id: "post-call",
      brand: "Post-Call Suite",
      description: "Multilingual transcript, summary and action items after every call",
      promise: "Every call ends with notes, in everyone's language.",
      why: "Opt-in: get a synced transcript, a summary in each person's language and action items as one JSON payload, without building a recording pipeline.",
      theme: "Trust",
      icon: FileText,
   },
   {
      id: "observability",
      brand: "Translation Observability",
      description: "Latency, quality and cost metrics for translation",
      promise: "Know when translation is slow, failing or expensive.",
      why: "Knowing a call connected isn't enough. See translation delay, provider failures, flag rates and cost per minute by language pair.",
      theme: "Control",
      icon: BarChart3,
   },
   {
      id: "costguard",
      brand: "CostGuard",
      description: "Usage budgets and cost limits for AI calls",
      promise: "Know what a translated call costs before you scale.",
      why: "Per-call limits and project budgets are enforced on the server. When a limit is reached, translation steps down or pauses; the call itself keeps going.",
      theme: "Control",
      icon: Wallet,
   },
];

export const FEATURE_THEMES: { theme: FeatureTheme; title: string; body: string }[] = [
   { theme: "Understand", title: "Understand", body: "Both people see and hear the conversation in their own language." },
   { theme: "Trust", title: "Trust", body: "Possible misunderstandings are flagged, and every call can end with clear notes." },
   { theme: "Control", title: "Control", body: "Measure speed and quality, and keep AI costs inside the limits you set." },
];

// ── Languages ────────────────────────────────────────────────────────────
export interface TranslationLanguage {
   code: string;
   name: string;
   nativeName: string;
   rtl?: boolean;
   /** `null` = not yet validated (static fallback list). */
   voice: boolean | null;
   captions: boolean | null;
}

/**
 * Shown until GET /translation/languages answers (and when it can't).
 * Voice and captions availability is unknown here, so both show as
 * "being validated" rather than as supported.
 */
export const FALLBACK_LANGUAGES: TranslationLanguage[] = SONIOX_FALLBACK_LANGUAGES;
/* Legacy literal kept below temporarily for source-history readability.
   { code: "hi", name: "Hindi", nativeName: "हिन्दी", voice: null, captions: null },
   { code: "mr", name: "Marathi", nativeName: "मराठी", voice: null, captions: null },
   { code: "ta", name: "Tamil", nativeName: "தமிழ்", voice: null, captions: null },
   { code: "te", name: "Telugu", nativeName: "తెలుగు", voice: null, captions: null },
   { code: "bn", name: "Bengali", nativeName: "বাংলা", voice: null, captions: null },
   { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", voice: null, captions: null },
   { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", voice: null, captions: null },
   { code: "ml", name: "Malayalam", nativeName: "മലയാളം", voice: null, captions: null },
   { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", voice: null, captions: null },
   { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ", voice: null, captions: null },
   { code: "en", name: "English", nativeName: "English", voice: null, captions: null },
   { code: "ur", name: "Urdu", nativeName: "اردو", rtl: true, voice: null, captions: null },
   { code: "ar", name: "Arabic", nativeName: "العربية", rtl: true, voice: null, captions: null },
   { code: "es", name: "Spanish", nativeName: "Español", voice: null, captions: null },
   { code: "fr", name: "French", nativeName: "Français", voice: null, captions: null },
   { code: "de", name: "German", nativeName: "Deutsch", voice: null, captions: null },
]; */

export const PRICING_FALLBACK = "Pricing set at launch";

// ── Code snippets (PROTOCOL.md §1, §2) ───────────────────────────────────
export const LT_REST_CREATE = `curl -X POST ${PURPLECALLIO_API_URL}/calls \\
  -H "x-api-key: $PURPLECALLIO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "callerId": "doc_1",
    "receiverId": "pat_9",
    "callerLanguage": "en",
    "receiverLanguage": "mr",
    "translation": {
      "mode": "voice",
      "lexiconId": "lex_123",
      "context": {
        "industry": "healthcare",
        "purpose": "post-surgery follow-up",
        "roles": { "caller": "doctor", "receiver": "patient" }
      },
      "postCallReport": true,
      "maxMinutes": 30,
      "guard": { "enabled": true, "sensitivity": "standard", "replay": false },
      "onLimit": "captions_then_off"
    }
  }'`;

export const LT_REST_PATCH = `curl -X PATCH ${PURPLECALLIO_API_URL}/calls/$CALL_ID/translation \\
  -H "x-api-key: $PURPLECALLIO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "mode": "captions", "receiverLanguage": "ta" }'

# → { "mode": "captions", "callerLanguage": "en", "receiverLanguage": "ta" }`;

export const LT_SDK_EXAMPLE = `import { TranslationClient } from "@purplecallio/sdk";

// token = this participant's call session token (bj_session_…)
const translation = new TranslationClient({
  serverUrl: "${PURPLECALLIO_API_URL}",
  token,
  speak: "mr",          // or "auto"
  hear: "en",
  mode: "voice",        // "captions" | "voice"
  originalVolume: 0.2,  // other person's original voice, ducked
  remoteAudio: remoteAudioElement,
});

await translation.enable();

translation.on("caption", (p) => render(p.phraseId, p.original, p.translated));
translation.on("flagged", (p) => markUncertain(p.phraseId, p.guard?.reasons));
translation.on("repeat.requested", ({ prompt }) => showPrompt(prompt));
translation.on("limit", ({ kind, message }) => showBanner(kind, message));

translation.requestRepeat(phraseId);   // ask the speaker to say it again
translation.replay(phraseId);          // only if the project enabled replay
translation.setMode("captions");`;

export const LT_REACT_EXAMPLE = `import {
  DualViewCaptions,
  LanguagePicker,
  TranslationControls,
  useTranslation,
} from "@purplecallio/react";

export function TranslatedCall({ token }: { token: string }) {
  const translation = useTranslation({ token, speak: "en", hear: "en", mode: "voice" });

  return (
    <>
      <LanguagePicker translation={translation} />
      <TranslationControls translation={translation} />
      <DualViewCaptions translation={translation} layout="both" />
    </>
  );
}`;

export const LT_LEXICON_EXAMPLE = `# Create a PurpleLex lexicon
curl -X POST ${PURPLECALLIO_API_URL}/translation/lexicons \\
  -H "x-api-key: $PURPLECALLIO_API_KEY" -H "Content-Type: application/json" \\
  -d '{ "name": "Clinic terms" }'

# Add or update terms (bulk, up to 2,000)
curl -X PUT ${PURPLECALLIO_API_URL}/translation/lexicons/$LEXICON_ID/terms \\
  -H "x-api-key: $PURPLECALLIO_API_KEY" -H "Content-Type: application/json" \\
  -d '[
    { "term": "CloudDesk", "kind": "DO_NOT_TRANSLATE" },
    { "term": "follow-up", "kind": "TRANSLATE_AS", "translations": { "hi": "फ़ॉलो-अप", "mr": "फॉलो-अप" } },
    { "term": "Dr. Iyer", "kind": "PRONOUNCE_AS", "pronunciation": "doctor eye-yer" }
  ]'`;

export const LT_LEXICON_CSV = `term,kind,lang:hi,lang:mr,pronunciation
CloudDesk,DO_NOT_TRANSLATE,,,
follow-up,TRANSLATE_AS,फ़ॉलो-अप,फॉलो-अप,
Dr. Iyer,PRONOUNCE_AS,,,doctor eye-yer`;

export const LT_GUARD_SNIPPET = `"guard": {
  "enabled": true,
  "sensitivity": "standard",
  "replay": false   // replay of original audio is off by default
}`;

export const LT_COSTGUARD_SNIPPET = `"maxMinutes": 30,                // per-call translation limit
"onLimit": "captions_then_off"   // voice → captions → off; the call continues`;

export const LT_CONTEXT_SNIPPET = `"lexiconId": "lex_123",
"context": {
  "industry": "healthcare",
  "purpose": "post-surgery follow-up",
  "roles": { "caller": "doctor", "receiver": "patient" }
}`;

export const LT_REPORT_SNIPPET = `"postCallReport": true

// after the call
GET /calls/:id/translation-report
→ { "status": "ready", "transcript": [...], "summary": {...},
    "signals": {...}, "creditsCharged": 40 }`;

export const LT_METRICS_SNIPPET = `GET /translation/metrics?from=2026-10-01&to=2026-10-31&pair=mr-en

{ "totals":   { "calls": 412, "voiceMinutes": 3820, "captionsMinutes": 640, ... },
  "latency":  { "firstAudioMsP50": ..., "captionDelayMsP95": ... },
  "guard":    { "flags": 37, "byReason": { "term_mismatch:amount": 9 }, ... },
  "byPair":   [ { "pair": "mr-en", "route": "sarvam", ... } ] }`;

export const LT_ESTIMATE_SNIPPET = `GET /translation/estimate?mode=voice&minutes=10&calls=100

{ "mode": "voice", "ratePerMinute": …, "creditsPerCall": …,
  "totalCredits": …, "approxInrPerCall": …, "note": "…" }`;

// ── Comparison (plan §1, phrased cautiously) ─────────────────────────────
export const COMPARISON_COLUMNS = ["Agora", "Twilio", "LiveKit", "Zoom Video SDK", "PurpleCallio"] as const;

export const COMPARISON_ROWS: { label: string; cells: [string, string, string, string, string] }[] = [
   { label: "Translated captions", cells: ["Available (priced per language)", "Build it yourself", "Build it yourself", "Available", "Built in"] },
   { label: "Voice-to-voice translation", cells: ["Build it yourself", "Build it yourself (tutorials)", "Build it yourself (cookbook)", "Not documented for the SDK", "Built in"] },
   { label: "Original and translation side by side, time-synced", cells: ["Not documented", "Not documented", "Not documented", "Not documented", "DualView Translation"] },
   { label: "Company vocabulary for translation", cells: ["Not documented", "Not documented", "Not documented", "Not documented", "PurpleLex"] },
   { label: "Misunderstanding flags, replay and repeat", cells: ["Not documented", "Not documented", "Not documented", "Not documented", "MeaningGuard"] },
   { label: "Translation latency and quality metrics", cells: ["Not documented", "Not documented", "Not documented", "Not documented", "Translation Observability"] },
   { label: "AI cost budgets and per-call limits", cells: ["Not documented", "Not documented", "Not documented", "Not documented", "CostGuard"] },
   { label: "Multilingual transcript and summary after the call", cells: ["Needs recording and processing", "Partial", "Build it yourself", "Partial", "Post-Call Suite (opt-in)"] },
   { label: "Drop-in translation UI", cells: ["Raw text tracks", "Not documented", "Not documented", "Not documented", "Translation UI Kit"] },
   { label: "Indian languages", cells: ["Limited", "Depends on provider", "Depends on provider", "Not documented", "Captions and voice per validated language"] },
   { label: "Pricing", cells: ["Per feature and language", "Provider bill plus Twilio", "Agent minutes plus provider", "Contact sales", "One INR rate per translated minute"] },
];

export const COMPARISON_FOOTNOTE = "Based on public documentation as of Oct 2026; verify before relying on it.";

// ── FAQ (feature page + FAQ page) ────────────────────────────────────────
export const LIVE_TRANSLATE_FAQ: [string, string][] = [
   [
      "How long is the delay?",
      "There is a short delay of a second or more between someone speaking and the other person hearing the translation, depending on the language pair and route. We publish measured numbers at launch, and Translation Observability shows your own live numbers.",
   ],
   [
      "How accurate is it?",
      "Translation is AI-generated and can be wrong, especially with names, numbers, accents and noisy audio. DualView shows the original words next to the translation, PurpleLex keeps your terms consistent, and MeaningGuard flags phrases that may be misunderstood. A phrase that isn't flagged can still be wrong, so important details should be confirmed.",
   ],
   [
      "Which languages are supported?",
      "Captions and voice are listed separately for each language. Indian languages are a focus, including code-mixed speech like Hinglish. Voice availability is being validated language by language, and only languages that pass are offered in voice mode; others fall back to captions.",
   ],
   [
      "Is call audio or the transcript stored?",
      "Not by default. Audio is streamed to the translation providers and not stored by PurpleCallio. Replay of the original audio is off by default; if a project turns it on, recent audio is kept in memory only for about 30 seconds and cleared when the call ends. Transcripts are stored only if you opt in to the Post-Call Suite, with the retention period you choose.",
   ],
   [
      "What happens when a budget or limit is reached?",
      "CostGuard warns both people first. Then, depending on your settings, voice translation steps down to captions or translation pauses. The call itself never drops, and you get a translation.limit_reached webhook.",
   ],
   [
      "Can I still hear the other person's real voice?",
      "Yes. The original voice is turned down (ducked) rather than muted while the translation plays, so tone and emotion still come through. Each person can adjust the level.",
   ],
   [
      "Is Live Translate available now?",
      "It's in early access. Join the early-access list and we'll enable it for your account. Pricing, languages and features may change before general availability.",
   ],
];

export const PROVIDERS_TEXT = "Powered by OpenAI and Sarvam";
