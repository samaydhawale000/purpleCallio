"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
   Gauge,
   PhoneCall,
   Video,
   Monitor,
   Clock,
   Wallet,
   ArrowUpRight,
   Receipt,
   Mic,
} from "lucide-react";
import { useAuthStore } from "../../store/auth.store";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { api } from "../../lib/api";
import { Badge } from "../../components/ui/Badge";
import { Pagination } from "../../components/ui/Pagination";

interface CurrentUsage {
   cycle: { start: string; end: string };
   usage: {
      audioMinutes: number;
      videoMinutes: number;
      screenShareMinutes: number;
      participants: number;
      callsCreated: number;
      callsCompleted: number;
   };
   freeAllowance: { audioMinutes: number; videoMinutes: number };
   rates: { audioPaise: number; videoPaise: number; screenSharePaise: number };
   cost: {
      audioPaise: number;
      videoPaise: number;
      screenSharePaise: number;
      totalPaise: number;
   };
   estimatedMonthEndPaise: number;
   isFreeTier?: boolean;
   hasPaymentMethod?: boolean;
   freeUsagePercent?: number;
}

interface CallUse {
   id: string;
   callId: string;
   audioMinutes: number;
   videoMinutes: number;
   screenShareMinutes: number;
   participants: number;
   costPaise: number;
   billedCostPaise: number;
   startedAt: string | null;
   endedAt: string | null;
   createdAt: string;
   // Wall-clock seconds (display context only — not billable usage).
   durationSeconds?: {
      callSeconds?: number;
      audioSeconds: number;
      videoSeconds: number;
      screenShareSeconds: number;
   };
}

interface ChartPoint {
   date: string;
   label: string;
   minutes: number;
   calls: number;
}

interface SegmentView {
   id: string;
   startedAt: string;
   endedAt: string;
   participantCount: number;
   audio: boolean;
   video: boolean;
   screenShare: boolean;
   // Rated participant-minutes for this segment, computed per participant
   // by the backend rating engine.
   audioMinutes?: number;
   videoMinutes?: number;
   screenShareMinutes?: number;
   costPaise: number;
}

const paiseToINR = (paise: number | null | undefined) =>
   `₹${((Number.isFinite(paise) ? Number(paise) : 0) / 100).toFixed(2)}`;

// Real wall-clock duration, given actual elapsed seconds (from the call's
// segment timeline) rather than guessed by dividing participant-minutes by
// participant count. Use this for per-call display; only billing math
// should ever use participant-minutes.
function formatDuration(totalSecondsRaw: number) {
   const totalSeconds = Math.max(0, Math.round(totalSecondsRaw));
   const wholeMinutes = Math.floor(totalSeconds / 60);
   const seconds = totalSeconds % 60;
   if (wholeMinutes === 0) return `${seconds} sec`;
   if (seconds === 0) return `${wholeMinutes} min`;
   return `${wholeMinutes} min ${seconds} sec`;
}

// Participant-minutes are billed values from the backend rating engine;
// this only formats them for display (no rounding of stored values).
function formatParticipantMinutes(value: number | null | undefined) {
   return (Number.isFinite(value) ? Number(value) : 0).toFixed(2);
}

