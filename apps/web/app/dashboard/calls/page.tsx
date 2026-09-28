"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneCall, Video, Phone, Search, Filter } from "lucide-react";
import { useAuthStore } from "../../store/auth.store";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { api } from "../../lib/api";
import { Badge } from "../../components/ui/Badge";
import { Input } from "../../components/ui/Input";
import { Pagination } from "../../components/ui/Pagination";

interface Call {
   id: string;
   projectId: string;
   callerId: string;
   receiverId: string;
   type: "AUDIO" | "VIDEO";
   status: string;
   startedAt: string | null;
   endedAt: string | null;
   createdAt: string;
   project?: { id: string; name: string };
   events?: { id: string; event: string; createdAt: string }[];
}

type StatusFilter =
   | "ALL"
   | "ACCEPTED"
   | "RINGING"
   | "INITIATED"
   | "REJECTED"
   | "MISSED"
   | "ENDED";

export default function CallsPage() {
   const { token, logout } = useAuthStore();
   const router = useRouter();
   const { isReady } = useRequireAuth();

   const [calls, setCalls] = useState<Call[]>([]);
   const [loading, setLoading] = useState(true);
   const [query, setQuery] = useState("");
   const [status, setStatus] = useState<StatusFilter>("ALL");
   const [selected, setSelected] = useState<Call | null>(null);
   const [page, setPage] = useState(1);
   const [pageSize, setPageSize] = useState(10);
   const [totalCalls, setTotalCalls] = useState(0);
   const [pageCount, setPageCount] = useState(1);

   const fetchCalls = useCallback(async () => {
      setLoading(true);
      try {
         const params = new URLSearchParams({
            page: String(page),
         });
         if (query.trim()) params.set("search", query.trim());
         if (status !== "ALL") params.set("status", status);

         const res = await api.get(`/dashboard/calls?${params.toString()}`);
         setCalls(res.data.data ?? []);
         setTotalCalls(res.data.total ?? 0);
         setPageCount(res.data.pageCount ?? 1);
         setPageSize(res.data.pageSize ?? 10);
      } catch {
         logout();
         router.push("/login");
      } finally {
         setLoading(false);
      }
   }, [logout, page, query, router, status]);

   useEffect(() => {
      if (!isReady) return;
      if (!token) {
         router.push("/login");
         return;
      }
      fetchCalls();
   }, [isReady, token, fetchCalls, router]);

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
               <span className="text-sm text-[#3D3650]">Loading calls…</span>
            </div>
         </div>
      );
   }

   return (
      <div className="flex flex-col gap-6">
         <div>
            <h1 className="text-2xl font-bold text-[#170B2E]">Calls</h1>
            <p className="text-sm text-[#3D3650] mt-1">
               Full call history across all your projects.
            </p>
         </div>

         {/* Filters */}
         <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
               <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3D3650]"
               />
               <Input
                  placeholder="Search by call ID, caller, receiver, or project…"
                  value={query}
                  onChange={(e) => {
                     setQuery(e.target.value);
                     setPage(1);
                  }}
                  className="pl-9"
               />
            </div>
            <div className="flex items-center gap-2 overflow-x-auto">
               <Filter size={15} className="text-[#3D3650] shrink-0" />
               {(
                  [
                     "ALL",
                     "ACCEPTED",
                     "RINGING",
                     "INITIATED",
                     "REJECTED",
                     "MISSED",
                     "ENDED",
                  ] as StatusFilter[]
               ).map((s) => (
                  <button
                     key={s}
                     onClick={() => {
                        setStatus(s);
                        setPage(1);
                     }}
                     className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border ${
                        status === s
                           ? "text-[#170B2E] border-[#7F40E8]/50"
                           : "text-[#3D3650] border-[#E7DFF5] hover:border-[#D6C4EE] hover:text-[#170B2E]"
                     }`}
                     style={
                        status === s
                           ? { background: "rgba(127,64,232,0.15)" }
                           : { background: "#FFFFFF" }
                     }
                  >
                     {s === "ALL" ? "All" : statusLabel(s)}
                  </button>
               ))}
            </div>
         </div>

         {calls.length === 0 ? (
            <div
               className="rounded-2xl border border-[#E7DFF5] py-16 px-6 text-center"
               style={{ background: "#FFFFFF" }}
            >
               <div
                  className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4"
                  style={{
                     background: "rgba(127,64,232,0.1)",
                     border: "1px solid rgba(127,64,232,0.2)",
                  }}
               >
                  <PhoneCall size={24} style={{ color: "#7F40E8" }} />
               </div>
               <p className="text-base font-semibold text-[#170B2E] mb-1">
                  {totalCalls === 0 ? "No calls yet" : "No matching calls"}
               </p>
               <p className="text-sm text-[#3D3650]">
                  {totalCalls === 0
                     ? "Your call history will appear here once you make your first call."
                     : "Try adjusting your search or filters."}
               </p>
            </div>
         ) : (
            <div
               className="rounded-2xl border border-[#E7DFF5] overflow-hidden"
               style={{ background: "#FFFFFF" }}
            >
               <div className="divide-y divide-[#E7DFF5]">
                  {calls.map((call) => (
                     <button
                        key={call.id}
                        onClick={() => setSelected(call)}
                        className="w-full flex flex-wrap items-center gap-3 px-5 py-4 text-left hover:bg-[#7F40E8]/[0.03] transition-colors"
                     >
                        <div
                           className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                           style={{
                              background:
                                 call.type === "VIDEO"
                                    ? "rgba(65,6,134,0.12)"
                                    : "rgba(127,64,232,0.12)",
                              border: `1px solid ${call.type === "VIDEO" ? "rgba(65,6,134,0.25)" : "rgba(127,64,232,0.25)"}`,
                           }}
                        >
                           {call.type === "VIDEO" ? (
                              <Video size={17} style={{ color: "#A05DF9" }} />
                           ) : (
                              <Phone size={17} style={{ color: "#7F40E8" }} />
                           )}
                        </div>
                        <div className="min-w-0 flex-1">
                           <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-[#170B2E]">
                                 {call.type === "VIDEO"
                                    ? "Video Call"
                                    : "Voice Call"}
                              </p>
                              <Badge variant={statusBadge(call.status)}>
                                 {statusLabel(call.status)}
                              </Badge>
                           </div>
                           <p className="text-xs text-[#3D3650] mt-0.5">
                              {new Date(call.createdAt).toLocaleString("en-US")}
                              {call.project?.name
                                 ? ` · ${call.project.name}`
                                 : ""}
                           </p>
                        </div>
                        <div className="text-right shrink-0">
                           <p className="text-sm font-mono text-[#3D3650]">
                              {callDuration(call)}
                           </p>
                           <p className="text-[10px] font-mono text-[#3D3650] mt-0.5">
                              {call.id.slice(0, 8)}
                           </p>
                        </div>
                     </button>
                  ))}
               </div>
               <div className="px-5 py-4">
                  <Pagination
                     page={page}
                     pageCount={pageCount}
                     totalItems={totalCalls}
                     pageSize={pageSize}
                     onPageChange={setPage}
                  />
               </div>
            </div>
         )}

         {/* Detail modal */}
         {selected && (
            <div
               className="fixed inset-0 z-50 flex items-center justify-center p-6"
               style={{ background: "rgba(0,0,0,0.7)" }}
               onClick={() => setSelected(null)}
            >
               <div
                  className="w-full max-w-lg rounded-xl p-6 max-h-[85vh] overflow-y-auto"
                  style={{ background: "#FFFFFF", border: "1px solid #D6C4EE" }}
                  onClick={(e) => e.stopPropagation()}
               >
                  <div className="flex items-center justify-between mb-5">
                     <p className="font-bold text-[#170B2E]">Call Details</p>
                     <button
                        onClick={() => setSelected(null)}
                        className="text-[#3D3650] hover:text-[#170B2E] transition-colors text-sm"
                        aria-label="Close"
                     >
                        ✕
                     </button>
                  </div>
                  <div className="space-y-3 text-sm mb-6">
                     <Row label="Call ID" value={selected.id} mono />
                     <Row
                        label="Project"
                        value={selected.project?.name ?? "—"}
                     />
                     <Row label="Caller" value={selected.callerId} mono />
                     <Row label="Receiver" value={selected.receiverId} mono />
                     <Row label="Type" value={selected.type} />
                     <Row label="Status" value={statusLabel(selected.status)} />
                     <Row
                        label="Created"
                        value={new Date(selected.createdAt).toLocaleString(
                           "en-US",
                        )}
                     />
                     <Row
                        label="Started"
                        value={
                           selected.startedAt
                              ? new Date(selected.startedAt).toLocaleString(
                                   "en-US",
                                )
                              : "—"
                        }
                     />
                     <Row
                        label="Ended"
                        value={
                           selected.endedAt
                              ? new Date(selected.endedAt).toLocaleString(
                                   "en-US",
                                )
                              : "—"
                        }
                     />
                     <Row label="Duration" value={callDuration(selected)} />
                  </div>
                  {selected.events && selected.events.length > 0 && (
                     <div>
                        <p className="text-sm font-semibold text-[#170B2E] mb-3">
                           Timeline
                        </p>
                        <div className="flex flex-col gap-2">
                           {selected.events.map((ev) => (
                              <div
                                 key={ev.id}
                                 className="flex items-start gap-2"
                              >
                                 <span
                                    className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                                    style={{ background: "#7F40E8" }}
                                 />
                                 <div>
                                    <p className="text-xs text-[#3D3650]">
                                       {ev.event}
                                    </p>
                                    <p className="text-[10px] text-[#3D3650]">
                                       {new Date(ev.createdAt).toLocaleString(
                                          "en-US",
                                       )}
                                    </p>
                                 </div>
                              </div>
                           ))}
                        </div>
                     </div>
                  )}
               </div>
            </div>
         )}
      </div>
   );
}

function Row({
   label,
   value,
   mono,
}: {
   label: string;
   value: string;
   mono?: boolean;
}) {
   return (
      <div className="flex items-start justify-between gap-4">
         <span className="text-[#3D3650] shrink-0">{label}</span>
         <span
            className={`text-[#3D3650] text-right break-all ${mono ? "font-mono text-xs" : ""}`}
         >
            {value}
         </span>
      </div>
   );
}

function statusLabel(status: string): string {
   switch (status) {
      case "ACCEPTED":
         return "Completed";
      case "RINGING":
      case "INITIATED":
         return "Ringing";
      case "REJECTED":
         return "Rejected";
      case "MISSED":
         return "Missed";
      case "ENDED":
         return "Ended";
      default:
         return status;
   }
}

function statusBadge(
   status: string,
): "default" | "purple" | "success" | "error" | "warning" {
   switch (status) {
      case "ACCEPTED":
         return "success";
      case "RINGING":
      case "INITIATED":
         return "warning";
      case "REJECTED":
      case "MISSED":
         return "error";
      case "ENDED":
         return "default";
      default:
         return "default";
   }
}

function callDuration(call: Call): string {
   if (!call.startedAt) return "—";
   const end = call.endedAt ? new Date(call.endedAt).getTime() : Date.now();
   const secs = Math.floor((end - new Date(call.startedAt).getTime()) / 1000);
   if (secs < 60) return `${secs}s`;
   const m = Math.floor(secs / 60);
   const s = secs % 60;
   return `${m}m ${s.toString().padStart(2, "0")}s`;
}
