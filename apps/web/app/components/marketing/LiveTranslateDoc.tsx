import Link from "next/link";
import { ContentSection } from "./PublicPage";
import { CodeBlock } from "./InteractiveTools";
import {
   LT_ESTIMATE_SNIPPET,
   LT_LEXICON_CSV,
   LT_LEXICON_EXAMPLE,
   LT_METRICS_SNIPPET,
   LT_REACT_EXAMPLE,
   LT_REST_CREATE,
   LT_REST_PATCH,
   LT_SDK_EXAMPLE,
} from "../../lib/live-translate";

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
   return (
      <div className="overflow-x-auto rounded-xl border border-[#E7DFF5]">
         <table className="w-full text-left text-sm">
            <thead className="bg-[#F8F4FD] text-xs uppercase tracking-wider text-[#3D3650]">
               <tr>
                  {head.map((h) => (
                     <th key={h} scope="col" className="px-4 py-3">{h}</th>
                  ))}
               </tr>
            </thead>
            <tbody className="text-[#3D3650]">
               {rows.map((r) => (
                  <tr key={r[0]} className="border-t border-[#E7DFF5]">
                     {r.map((c, i) => (
                        <td key={i} className={`px-4 py-3 align-top ${i === 0 ? "font-mono text-xs text-[#170B2E]" : ""}`}>{c}</td>
                     ))}
                  </tr>
               ))}
            </tbody>
         </table>
      </div>
   );
}