export default function UsagePage() {
   const { token, logout } = useAuthStore();
   const router = useRouter();
   const { isReady } = useRequireAuth();

   const [usage, setUsage] = useState<CurrentUsage | null>(null);
   const [callUsage, setCallUsage] = useState<CallUse[]>([]);
   const [chart, setChart] = useState<ChartPoint[]>([]);
   const [loading, setLoading] = useState(true);
   const [expandedCall, setExpandedCall] = useState<string | null>(null);
   const [segments, setSegments] = useState<Record<string, SegmentView[]>>({});
   const [segmentLoading, setSegmentLoading] = useState<string | null>(null);
   const [callPage, setCallPage] = useState(1);
   const [callPageSize, setCallPageSize] = useState(10);
   const [callTotal, setCallTotal] = useState(0);
   const [callPageCount, setCallPageCount] = useState(1);

   const toggleSegment = useCallback(
      async (callId: string) => {
         if (expandedCall === callId) {
            setExpandedCall(null);
            return;
         }
         setExpandedCall(callId);
         if (!segments[callId]) {
            setSegmentLoading(callId);
            try {
               const res = await api.get(`/billing/call/${callId}/segments`);
               setSegments((prev) => ({
                  ...prev,
                  [callId]: res.data.segments ?? [],
               }));
            } catch (e) {
               setSegments((prev) => ({ ...prev, [callId]: [] }));
            } finally {
               setSegmentLoading(null);
            }
         }
      },
      [expandedCall, segments, api],
   );

   const fetchCallUsage = useCallback(async () => {
      try {
         const callRes = await api.get(`/billing/call-usage?page=${callPage}`);
         setCallUsage(callRes.data.data ?? []);
         setCallTotal(callRes.data.total ?? 0);
         setCallPageCount(callRes.data.pageCount ?? 1);
         setCallPageSize(callRes.data.pageSize ?? 10);
      } catch (e: any) {
         if (e?.response?.status === 401) {
            logout();
            router.push("/login");
         }
      }
   }, [callPage, logout, router]);

   const fetchData = useCallback(async () => {
      try {
         const [usageRes, chartRes] = await Promise.all([
            api.get("/billing/current-usage"),
            api.get("/dashboard/usage/chart?days=14"),
         ]);
         setUsage(usageRes.data);
         setChart(chartRes.data);
      } catch (e: any) {
         if (e?.response?.status === 401) {
            logout();
            router.push("/login");
         }
      } finally {
         setLoading(false);
      }
   }, [logout, router]);

   useEffect(() => {
      if (!isReady) return;
      if (!token) {
         router.push("/login");
         return;
      }
      fetchData();
   }, [isReady, token, fetchData, router]);

   useEffect(() => {
      if (!isReady || !token) return;
      fetchCallUsage();
   }, [isReady, token, fetchCallUsage]);

   if (loading) {
      return (
         <div className="flex items-center justify-center min-h-[60vh]">
            <div className="flex flex-col items-center gap-3">
               <svg
                  className="animate-spin h-6 w-6 text-[#7F40E8]"
                  viewBox="0 0 24 24"
                  fill="none"
               >
                  <circle
                     className="opacity-25"
                     cx="12"
                     cy="12"
                     r="10"
                     stroke="currentColor"
                     strokeWidth="4"
                  />
                  <path
                     className="opacity-75"
                     fill="currentColor"
                     d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
               </svg>
               <span className="text-sm text-[#3D3650]">Loading usage…</span>
            </div>
         </div>
      );
   }

   const u = usage?.usage;
   const cost = usage?.cost;
   const free = usage?.freeAllowance;
   const rates = usage?.rates;
   const paiseToINRShort = (p: number | null | undefined) =>
      `₹${((Number.isFinite(p) ? Number(p) : 0) / 100).toFixed(2)}`;
   const maxMin = Math.max(...chart.map((d) => d.minutes), 1);
   const totalCallsInChart = chart.reduce((acc, d) => acc + d.calls, 0);
   const totalBillableMinutes =
      (u?.audioMinutes ?? 0) +
      (u?.videoMinutes ?? 0) +
      (u?.screenShareMinutes ?? 0);

   return (
      <div className="flex flex-col gap-6">
         <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-[#170B2E]">Current Usage</h1>
            {usage?.isFreeTier && (
               <span
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-mono font-semibold uppercase tracking-wider text-emerald-700"
                  style={{
                     background: "rgba(16,185,129,0.10)",
                     borderColor: "rgba(16,185,129,0.35)",
                  }}
               >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Free tier active
               </span>
            )}
            <p className="w-full text-sm text-[#3D3650] mt-1">
               Pay only for what you use. Track participant-minutes and cost by media type.
            </p>
         </div>

         {/* Free-tier near-limit warning */}
         {usage?.isFreeTier && (usage.freeUsagePercent ?? 0) >= 90 && (
            <div
               className="rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center gap-4"
               style={{
                  background:
                     "linear-gradient(135deg, rgba(251,191,36,0.12), rgba(244,63,94,0.10))",
                  borderColor: "rgba(251,191,36,0.4)",
               }}
            >
               <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                     background: "rgba(251,191,36,0.15)",
                     border: "1px solid rgba(251,191,36,0.3)",
                  }}
               >
                  <Wallet size={18} style={{ color: "#FBBF24" }} />
               </div>
               <div className="flex-1">
                  <p className="text-sm font-semibold text-[#170B2E]">
                     You&apos;ve used {usage.freeUsagePercent}% of your free
                     allowance
                  </p>
                  <p className="text-xs text-[#3D3650] mt-0.5">
                     Audio and video beyond your free limit will be billed per
                     participant-minute.{" "}
                     {usage.hasPaymentMethod
                        ? "Your saved card will be charged automatically at month end."
                        : "Add a payment method to avoid interruption when your free allowance runs out."}
                  </p>
               </div>
               <Link
                  href="/dashboard/billing"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#170B2E] px-4 py-2 rounded-lg transition-all hover:opacity-90 shrink-0"
                  style={{
                     background: "linear-gradient(135deg, #F59E0B, #F43F5E)",
                  }}
               >
                  {usage.hasPaymentMethod
                     ? "View billing"
                     : "Add payment method"}
                  <ArrowUpRight size={14} />
               </Link>
            </div>
         )}

         {/* Overview cards */}
         <div
            className={`grid grid-cols-2 gap-4 ${usage?.isFreeTier ? "sm:grid-cols-2" : "sm:grid-cols-4"}`}
         >
            <UsageCard
               icon={Clock}
               label="Total Usage"
               value={totalBillableMinutes.toFixed(2)}
               unit="participant-min"
               color="#410686"
               hint="Sum of duration × participants using that media, across audio/video/screen share — not raw call length."
            />
            <UsageCard
               icon={PhoneCall}
               label="Total Calls"
               value={u?.callsCompleted ?? 0}
               color="#7F40E8"
            />
            {!usage?.isFreeTier && (
               <>
                  <UsageCard
                     icon={Wallet}
                     label="Current Cost"
                     value={paiseToINR(cost?.totalPaise ?? 0)}
                     color="#10B981"
                  />
                  <UsageCard
                     icon={Gauge}
                     label="Est. Month-end"
                     value={paiseToINR(usage?.estimatedMonthEndPaise ?? 0)}
                     color="#F59E0B"
                     hint="Projected total for the full cycle, based on your usage so far — not an additional charge."
                  />
               </>
            )}
         </div>

         {/* Per-type breakdown + cost */}
         <div
            className="rounded-2xl border border-[#D6C4EE] p-6"
            style={{
               background:
                  "linear-gradient(135deg, rgba(127,64,232,0.08), rgba(65,6,134,0.04))",
            }}
         >
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
               <div>
                  <p className="text-sm font-semibold text-[#170B2E]">
                     Usage by media type
                  </p>
                  <p className="text-xs text-[#3D3650] mt-0.5">
                     {free ? `Free tier: ${free.audioMinutes} audio + ${free.videoMinutes} video participant-min/month · screen share always paid` : 'Free allowance loading'}
                  </p>
               </div>
               <Link
                  href="/dashboard/billing"
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#6425C4] hover:text-[#6425C4] transition-colors"
               >
                  Billing &amp; Usage <ArrowUpRight size={14} />
               </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
               <TypeRow
                  icon={<PhoneCall size={16} style={{ color: "#7F40E8" }} />}
                  label="Audio"
                  minutes={u?.audioMinutes ?? 0}
                  costPaise={cost?.audioPaise ?? 0}
                  freeOf={free?.audioMinutes ?? 0}
                  rate={rates ? `${paiseToINRShort(rates.audioPaise)} / participant-min` : 'Loading rate…'}
                  showCost
               />
               <TypeRow
                  icon={<Video size={16} style={{ color: "#A05DF9" }} />}
                  label="Video"
                  minutes={u?.videoMinutes ?? 0}
                  costPaise={cost?.videoPaise ?? 0}
                  freeOf={free?.videoMinutes ?? 0}
                  rate={rates ? `${paiseToINRShort(rates.videoPaise)} / participant-min` : 'Loading rate…'}
                  showCost
               />
               <TypeRow
                  icon={<Monitor size={16} style={{ color: "#34D399" }} />}
                  label="Screen Share"
                  minutes={u?.screenShareMinutes ?? 0}
                  costPaise={cost?.screenSharePaise ?? 0}
                  freeOf={0}
                  rate={rates ? `${paiseToINRShort(rates.screenSharePaise)} / participant-min` : 'Loading rate…'}
                  showCost
               />
            </div>
         </div>

         {/* Chart */}
         <div
            className="rounded-2xl border border-[#E7DFF5] p-6"
            style={{ background: "#FFFFFF" }}
         >
            <div className="flex flex-wrap items-center justify-between mb-6">
               <div>
                  <p className="text-sm font-semibold text-[#170B2E]">
                     Call time — Last 14 Days
                  </p>
                  <p className="text-xs text-[#3D3650] mt-0.5">
                     {totalCallsInChart} calls in this period · wall-clock
                     minutes, not billed participant-minutes
                  </p>
               </div>
            </div>
            {chart.length === 0 ? (
               <div className="flex h-48 items-center justify-center text-xs text-[#3D3650]">
                  No usage data for this period.
               </div>
            ) : (
               <div className="flex h-48 items-end justify-between gap-2">
                  {chart.map((d) => (
                     <div
                        key={d.date}
                        className="flex h-full flex-1 min-w-0 flex-col items-center justify-end gap-2"
                     >
                        <span className="text-[10px] text-[#3D3650]">
                           {d.minutes > 0 ? d.minutes.toFixed(2) : ""}
                        </span>
                        <div className="flex h-full w-full items-end">
                           <div
                              className="min-h-[4px] w-full rounded-t-md transition-all"
                              style={{
                                 height: `${Math.max(4, (d.minutes / maxMin) * 100)}%`,
                                 background:
                                    "linear-gradient(180deg, #7F40E8, rgba(127,64,232,0.25))",
                              }}
                              title={`${d.label}: ${d.minutes.toFixed(2)} min call time, ${d.calls} calls`}
                           />
                        </div>
                        <span className="text-[10px] text-[#3D3650]">
                           {d.label}
                        </span>
                     </div>
                  ))}
               </div>
            )}
         </div>

         {/* Call analytics */}
         <div
            className="rounded-2xl border border-[#E7DFF5] p-6"
            style={{ background: "#FFFFFF" }}
         >
            <div className="flex items-center justify-between mb-4">
               <div>
                  <p className="text-sm font-semibold text-[#170B2E]">
                     Call analytics
                  </p>
                  <p className="text-xs text-[#3D3650] mt-0.5">
                     {usage?.isFreeTier
                        ? `Per-call usage and charge after your free allowance is applied.`
                        : "Per-call usage and charge for this billing cycle."}
                  </p>
                  <p className="text-[11px] text-[#3D3650] mt-1">
                     Usage is shown in participant-minutes. Call duration is the
                     wall-clock duration; billing multiplies each
                     participant&apos;s active media time.
                  </p>
               </div>
               <span className="text-xs text-[#3D3650]">{callTotal} calls</span>
            </div>

            {callUsage.length === 0 ? (
               <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <Receipt size={24} className="text-[#3D3650]" />
                  <p className="text-sm text-[#3D3650]">
                     No call usage recorded yet.
                  </p>
               </div>
            ) : (
               <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                     <thead>
                        <tr className="text-left text-xs text-[#3D3650] border-b border-[#E7DFF5]">
                           <th className="py-2 pr-4 font-medium">Call</th>
                           <th className="py-2 pr-4 font-medium">
                              Audio{" "}
                              <span className="font-normal">(participant-min)</span>
                           </th>
                           <th className="py-2 pr-4 font-medium">
                              Video{" "}
                              <span className="font-normal">(participant-min)</span>
                           </th>
                           <th className="py-2 pr-4 font-medium">
                              Screen{" "}
                              <span className="font-normal">(participant-min)</span>
                           </th>
                           <th className="py-2 pr-4 font-medium">
                              Participants
                           </th>
                           <th className="py-2 font-medium">Charge</th>
                        </tr>
                     </thead>
                     <tbody>
                        {callUsage.map((c) => {
                           const open = expandedCall === c.callId;
                           return (
                              <Fragment key={c.id}>
                                 <tr
                                    className="border-b border-[#E7DFF5]/60 last:border-0 cursor-pointer select-none"
                                    onClick={() => toggleSegment(c.callId)}
                                 >
                                    <td className="py-3 pr-4">
                                       <p className="font-mono text-xs text-[#3D3650] flex items-center gap-1.5">
                                          <span className="text-[#3D3650] inline-block w-3 text-center">
                                             {open ? "▾" : "▸"}
                                          </span>
                                          {c.callId.slice(0, 12)}…
                                       </p>
                                       <p className="text-[10px] text-[#3D3650] mt-0.5 pl-[18px]">
                                          {c.startedAt
                                             ? new Date(
                                                  c.startedAt,
                                               ).toLocaleDateString("en-IN")
                                             : "—"}
                                       </p>
                                    </td>
                                    <td
                                       className="py-3 pr-4 text-[#3D3650] whitespace-nowrap"
                                       data-testid="call-audio"
                                    >
                                       {formatParticipantMinutes(c.audioMinutes)}{" "}
                                       participant-min
                                    </td>
                                    <td
                                       className="py-3 pr-4 text-[#3D3650] whitespace-nowrap"
                                       data-testid="call-video"
                                    >
                                       {formatParticipantMinutes(c.videoMinutes)}{" "}
                                       participant-min
                                    </td>
                                    <td
                                       className="py-3 pr-4 text-[#3D3650] whitespace-nowrap"
                                       data-testid="call-screen"
                                    >
                                       {formatParticipantMinutes(
                                          c.screenShareMinutes,
                                       )}{" "}
                                       participant-min
                                    </td>
                                    <td className="py-3 pr-4 text-[#3D3650]">
                                       {c.participants}
                                    </td>
                                    <td className="py-3 font-medium text-[#170B2E]">
                                       {paiseToINR(c.billedCostPaise)}
                                    </td>
                                 </tr>
                                 {open && (
                                    <tr>
                                       <td colSpan={6} className="py-3 px-4">
                                          <CallUsageDetail call={c} />
                                          <SegmentTimeline
                                             callId={c.callId}
                                             loading={
                                                segmentLoading === c.callId
                                             }
                                             segments={segments[c.callId] ?? []}
                                             showCost={false}
                                          />
                                       </td>
                                    </tr>
                                 )}
                              </Fragment>
                           );
                        })}
                     </tbody>
                  </table>
                  <Pagination
                     page={callPage}
                     pageCount={callPageCount}
                     totalItems={callTotal}
                     pageSize={callPageSize}
                     onPageChange={setCallPage}
                  />
               </div>
            )}
         </div>

         {/* How it works */}
         <div
            className="flex items-start gap-3 rounded-2xl border border-[#E7DFF5] p-5"
            style={{ background: "#FFFFFF" }}
         >
            <div
               className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
               style={{
                  background: "rgba(127,64,232,0.1)",
                  border: "1px solid rgba(127,64,232,0.2)",
               }}
            >
               <Gauge size={16} style={{ color: "#7F40E8" }} />
            </div>
            <div>
               <p className="text-sm font-medium text-[#170B2E]">
                  How usage is billed
               </p>
               <p className="text-xs text-[#3D3650] mt-0.5">
                  Usage is calculated to the second, per participant, from when
                  a call connects until it ends. Anything beyond the free
                  allowance is billed at{" "}
                  {rates ? `${paiseToINRShort(rates.audioPaise)} (audio), ${paiseToINRShort(rates.videoPaise)} (video), and ${paiseToINRShort(rates.screenSharePaise)} (screen sharing)` : 'current rates loading'}{" "}
                  per participant-minute. An invoice is generated
                  and your card charged on the 1st of each month.
               </p>
            </div>
         </div>
      </div>
   );
}

