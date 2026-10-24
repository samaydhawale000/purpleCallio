# Live Translate — protocol contract

Single source of truth for the server, SDK, React kit, hosted UI and dashboard.
Product plan: two-way voice + caption translation for 1:1 calls, with DualView,
PurpleLex, MeaningGuard, Translation Observability, CostGuard, Post-Call Suite
and the Translation UI Kit. If code and this file disagree, fix one of them in
the same change.

## 0. Vocabulary

- **role**: `caller` | `receiver` (the two participants of a call).
- **direction**: `caller_to_receiver` | `receiver_to_caller`. The *speaker* of a
  direction is its first role, the *listener* the second.
- **mode**: `off` | `captions` | `voice` (DB enum `OFF` | `CAPTIONS` | `VOICE`).
- **language**: lowercase ISO-639-1/3 code, optional region (`hi`, `en`, `en-IN`)
  or `auto` (speak side only). Validated with `LANGUAGE_TAG` plus `auto`.
- **route**: provider route id: `soniox` (or `mock` for explicit local tests).
- **phraseId**: `<role>-<seq>` (e.g. `caller-12`), unique per call, assigned by
  the server relay.

## 1. Developer REST API

Auth: `ApiKeyGuard` (project from the key) unless noted.

### POST /calls (extended)
New optional body fields:
```jsonc
{
  "callerLanguage": "en",          // or "auto"
  "receiverLanguage": "mr",
  "translation": {
    "mode": "voice",               // off | captions | voice  (default off)
    "lexiconId": "uuid",           // PurpleLex; must belong to the project
    "context": { "industry": "healthcare", "purpose": "string ≤ 200", "roles": { "caller": "doctor", "receiver": "patient" } },
    "postCallReport": true,        // only effective if project setting allows
    "maxMinutes": 30,              // CostGuard per-call limit (1..600)
    "guard": { "enabled": true, "sensitivity": "standard", "replay": false },
    "onLimit": "captions_then_off" // or "off"
  }
}
```
Stored on `Call.callerLanguage/receiverLanguage/translationMode/translationConfig`.
Response `participants[]` gains `language`; top level gains
`translation: { mode, config }`.
Validation errors → 400 with `code` (`TRANSLATION_INVALID_LANGUAGE`,
`TRANSLATION_INVALID_CONFIG`, `TRANSLATION_LEXICON_NOT_FOUND`). If mode≠off and the
account is not entitled (no `TRANSLATION` feature and no trial minutes left) →
403 `TRANSLATION_NOT_IN_PLAN`. If credits < start minimum → 402
`TRANSLATION_INSUFFICIENT_CREDITS`. (The call itself is never refused because
of translation when mode is off.)

### PATCH /calls/:id/translation  (ApiKeyGuard or CallSessionGuard)
Body `{ mode?, callerLanguage?, receiverLanguage? }` → `{ mode, callerLanguage, receiverLanguage }`.
Live relays apply it immediately (server emits `mode` / `ready` again).

### GET /calls/:id/translation-report
`404 TRANSLATION_REPORT_NOT_FOUND` | `{ status: 'pending'|'ready'|'failed', transcript: Phrase[], summary, signals, creditsCharged, createdAt }`.

### GET /translation/languages  (public, no auth)
```jsonc
{ "languages": [ { "code": "mr", "name": "Marathi", "nativeName": "मराठी", "script": "Deva", "rtl": false,
                   "voice": true, "captions": true, "routes": ["soniox"] } ],
  "pairs": "all-to-all; voice availability is per target language" }
```

### GET /translation/estimate?mode=voice&minutes=10&calls=100  (public; JWT optional → applies the user's override)
`{ mode, ratePerMinute, creditsPerCall, totalCredits, approxInrPerCall, note }`.

### Project settings, lexicons, metrics (ApiKeyGuard → key's project)
- `GET|PATCH /translation/settings` → `TranslationSettings` fields (see schema).
  Budgets are clamped to `BillingConfig.translationMaxBudgetCredits`.
- `GET|POST /translation/lexicons`, `GET|PATCH|DELETE /translation/lexicons/:id`
- `PUT /translation/lexicons/:id/terms` (bulk upsert `[{ term, kind, translations?, pronunciation?, caseSensitive? }]`, max 2000)
- `DELETE /translation/lexicons/:id/terms/:termId`
- `POST /translation/lexicons/:id/import` body `{ csv: string }` (columns `term,kind,lang:hi,lang:ta,…,pronunciation`)
- `GET /translation/lexicons/packs` → built-in industry packs; `POST /translation/lexicons/from-pack` `{ industry, name? }`
- `GET /translation/metrics?from&to&pair=hi-en&route=soniox` → see §5.