function Sec({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
   return (
      <section id={id} className="scroll-mt-24">
         <ContentSection title={title}>{children}</ContentSection>
      </section>
   );
}

const TRANSLATION_FIELDS = [
   ["mode", "off | captions | voice. Default off. captions = text only; voice = captions plus translated speech."],
   ["callerLanguage / receiverLanguage", "Top-level fields. ISO code with optional region (hi, en-IN) or auto to detect the speaker's language."],
   ["lexiconId", "PurpleLex lexicon to apply. Must belong to the API key's project."],
   ["context", "{ industry, purpose (≤ 200 chars), roles: { caller, receiver } }. Helps the model read ambiguous words; set once per session."],
   ["postCallReport", "Request a Post-Call Suite report. Only effective if the project has the Post-Call Suite enabled."],
   ["maxMinutes", "CostGuard per-call translation limit, 1–600."],
   ["guard", "{ enabled, sensitivity: \"standard\", replay }. replay defaults to false and only works if the project allows replay."],
   ["onLimit", "captions_then_off (voice steps down to captions, then off) or off."],
];

const GUARD_REASONS = [
   ["term_mismatch:number / amount / date / phone", "A number, amount, date or phone number differs between the original and the translation."],
   ["term_mismatch:lexicon", "A PurpleLex term was lost or changed."],
   ["recognition_failed", "Speech was detected but nothing usable was recognised."],
   ["low_asr_confidence", "The speech recogniser reported low confidence (only on routes that expose a reliable signal)."],
   ["asr_alternatives_disagree", "Alternative recognitions disagree on key words."],
   ["length_mismatch", "The translation is much shorter or longer than the original, or looks truncated."],
   ["language_mismatch", "The detected language isn't the one expected."],
   ["poor_audio", "Low level, clipping or dropped audio frames."],
   ["late_translation", "The translation arrived very late."],
   ["provider_error", "The translation provider returned an error or was retried."],
];

const WEBHOOKS = [
   ["call.translation.started", "{ mode, callerLanguage, receiverLanguage }"],
   ["call.translation.ended", "{ voiceMinutes, captionsMinutes, credits, firstAudioMsP50, flags, replays, repeats, fallbacks }"],
   ["translation.limit_reached", "{ scope, action }"],
   ["translation.budget.threshold", "{ period, threshold, usedCredits, budgetCredits } (project-level; callId is null)"],
   ["call.translation.report_ready", "{ status }"],
];

const ERRORS = [
   ["TRANSLATION_INVALID_LANGUAGE", "400", "A language code isn't valid."],
   ["TRANSLATION_INVALID_CONFIG", "400", "The translation block is invalid."],
   ["TRANSLATION_LEXICON_NOT_FOUND", "400", "lexiconId doesn't exist in this project."],
   ["TRANSLATION_NOT_IN_PLAN", "403", "Translation isn't in your plan and no trial minutes are left."],
   ["TRANSLATION_INSUFFICIENT_CREDITS", "402", "Not enough credits for one minute of the chosen mode."],
   ["TRANSLATION_REPORT_NOT_FOUND", "404", "No Post-Call Suite report for this call."],
   ["TRANSLATION_DISABLED", "socket", "Translation isn't enabled for this call or server."],
   ["TRANSLATION_SESSION_INVALID", "socket", "The session token isn't valid for this call."],
   ["TRANSLATION_CALL_ENDED", "socket", "The call has already ended."],
   ["TRANSLATION_REPLAY_DISABLED", "socket", "Replay was requested but the project hasn't enabled it."],
];

/** Extra content for /docs/live-translate, below the overview sections. */
export function LiveTranslateDoc() {
   return (
      <>
         <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <strong>Early access.</strong> Live Translate is enabled per account during early access. Endpoints, fields
            and limits below may change before general availability.
         </p>

         <Sec id="enable" title="Enable translation on POST /calls">
            <p>
               Add a <code>translation</code> block and each participant&apos;s language when you create the call.
               Calls without it, or with <code>mode: &quot;off&quot;</code>, behave exactly as before, and a call is
               never refused because of translation when the mode is off.
            </p>
            <CodeBlock code={LT_REST_CREATE} filename="request.sh" />
            <Table head={["Field", "Meaning"]} rows={TRANSLATION_FIELDS} />
            <p>
               The response&apos;s <code>participants[]</code> gain a <code>language</code>, and the top level gains{" "}
               <code>{"translation: { mode, config }"}</code>.
            </p>
         </Sec>

         <Sec id="patch" title="Change translation during a call">
            <p>
               <code>PATCH /calls/:id/translation</code> (API key or the participant&apos;s session) changes the mode or
               languages; live sessions apply it straight away.
            </p>
            <CodeBlock code={LT_REST_PATCH} filename="request.sh" />
         </Sec>

         <Sec id="sdk" title="Browser SDK: TranslationClient">
            <p>
               The browser connects to the <code>/translate</code> Socket.IO namespace with the participant&apos;s call
               session token (<code>bj_session_…</code>). <code>TranslationClient</code> from{" "}
               <code>@purplecallio/sdk</code> handles the microphone, voice activity detection, playback and ducking of
               the original voice. Audio is sent only while the person is speaking.
            </p>
            <CodeBlock code={LT_SDK_EXAMPLE} filename="translation.ts" />
            <p>
               Events: <code>ready</code>, <code>caption</code> (repeated per <code>phraseId</code> as text grows, with{" "}
               <code>startedAt</code>, <code>endedAt</code> and <code>translatedAudioAt</code> for DualView timing),{" "}
               <code>flagged</code>, <code>repeat.requested</code>, <code>limit</code>, <code>mode</code>,{" "}
               <code>peer</code>, <code>playback</code>, <code>error</code> and <code>ended</code>. Captions go to both
               participants; translated audio only to the listener.
            </p>
         </Sec>

         <Sec id="react" title="React: Translation UI Kit">
            <CodeBlock code={LT_REACT_EXAMPLE} filename="TranslatedCall.tsx" />
            <Table
               head={["Component", "What it does"]}
               rows={[
                  ["<DualViewCaptions />", "Original and translated lines in sync with the audio, amber MeaningGuard flags, Ask to repeat, Replay (when enabled) and a layout switch."],
                  ["<TranslatedChatView />", "Side-by-side chat bubbles, original on one side and translation on the other, scrollable through the call."],
                  ["<LanguagePicker />", "Searchable languages in their own script with voice and captions badges from GET /translation/languages."],
                  ["<TranslationControls />", "Mode switch (off, captions, voice), original-volume slider, CostGuard banner and a headphones tip."],
                  ["useTranslation()", "Hook exposing translation state, phrases and actions for your own UI."],
               ]}
            />
            <p>Indian scripts use Noto Sans fonts loaded only for languages in the call; Arabic and Urdu render right-to-left.</p>
         </Sec>

         <Sec id="purplelex" title="PurpleLex: lexicons">
            <p>
               A lexicon is a project&apos;s list of terms. Each term is <code>DO_NOT_TRANSLATE</code>,{" "}
               <code>TRANSLATE_AS</code> (per target language) or <code>PRONOUNCE_AS</code> (a hint for the spoken
               voice). Pick one per call with <code>lexiconId</code>.
            </p>
            <CodeBlock code={LT_LEXICON_EXAMPLE} filename="lexicon.sh" />
            <p>
               CSV import (<code>POST /translation/lexicons/:id/import</code> with <code>{"{ csv }"}</code>) uses the
               columns <code>term,kind,lang:hi,lang:ta,…,pronunciation</code>:
            </p>
            <CodeBlock code={LT_LEXICON_CSV} filename="terms.csv" />
            <p>
               Industry packs: <code>GET /translation/lexicons/packs</code> lists starter lexicons (healthcare, legal,
               B2B SaaS, finance, e-commerce); <code>POST /translation/lexicons/from-pack</code> with{" "}
               <code>{"{ industry, name? }"}</code> copies one into your project. Other endpoints:{" "}
               <code>GET|PATCH|DELETE /translation/lexicons/:id</code> and{" "}
               <code>DELETE /translation/lexicons/:id/terms/:termId</code>. Up to 2,000 terms per bulk upsert.
            </p>
         </Sec>

         <Sec id="meaningguard" title="MeaningGuard: flags and recovery">
            <p>
               MeaningGuard flags phrases that may be misunderstood. A flagged phrase arrives as a{" "}
               <code>flagged</code> event (<code>{"{ phraseId, reasons }"}</code>) and on the caption as{" "}
               <code>{"guard: { status: 'uncertain', reasons }"}</code>. There is never a percentage or confidence
               score. UI copy should say &quot;May not be accurate — check&quot;. A phrase that isn&apos;t flagged can
               still be wrong, and flags never hold back a translation.
            </p>
            <Table head={["Reason", "Meaning"]} rows={GUARD_REASONS} />
            <p>
               Recovery: <code>requestRepeat(phraseId)</code> sends the speaker a prompt in their own language with
               their original phrase.
            </p>
            <p>
               <strong>Replay of the original audio is off by default.</strong> A project owner can allow it (Dashboard
               → Project → Translation → &quot;Allow replay of original audio&quot;). When allowed, the server keeps
               about 30 seconds of audio per speaker in memory only, never written to disk and cleared at the end of
               the call, and both people see a &quot;Replay enabled&quot; indicator. A call can turn replay off with{" "}
               <code>guard.replay: false</code> but can&apos;t turn it on if the project doesn&apos;t allow it.
            </p>
         </Sec>

         <Sec id="costguard" title="CostGuard: budgets, limits and estimates">
            <p>
               Translation is billed per translated participant-minute (per listener) at the voice or captions rate,
               in credits. Rates are set by PurpleCallio and shown on the <Link href="/pricing#live-translate" className="text-[#6425C4] underline">pricing page</Link>{" "}
               and in your dashboard; a session keeps the rate it started with. Starting translation needs credits for
               at least one minute of the chosen mode.
            </p>
            <ul className="list-disc space-y-2 pl-5">
               <li>Per-call limit: <code>translation.maxMinutes</code>, plus a project default.</li>
               <li>Project budgets: daily and monthly credit caps and alert thresholds in <code>GET|PATCH /translation/settings</code> (clamped to the maximum PurpleCallio allows).</li>
               <li>Checked on the server at start and every few seconds while translating. At about 90% of a limit, both people get a warning.</li>
               <li>At the limit: with <code>onLimit: &quot;captions_then_off&quot;</code>, voice steps down to captions; otherwise translation pauses. <strong>The call itself is never ended.</strong></li>
               <li>Budget thresholds trigger a dashboard notification and the <code>translation.budget.threshold</code> webhook.</li>
            </ul>
            <p>Price preview (public; signed-in users see their own rate):</p>
            <CodeBlock code={LT_ESTIMATE_SNIPPET} filename="estimate.http" />
         </Sec>

         <Sec id="observability" title="Translation Observability: metrics">
            <p>
               <code>GET /translation/metrics?from&amp;to&amp;pair&amp;route</code> returns totals, latency (time to
               first translated audio and caption delay, p50 and p95), reliability (provider failures, fallbacks,
               dropped frames) and MeaningGuard counts, overall and per language pair. Metrics are aggregates; no
               transcript text is included. <code>GET /translation/languages</code> lists languages with separate{" "}
               <code>voice</code> and <code>captions</code> flags.
            </p>
            <CodeBlock code={LT_METRICS_SNIPPET} filename="metrics.http" />
         </Sec>

         <Sec id="post-call" title="Post-Call Suite: reports">
            <p>
               Opt-in. When the project enables the Post-Call Suite and the call doesn&apos;t set{" "}
               <code>postCallReport: false</code>, final phrases are stored (with keys, emails and card numbers redacted)
               for your retention period, and a report is built after the call. A report charge in credits applies
               once per report.
            </p>
            <p>
               <code>GET /calls/:id/translation-report</code> returns{" "}
               <code>{"{ status: 'pending' | 'ready' | 'failed', transcript, summary, signals, creditsCharged, createdAt }"}</code>,
               and <code>call.translation.report_ready</code> fires when it&apos;s done. The summary has key points,
               decisions and action items (each linked to a <code>phraseId</code>) in each participant&apos;s language.
               Signals include talk ratio, topics, flagged moments, replays and repeats.
            </p>
            <p>
               Tone is optional and off by default, and always off for healthcare projects. When on, it&apos;s worded
               as &quot;possible tone&quot; with supporting quotes, never as a fact about a person.
            </p>
         </Sec>

         <Sec id="webhooks" title="Webhooks">
            <p>Sent to your project webhook URL with the usual signature, the call payload and a <code>data</code> object.</p>
            <Table head={["Event", "data"]} rows={WEBHOOKS} />
         </Sec>

         <Sec id="errors" title="Error codes">
            <Table head={["Code", "Status", "Meaning"]} rows={ERRORS} />
         </Sec>

         <Sec id="limits" title="Limits">
            <ul className="list-disc space-y-2 pl-5">
               <li>1:1 calls only (caller and receiver).</li>
               <li><code>maxMinutes</code>: 1–600 per call. <code>context.purpose</code>: up to 200 characters.</li>
               <li>Lexicon bulk upsert: up to 2,000 terms per request.</li>
               <li>Audio frames: 16 kHz PCM16 mono, up to 32,000 bytes per frame and 100 frames per second; translated audio is 24 kHz.</li>
               <li>Concurrent translated calls per account are limited during early access.</li>
               <li>There is a short delay of a second or more before the listener hears the translation. We publish measured numbers at launch.</li>
            </ul>
         </Sec>
      </>
   );
}