function UsageCard({
   icon: Icon,
   label,
   value,
   unit,
   color,
   hint,
}: {
   icon: any;
   label: string;
   value: any;
   unit?: string;
   color: string;
   hint?: string;
}) {
   return (
      <div
         className="rounded-2xl border border-[#E7DFF5] p-5"
         style={{ background: "#FFFFFF" }}
         title={hint}
      >
         <div
            className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
            style={{ background: `${color}1A`, border: `1px solid ${color}33` }}
         >
            <Icon size={16} style={{ color }} />
         </div>
         <p className="text-xs text-[#3D3650] mb-1">{label}</p>
         <p className="text-2xl font-bold text-[#170B2E]">
            {value}
            {unit && (
               <span className="text-xs font-normal text-[#3D3650]">
                  {" "}
                  {unit}
               </span>
            )}
         </p>
      </div>
   );
}

function TypeRow({
   icon,
   label,
   minutes,
   costPaise,
   freeOf,
   rate,
   showCost,
}: {
   icon: React.ReactNode;
   label: string;
   minutes: number;
   costPaise: number;
   freeOf: number;
   rate: string;
   showCost?: boolean;
}) {
   const pct =
      freeOf > 0
         ? Math.min(100, Math.round((minutes / freeOf) * 100))
         : Math.min(100, minutes > 0 ? 100 : 0);
   const remaining = freeOf > 0 ? Math.max(0, freeOf - minutes) : 0;
   return (
      <div
         className="rounded-xl border border-[#E7DFF5] p-4"
         style={{ background: "#F8F4FD" }}
      >
         <div className="flex items-center gap-1.5 mb-1">
            {icon}
            <p className="text-xs text-[#3D3650]">{label}</p>
         </div>
         <p className="text-lg font-bold text-[#170B2E]">
            {minutes.toFixed(2)}
            <span className="text-xs font-normal text-[#3D3650]">
               {" "}
               participant-min
            </span>
         </p>
         {showCost && (
            <p className="text-xs font-semibold mt-1 text-[#6425C4]">
               {paiseToINR(costPaise)}
            </p>
         )}
         <p className="text-[11px] text-[#3D3650] mt-0.5">{rate}</p>
         {freeOf > 0 && (
            <div className="mt-2.5">
               <div className="flex items-center justify-between text-[10px] text-[#3D3650] mb-1">
                  <span>
                     {remaining.toFixed(2)} / {freeOf} participant-min remaining
                  </span>
                  <span>{pct}%</span>
               </div>
               <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ background: "#E7DFF5" }}
               >
                  <div
                     className="h-full rounded-full"
                     style={{
                        width: `${pct}%`,
                        background:
                           pct >= 90
                              ? "linear-gradient(135deg,#f43f5e,#fb7185)"
                              : "linear-gradient(135deg,#7F40E8,#410686)",
                     }}
                  />
               </div>
            </div>
         )}
      </div>
   );
}