### Dashboard mirrors (JwtGuard, owner must own the project)
Same handlers under `/dashboard/translation/projects/:projectId/...`
(`settings`, `lexicons…`, `metrics`) and
`GET /dashboard/translation/calls/:callId/report`.

Response shapes used by the dashboard:
- Lexicon list rows `{ id, name, industry, termCount, createdAt, updatedAt }`;
  `GET …/lexicons/:id` adds `terms[] { id, term, kind, translations, pronunciation, caseSensitive }`.
- `GET …/lexicons/packs` → `[{ industry, name, description, termCount }]`;
  `POST …/lexicons/from-pack` `{ industry, name? }`; `PUT …/terms` body is a
  plain array (`{ terms: [...] }` also accepted).
- Report transcript phrases: `{ phraseId, speaker, sourceLanguage, targetLanguage,
  original, translated, startedAt, endedAt?, translatedAudioAt?, guardStatus,
  guardReasons, guard: { status, reasons } }`; `signals.talkRatio = { caller, receiver }`
  as 0..1 fractions.
- `GET /dashboard/translation/usage?from&to&projectId?` (CostGuard breakdown, owner-wide
  unless `projectId`) →
  `{ callMinutes:{minutes,credits}, captions:{minutes,credits}, voice:{minutes,credits},
     aiAgent:{minutes,credits}, reports:{count,credits}, trialMinutes, totalCredits,
     approxInrTotal, period:{from,to} }`. Session credits are split between voice and
  captions by seconds × the session's locked rate (display only).

### Admin (AdminGuard + Billing tab permission)
- BillingConfig fields are edited through the existing billing-config admin
  endpoint `GET|PATCH /admin/billing/credit-rates` (fields listed in schema.prisma
  under "Live Translate"; validated: rates ≥ 1, Indic voice rate / minimum credits
  nullable, trial ≥ 0, provider costs = `{ routeId: non-negative paise }`, margin
  warn % 0..100, default max minutes 1..600, max budget ≥ 1; audited). Changing a
  customer rate (voice, captions, Indic voice, report) notifies every account that
  used translation in the last 30 days (`TRANSLATION_RATE_CHANGED`). New rates
  apply to **new sessions only** — each session locks its rates at start.
- `GET /admin/translation/overrides` → `[{ userId, voiceCreditsPerMinute,
  captionsCreditsPerMinute, postCallReportCredits, note, updatedAt, updatedById,
  user: { email, name, companyName } }]`.
- `GET|PUT|DELETE /admin/translation/overrides/:userId` → `TranslationRateOverride`
  (null field = standard rate; audited).
- `GET /admin/translation/margin?from&to` (YYYY-MM-DD, `to` inclusive; default last
  30 days) → `{ warnPercent, total: Row, byRoute: Row[], byPair: Row[], reports,
  creditValuePaise, creditValueSource }`, `Row = { route | pair+route, sessions,
  minutes, revenueCredits, revenueInr, providerCostInr, marginInr, marginPercent, warn }`
  (`warn` when margin % < `translationMarginWarnPercent`).

### Error codes
Every Live Translate error body carries `code`: `TRANSLATION_INVALID_LANGUAGE`,
`TRANSLATION_INVALID_CONFIG`, `TRANSLATION_LEXICON_NOT_FOUND`,
`TRANSLATION_NOT_IN_PLAN` (403), `TRANSLATION_INSUFFICIENT_CREDITS` (402),
`TRANSLATION_DISABLED` (403, POST/PATCH with mode ≠ off while
`TRANSLATION_ENABLED` is false), `TRANSLATION_CALL_ENDED` (410, PATCH on an ended
call), `TRANSLATION_REPORT_NOT_FOUND`, `TRANSLATION_INVALID_SETTINGS`,
`TRANSLATION_INVALID_LEXICON`, `TRANSLATION_TERM_NOT_FOUND`,
`TRANSLATION_PACK_NOT_FOUND`, `TRANSLATION_INVALID_REQUEST`, `TRANSLATION_NOT_FOUND`,
`TRANSLATION_FORBIDDEN`. Failed reports store `TRANSLATION_REPORT_SUMMARY_FAILED`,
`TRANSLATION_REPORT_CHARGE_FAILED` or `TRANSLATION_REPORT_BUILD_FAILED` in `error`.

