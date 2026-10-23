import { Check, Hand, RotateCcw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

/** Small static UI mocks for the feature blocks. Illustrative only. */

function Frame({ label, children }: { label: string; children: ReactNode }) {
   return (
      <div className="min-w-0 rounded-2xl border border-[#E7DFF5] bg-white p-5 shadow-[0_24px_50px_-30px_rgba(65,6,134,0.3)]" aria-hidden="true">
         <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#6425C4]">{label}</p>
         {children}
      </div>
   );
}

function DualViewMock() {
   return (
      <Frame label="DualView panel">
         <div className="grid grid-cols-2 gap-3 text-sm">
            <p className="text-xs font-semibold text-[#3D3650]">Original · मराठी</p>
            <p className="text-xs font-semibold text-[#3D3650]">Translation · English</p>
            {[
               ["डिलिव्हरी उद्या येईल.", "The delivery will arrive tomorrow."],
               ["सहा वाजता चालेल का?", "Is six o'clock okay?"],
            ].map(([o, t]) => (
               <div key={o} className="contents">
                  <p className="rounded-lg bg-[#F8F4FD] p-2 text-[#3D3650]" lang="mr">{o}</p>
                  <p className="rounded-lg bg-[#7F40E8]/10 p-2 font-medium text-[#170B2E]">{t}</p>
               </div>
            ))}
         </div>
         <div className="mt-3 flex gap-1.5 text-[10px]">
            {["Translation only", "Both", "Original only"].map((l) => (
               <span key={l} className={`rounded-full px-2 py-0.5 ${l === "Both" ? "bg-[#7F40E8] text-white" : "bg-[#F3ECFB] text-[#3D3650]"}`}>{l}</span>
            ))}
         </div>
      </Frame>
   );
}

function LexiconMock() {
   const rows = [
      ["CloudDesk", "Do not translate", "—"],
      ["follow-up", "Translate as", "hi: फ़ॉलो-अप"],
      ["Dr. Iyer", "Pronounce as", "doctor eye-yer"],
   ];
   return (
      <Frame label="PurpleLex lexicon editor">
         <table className="w-full text-left text-xs">
            <thead className="text-[#3D3650]">
               <tr>
                  <th className="pb-2 font-semibold">Term</th>
                  <th className="pb-2 font-semibold">Rule</th>
                  <th className="pb-2 font-semibold">Value</th>
               </tr>
            </thead>
            <tbody>
               {rows.map(([a, b, c]) => (
                  <tr key={a} className="border-t border-[#E7DFF5]">
                     <td className="py-2 font-semibold text-[#170B2E]">{a}</td>
                     <td className="py-2 text-[#6425C4]">{b}</td>
                     <td className="py-2 text-[#3D3650]">{c}</td>
                  </tr>
               ))}
            </tbody>
         </table>
         <p className="mt-3 text-[11px] text-[#3D3650]">Import CSV · Start from an industry pack</p>
      </Frame>
   );
}

function GuardMock() {
   return (
      <Frame label="Flagged phrase">
         <div className="rounded-xl bg-[#F8F4FD] p-3 ring-2 ring-amber-400">
            <p className="text-xs text-[#3D3650]" lang="hi">कुल रकम बारह सौ रुपये है।</p>
            <p className="mt-1 text-sm font-semibold text-[#170B2E]">The total is ₹2,100.</p>
            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
               <TriangleAlert size={12} /> May not be accurate — check
            </p>
            <p className="mt-1 font-mono text-[10px] text-[#3D3650]">reasons: term_mismatch:amount</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
               <span className="inline-flex items-center gap-1 rounded-full bg-[#7F40E8] px-2.5 py-1 font-semibold text-white">
                  <Hand size={12} /> Ask to repeat
               </span>
               <span className="inline-flex items-center gap-1 rounded-full border border-[#D6C4EE] px-2.5 py-1 text-[#3D3650]">
                  <RotateCcw size={12} /> Replay original (if enabled)
               </span>
            </div>
         </div>
      </Frame>
   );
}

function MetricsMock() {
   const pairs: [string, number][] = [
      ["hi → en", 62],
      ["mr → en", 74],
      ["ta → en", 81],
      ["en → bn", 55],
   ];
   return (
      <Frame label="Translation Observability · illustrative">
         <p className="text-xs font-semibold text-[#170B2E]">Time to first translated audio, p50 by language pair</p>
         <div className="mt-3 space-y-2">
            {pairs.map(([p, w]) => (
               <div key={p} className="flex items-center gap-2 text-[11px] text-[#3D3650]">
                  <span className="w-14 shrink-0 font-mono">{p}</span>
                  <span className="h-2 flex-1 rounded-full bg-[#F3ECFB]">
                     <span className="block h-full rounded-full bg-[#7F40E8]" style={{ width: `${w}%` }} />
                  </span>
               </div>
            ))}
         </div>
         <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px]">
            {["Flags by reason", "Provider failures", "Credits per minute"].map((l) => (
               <span key={l} className="rounded-lg bg-[#F8F4FD] p-2 text-[#3D3650]">{l}</span>
            ))}
         </div>
      </Frame>
   );
}