function SegmentTimeline({
   callId,
   segments,
   loading,
   showCost,
}: {
   callId: string;
   segments: SegmentView[];
   loading: boolean;
   showCost?: boolean;
}) {
   if (loading) {
      return (
         <div className="rounded-lg border border-[#E7DFF5] p-4 text-center text-xs text-[#3D3650]">
            Loading segment timeline…
         </div>
      );
   }

   if (segments.length === 0) {
      return (
         <div className="rounded-lg border border-[#E7DFF5] p-4 text-center text-xs text-[#3D3650]">
            No media segments recorded for this call.
         </div>
      );
   }

   const totalCost = segments.reduce((acc, s) => acc + (s.costPaise ?? 0), 0);
   const fmtTime = (iso: string) =>
      new Date(iso).toLocaleTimeString("en-IN", {
         hour: "2-digit",
         minute: "2-digit",
         second: "2-digit",
      });

   return (
      <div
         className="rounded-lg border border-[#E7DFF5] p-4"
         style={{ background: "#F8F4FD" }}
      >
         <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-[#170B2E]">Segment timeline</p>
            <p className="text-xs text-[#3D3650]">
               {segments.length} segments
               {showCost && (
                  <>
                     {" "}
                     ·{" "}
                     <span className="text-[#6425C4]">
                        {paiseToINR(totalCost)}
                     </span>
                  </>
               )}
            </p>
         </div>
         <div className="space-y-2">
            {segments.map((s, i) => {
               const durSec = Math.max(
                  0,
                  (new Date(s.endedAt).getTime() -
                     new Date(s.startedAt).getTime()) /
                     1000,
               );
               const badges = [
                  s.audio && { label: "Audio", Icon: Mic },
                  s.video && { label: "Video", Icon: Video },
                  s.video &&
                     s.screenShare && { label: "Screen", Icon: Monitor },
               ].filter(Boolean) as { label: string; Icon: typeof Mic }[];
               return (
                  <div
                     key={s.id ?? i}
                     className="flex items-center justify-between gap-3 rounded-lg border border-[#E7DFF5]/60 px-3 py-2"
                  >
                     <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                           <span className="text-[10px] font-mono text-[#3D3650]">
                              {fmtTime(s.startedAt)}
                           </span>
                           <span className="text-[#3D3650]">→</span>
                           <span className="text-[10px] font-mono text-[#3D3650]">
                              {fmtTime(s.endedAt)}
                           </span>
                           {badges.map(({ label, Icon }) => (
                              <span
                                 key={label}
                                 className="text-[10px] px-1.5 py-0.5 rounded-full"
                                 style={{
                                    background: "rgba(127,64,232,0.1)",
                                    border: "1px solid rgba(127,64,232,0.2)",
                                    color: "#410686",
                                 }}
                              >
                                 <Icon
                                    size={11}
                                    className="mr-1 inline-block"
                                 />
                                 {label}
                              </span>
                           ))}
                        </div>
                        <p className="text-[10px] text-[#3D3650] mt-0.5">
                           {formatDuration(durSec)} wall-clock ·{" "}
                           {s.participantCount || 1} participant
                           {(s.participantCount || 1) > 1 ? "s" : ""}
                        </p>
                        <p
                           className="text-[10px] text-[#3D3650] mt-0.5"
                           data-testid="segment-participant-minutes"
                        >
                           {segmentUsageLabel(s)}
                        </p>
                     </div>
                     {showCost && (
                        <p className="text-xs font-medium text-[#170B2E] whitespace-nowrap">
                           {paiseToINR(s.costPaise ?? 0)}
                        </p>
                     )}
                  </div>
               );
            })}
         </div>
      </div>
   );
}

// Per-media participant-minutes for a segment, as rated by the backend
// (each participant's own media state), e.g. "Video 1.10 participant-min".
function segmentUsageLabel(s: SegmentView) {
   const parts = [
      { label: "Audio", value: s.audioMinutes ?? 0 },
      { label: "Video", value: s.videoMinutes ?? 0 },
      { label: "Screen share", value: s.screenShareMinutes ?? 0 },
   ].filter((p) => p.value > 0);
   if (parts.length === 0) return "0.00 participant-min";
   return parts
      .map((p) => `${p.label} ${formatParticipantMinutes(p.value)} participant-min`)
      .join(" · ");
}

// Expanded-row context: billed participant-minutes (primary) alongside the
// wall-clock call duration and participant count (secondary).
function CallUsageDetail({ call }: { call: CallUse }) {
   const d = call.durationSeconds;
   const callSeconds =
      d?.callSeconds ??
      (call.startedAt && call.endedAt
         ? (new Date(call.endedAt).getTime() -
              new Date(call.startedAt).getTime()) /
           1000
         : 0);
   const rows = [
      {
         label: "Audio",
         value: call.audioMinutes,
         activeSeconds: d?.audioSeconds ?? 0,
      },
      {
         label: "Video",
         value: call.videoMinutes,
         activeSeconds: d?.videoSeconds ?? 0,
      },
      {
         label: "Screen share",
         value: call.screenShareMinutes,
         activeSeconds: d?.screenShareSeconds ?? 0,
      },
   ];
   return (
      <div
         className="mb-3 rounded-lg border border-[#E7DFF5] p-4"
         style={{ background: "#FFFFFF" }}
         data-testid="call-usage-detail"
      >
         <p className="text-xs text-[#3D3650]">
            Call duration:{" "}
            <span className="font-medium text-[#170B2E]">
               {formatDuration(callSeconds)} wall-clock
            </span>{" "}
            · Participants:{" "}
            <span className="font-medium text-[#170B2E]">
               {call.participants}
            </span>
         </p>
         <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {rows.map((r) => (
               <div key={r.label}>
                  <p className="text-[11px] text-[#3D3650]">{r.label}</p>
                  <p className="text-sm font-semibold text-[#170B2E]">
                     {formatParticipantMinutes(r.value)} participant-min
                  </p>
                  <p className="text-[10px] text-[#3D3650]">
                     {formatDuration(r.activeSeconds)} with {r.label.toLowerCase()}{" "}
                     on (wall-clock)
                  </p>
               </div>
            ))}
         </div>
      </div>
   );
}