Guard sensitivity values: `low | standard | high` (`relaxed`/`strict` accepted as
aliases). Omitting `guard.replay` leaves it unset (replay then follows the project's
`replayEnabled`); only an explicit `false` disables it for the call.

## 2. Socket.IO namespace `/translate`

Handshake: `io('/translate', { auth: { token }, transports: ['websocket'] })`
where `token` is the participant's **call session token** (`bj_session_…`, the
same token used for the call). Server resolves role + call via
`CallSessionService.getByToken`. Rejections emit `error { code }` then
disconnect: `TRANSLATION_DISABLED`, `TRANSLATION_SESSION_INVALID`,
`TRANSLATION_NOT_IN_PLAN`, `TRANSLATION_INSUFFICIENT_CREDITS`,
`TRANSLATION_CALL_ENDED`.

One relay per callId (in memory, per instance); each role has at most one
socket (a new socket for the same role replaces the old one; 15 s reconnect
grace).

### Client → server
| event | payload | notes |
|---|---|---|
| `audio` | binary PCM16 LE mono @ `inputSampleRate` | 20 ms frames, sent **only while speaking** (client VAD). Max 32 000 B/frame, 100 frames/s. |
| `speech.start` | `{}` | client VAD onset; server opens a new phrase |
| `speech.end` | `{}` | ≥ 600 ms silence; server commits the phrase (`endOfSpeech()` on the provider) |
| `settings` | `{ speak?: lang, hear?: lang, mode?: mode }` | participant's own languages / mode; server re-plans directions |
| `replay` | `{ phraseId }` | only if replay enabled; else `error {code:'TRANSLATION_REPLAY_DISABLED'}` |
| `repeat.request` | `{ phraseId }` | listener asks the speaker to repeat |
| `end` | `{}` | leave translation (call continues) |

### Server → client
| event | payload |
|---|---|
| `ready` | `{ role, inputSampleRate: 16000, outputSampleRate: 24000, mode, you: { speak, hear }, peer: { speak, hear } \| null, replayEnabled, guard: { enabled, sensitivity }, limits: { maxMinutes, usedSeconds } , trial: boolean }` |
| `peer` | `{ connected: boolean, speak?, hear? }` |
| `mode` | `{ mode, reason?: 'participant'\|'api'\|'limit' }` |
| `caption` | `Caption` (below). Repeated with the same `phraseId` as text grows; `final:true` once. |
| `audio` | `(pcm: binary PCM16 @ outputSampleRate, meta: { phraseId })` — translated speech for **this** listener |
| `flagged` | `{ phraseId, reasons: string[] }` (MeaningGuard; may arrive after the final caption) |
| `repeat.requested` | `{ phraseId, original, prompt }` → sent to the **speaker**; `prompt` is in the speaker's language |
| `replay.audio` | `(pcm, { phraseId, sampleRate, done: boolean })` → to the requester |
| `limit` | `{ kind: 'warning'\|'stepped_down'\|'paused', scope: 'call'\|'budget'\|'credits', message, remainingSeconds? }` |
| `error` | `{ code }` |
| `ended` | `{ reason }` |

Relay notes (server behaviour):
- `settings.mode` is the sender's own **listening** mode (what they receive),
  capped by the call mode (API) and CostGuard. `mode` events carry each
  participant's effective mode; a `mode { mode:'captions' }` without `reason`
  means no route can speak that participant's language.
- Extra `error` codes during a session (connection stays open):
  `TRANSLATION_PROVIDER_UNAVAILABLE` (no route / provider failed after one
  fallback), `TRANSLATION_CONCURRENCY_LIMIT`
  (`TRANSLATION_MAX_CONCURRENT_CALLS_PER_ACCOUNT` / `_GLOBAL_` reached),
  `TRANSLATION_PHRASE_NOT_FOUND` (`replay`/`repeat.request` for an unknown or
  own phrase), `TRANSLATION_INVALID_LANGUAGE` / `TRANSLATION_INVALID_CONFIG`
  (bad `settings`), plus the handshake plan/credit codes when translation is
  switched on mid-call.
- `ended.reason`: `participant`, `replaced` (same role reconnected elsewhere),
  `participants_left`, `call_ended`, `idle_timeout` (10 min without speech),
  `server_shutdown`. Only translation ends; the call continues.