function BudgetMock() {
   return (
      <Frame label="CostGuard settings">
         <dl className="space-y-2 text-xs">
            {[
               ["Per-call limit", "30 minutes"],
               ["Monthly budget", "Set in credits"],
               ["Alerts", "50%, 80%, 100% of budget"],
               ["When a limit is reached", "Voice → captions → off"],
            ].map(([k, v]) => (
               <div key={k} className="flex justify-between gap-3 border-b border-[#E7DFF5] pb-2">
                  <dt className="text-[#3D3650]">{k}</dt>
                  <dd className="font-semibold text-[#170B2E]">{v}</dd>
               </div>
            ))}
         </dl>
         <div className="mt-3 h-2 rounded-full bg-[#F3ECFB]">
            <span className="block h-full w-4/5 rounded-full bg-amber-400" />
         </div>
         <p className="mt-2 text-[11px] text-[#3D3650]">Monthly budget alert reached. The call itself never drops.</p>
      </Frame>
   );
}

function ReportMock() {
   return (
      <Frame label="Post-Call Suite report">
         <pre className="overflow-x-auto text-[11px] leading-5 text-[#3D3650]">{`{
  "status": "ready",
  "summary": {
    "en": { "keyPoints": [...], "actionItems": [
      { "text": "Send revised quote", "phraseId": "caller-14" }
    ] },
    "mr": { "keyPoints": [...] }
  },
  "signals": { "talkRatio": {...}, "flaggedMoments": [...] }
}`}</pre>
      </Frame>
   );
}

function KitMock() {
   return (
      <Frame label="Translation UI Kit">
         <ul className="space-y-2 text-xs">
            {["<DualViewCaptions />", "<TranslatedChatView />", "<LanguagePicker />", "<TranslationControls />", "useTranslation()"].map((c) => (
               <li key={c} className="flex items-center gap-2 font-mono text-[#170B2E]">
                  <Check size={12} className="text-[#7F40E8]" /> {c}
               </li>
            ))}
         </ul>
         <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            {["हिन्दी", "தமிழ்", "मराठी", "বাংলা"].map((l) => (
               <span key={l} className="rounded-full bg-[#F3ECFB] px-2 py-0.5 text-[#170B2E]">{l}</span>
            ))}
            <span dir="rtl" className="rounded-full bg-[#F3ECFB] px-2 py-0.5 text-[#170B2E]">اردو</span>
         </div>
      </Frame>
   );
}

export const FEATURE_MOCKS: Record<string, () => ReactNode> = {
   dualview: DualViewMock,
   purplelex: LexiconMock,
   meaningguard: GuardMock,
   observability: MetricsMock,
   costguard: BudgetMock,
   "post-call": ReportMock,
   "ui-kit": KitMock,
};