```ts
type Caption = {
  phraseId: string;
  speaker: 'caller' | 'receiver';
  sourceLanguage: string;      // detected if speak = auto
  targetLanguage: string;
  original: string;            // speaker's words (STT)
  translated: string;          // may be '' until translation arrives
  final: boolean;
  startedAt: number;           // epoch ms, speech.start
  endedAt?: number;            // epoch ms, speech.end
  translatedAudioAt?: number;  // epoch ms, first translated audio chunk sent
  guard?: { status: 'ok' | 'uncertain'; reasons: string[] };
  lexiconApplied?: string[];   // PurpleLex terms enforced on this phrase
};
```
Captions go to **both** participants (DualView). Translated `audio` goes only to
the listener. When `mode = captions`, no translated audio is produced.

Guard `reasons` vocabulary: `term_mismatch:number`, `term_mismatch:amount`,
`term_mismatch:date`, `term_mismatch:phone`, `term_mismatch:lexicon`,
`recognition_failed`, `low_asr_confidence`, `asr_alternatives_disagree`,
`length_mismatch`, `language_mismatch`, `poor_audio`, `late_translation`,
`provider_error`. Never a percentage.

## 3. Server provider interface (`translation/providers/translation-provider.interface.ts`)

```ts
export interface TranslationConnectConfig {
  sourceLanguage: string;   // may be 'auto'
  targetLanguage: string;
  mode: 'captions' | 'voice';
  lexicon: { term: string; kind: 'DO_NOT_TRANSLATE'|'TRANSLATE_AS'|'PRONOUNCE_AS'; translation?: string; pronunciation?: string }[];
  context?: { industry?: string; purpose?: string; speakerRole?: string; listenerRole?: string };
}
export interface TranscriptEvent { text: string; final: boolean; language?: string; confidence?: number; alternatives?: string[] }
export interface TranslationTextEvent { text: string; final: boolean }
export interface TranslationUsageEvent { audioInSeconds?: number; audioOutSeconds?: number; inputTokens?: number; outputTokens?: number; characters?: number }
export type TranslationProviderErrorCode = 'TRANSLATION_PROVIDER_UNAVAILABLE' | 'TRANSLATION_CONNECTION_FAILED';
export interface TranslationProviderSessionEvents {
  transcript: [TranscriptEvent];        // source-language text
  translation: [TranslationTextEvent];  // target-language text
  audio: [Buffer];                      // PCM16 @ outputSampleRate (voice mode only)
  phraseDone: [];                       // provider finished the current phrase (text final + audio done)
  usage: [TranslationUsageEvent];
  error: [TranslationProviderErrorCode];
  closed: [];
}
export abstract class TranslationProviderSession extends EventEmitter<TranslationProviderSessionEvents> {
  abstract readonly inputSampleRate: number;   // relay resamples? NO — client sends 16 kHz; providers resample internally if needed
  abstract readonly outputSampleRate: number;  // 24000 for all routes (providers resample)
  abstract sendAudio(pcm16: Buffer): void;     // 16 kHz PCM16 mono
  abstract endOfSpeech(): void;                // commit / flush the current phrase
  abstract close(): void;
}
export interface TranslationProvider {
  readonly name: string;                        // route id
  isConfigured(): boolean;
  supports(source: string, target: string, mode: 'captions' | 'voice'): boolean;
  connect(config: TranslationConnectConfig): Promise<TranslationProviderSession>;
}
```
Contract: client audio is always 16 kHz; relay output is always 24 kHz. Providers
that need other rates resample internally (shared `translation/audio/pcm.ts`).

## 4. Billing & CostGuard

- Billed per **direction-session**, per listener: `voiceSeconds × voiceRate/60 +
  captionsSeconds × captionsRate/60`, rounded **up once** per session. Seconds
  count wall-clock while both participants are connected and the direction is
  active in that mode. Rates are locked on the session row at start
  (`voiceRate`, `captionsRate`; voice rate = Indic voice rate when both the
  source and target are Indian languages and that override is set; customer
  override from `TranslationRateOverride` wins).
- Debit via `CreditService.debit` with idempotency key `translation:<sessionId>`,
  reference `TRANSLATION_SESSION`, `allowPartial: true`, after the session ends;
  a 5-minute cron bills unrecorded ended sessions (copy of the AI pattern).
- Trial: if the owner's plan lacks `TRANSLATION`, they may use
  `BillingConfig.translationTrialMinutes` total (sum of `trialSecondsUsed`);
  trial seconds are not charged.
- CostGuard checks every 5 s in the relay: per-call `maxMinutes` (wall-clock of
  translation active in the call), project daily/monthly budget (credits charged
  today/this month + live accrual), and wallet balance. The call is never ended.
  - `call` scope (time limit): ≥ 90 % → `limit {kind:'warning'}` once; 100 % →
    mode off (`paused`). No step-down for this scope.
  - `budget` / `credits` scopes: projection = used + live accrual + one minute
    at the current rate. At 100 % of the projection in voice with `onLimit =
    captions_then_off` → captions (`stepped_down`); captions then continue,
    evaluated at the captions rate, while they still fit, and pause when their
    projection reaches 100 % (`onLimit = off` pauses directly). ≥ 90 % → one
    `warning` per scope and mode (so captions get their own warning).
  - After a step-down or pause the relay never resumes on its own: only an
    explicit mode change (`settings.mode` or `PATCH …/translation`) whose limit
    check passes lifts it; otherwise that participant gets `limit` again.
  Budget thresholds (`alertThresholds`)
  crossing → one `TranslationBudgetAlert` row + notification
  `TRANSLATION_BUDGET_THRESHOLD` + webhook `translation.budget.threshold`.
- Post-Call Suite report: charged `postCallReportCredits` once per report,
  idempotency key `translation-report:<callId>`, reference `TRANSLATION_REPORT`.

## 5. Observability metrics

`GET /translation/metrics` returns, for the filter window:
```jsonc
{ "totals": { "calls", "sessions", "voiceMinutes", "captionsMinutes", "credits", "avgCreditsPerCallMinute", "approxInrPerCallMinute" },
  "latency": { "firstAudioMsP50", "firstAudioMsP95", "captionDelayMsP50", "captionDelayMsP95" },
  "reliability": { "providerFailures", "fallbacks", "droppedFrames", "failedSessions" },
  "guard": { "phrases", "flags", "flagRate", "byReason": { "term_mismatch:amount": 3 }, "replays", "repeats", "lexiconHits" },
  "byPair": [ { "pair": "mr-en", "route": "soniox", "sessions", "minutes", "firstAudioMsP50", "flagRate" } ],
  "benchmarks": [ { "pair": "hi-en", "route": "soniox", "termPreservation": null, "note": "pending Phase 0" } ] }
```
Provider cost is **never** returned to customers (admin margin endpoint only).
Latency definitions: firstAudioMs = `translatedAudioAt - endedAt` (or
`- startedAt` while still speaking on streaming routes, use the smaller
positive); captionDelayMs = time from `speech.end` to the final translated caption.

## 6. Webhooks (project webhook URL, `WEBHOOKS` entitlement as today)

Payload = existing call payload + `data`:
- `call.translation.started` `{ mode, callerLanguage, receiverLanguage }`
- `call.translation.ended` `{ voiceMinutes, captionsMinutes, credits, firstAudioMsP50, flags, replays, repeats, fallbacks }`
- `translation.limit_reached` `{ scope, action }`
- `translation.budget.threshold` `{ period, threshold, usedCredits, budgetCredits }` (project-level; `callId` null)
- `call.translation.report_ready` `{ status }` (`ready` or `failed`)

Project-level events are sent by `WebhookService.fireForProject` with
`callId: null` (delivery rows keyed `project:<projectId>`).

## 7. Post-Call Suite

Enabled when project `postCallReportEnabled` and the call's
`translation.postCallReport !== false`. Phrases (final captions) are stored in
`TranslationPhrase` with `expiresAt = now + transcriptRetentionDays`, text
passed through `redactTranscript` (reuse from ai-transcript.service). After the
call ends, a report job builds: transcript, summary per participant language
(`{ keyPoints[], decisions[], actionItems[{ text, phraseId }] }`), signals
(`talkRatio`, `topics[]`, `flaggedMoments[]`, `replays`, `repeats`, and `tone[]`
only if `sentimentEnabled` and project industry ≠ healthcare; each tone item
`{ speaker, topic, tone, quotes[] }`, worded as "possible tone"). Summaries use a
`ReportSummarizer` interface with an OpenAI implementation (chat completions,
JSON output) and a deterministic mock (extractive) when no key is configured.
Daily purge of expired phrases/reports.

## 8. Defaults & environment

`TRANSLATION_ENABLED` (default false), `SONIOX_API_KEY`,
`SONIOX_STT_MODEL` (default `stt-rt-v5`), `SONIOX_TTS_MODEL` (default
`tts-rt-v2`), `SONIOX_TTS_VOICE` (default `Adrian`),
`TRANSLATION_MOCK_PROVIDER` (`true` forces the mock route — local/internal
testing), `TRANSLATION_MAX_CONCURRENT_CALLS_PER_ACCOUNT` (5),
`TRANSLATION_GLOBAL_MAX_CONCURRENT_CALLS` (100)
(default `gpt-5-mini`).
