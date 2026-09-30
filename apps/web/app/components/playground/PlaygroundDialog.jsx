"use client";

import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Copy,
  ExternalLink,
  Smartphone,
  Monitor,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Video,
  Mic,
  MonitorPlay,
  Rocket,
  PartyPopper,
  Users,
} from "lucide-react";

const STEPS = [
  { label: "Start call" },
  { label: "Open your first device" },
  { label: "Join from another device" },
  { label: "You're connected" },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3005";

export default function PlaygroundDialog({
  open,
  session,
  onClose,
  onCopy,
  onOpenCaller,
  onOpenReceiver,
}) {
const [callStatus, setCallStatus] = useState("RINGING");
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [firstDeviceOpened, setFirstDeviceOpened] = useState(false);
  // Tracks only "the button was clicked / window was opened" — distinct from
  // firstDeviceOpened, which now means "the call actually started ringing".
  // We need both so the status panel can tell the user which one they're
  // still missing, instead of a single message that goes stale the moment
  // they open the tab but haven't tapped Call inside it yet.
  const [callWindowOpened, setCallWindowOpened] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [showCallerLink, setShowCallerLink] = useState(false);

  // Reset status whenever the dialog/session changes.
  useEffect(() => {
    if (open && session) {
      setCallStatus("RINGING");
      setFirstDeviceOpened(false);
      setCallWindowOpened(false);
    }
  }, [open, session]);

  useEffect(() => {
    if (!open || !session?.expiresAt) return;
    const update = () => {
      const left = Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setCallStatus("EXPIRED");
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [open, session]);

  // The opened call tab lands on its own "Call" lobby and only actually
  // starts ringing once the user taps it there — so we can't advance to
  // "join from another device" the instant the window opens (the call may
  // not exist yet, and a device joining then would see nothing). Wait for
  // the call tab to tell us it actually started.
  useEffect(() => {
    if (!open || !session) return;
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (
        event.data?.source === "purplecallio-call" &&
        event.data?.type === "started" &&
        event.data?.callId === session.callId
      ) {
        setFirstDeviceOpened(true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open, session]);

  // Poll the call status. The call is "connected" once both devices have
  // joined — the backend transitions RINGING → ACCEPTED when the second
  // participant accepts. This avoids exposing caller/receiver roles or URLs
  // and needs no socket-room changes.
  useEffect(() => {
    if (!open || !session || !session.callId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/calls/${session.callId}/details`, {
          headers: { Authorization: `Bearer ${session.callerToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.status) setCallStatus(data.status);
        }
        if (res.status === 410) setCallStatus("EXPIRED");
      } catch {
        // Network hiccup — keep polling.
      }
    };

    poll();
    const id = setInterval(poll, 2000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, session]);

const connected = callStatus === "ACCEPTED";
  // The first device is "joined" only after the user has clicked
  // "Open Call on This Device". We track this locally rather than inferring
  // it from the call status, because the backend creates the call as RINGING
  // before any device has actually opened it.
  const firstDeviceJoined = firstDeviceOpened && !connected;
  const awaitingFirstDevice = !firstDeviceJoined && !connected;

  const isAudio = session?.type === "AUDIO";

  // Current step (1-indexed) for the progress indicator.
  const currentStep = connected ? 4 : firstDeviceJoined ? 3 : 2;

  return (
    <AnimatePresence>
      {open && session && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50"
            style={{
              background: "rgba(0,0,0,.78)",
              backdropFilter: "blur(14px)",
            }}
          />

          {/* Modal wrapper */}
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 30 }}
              transition={{ duration: 0.22 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl max-h-[calc(100dvh-1.5rem)]"
            >
              <div
                className="rounded-3xl border overflow-hidden flex flex-col max-h-[calc(100dvh-1.5rem)]"
                style={{ background: "#FFFFFF", borderColor: "#E7DFF5" }}
              >
                {/* HEADER */}
                <div
                  className="flex justify-between items-start px-5 sm:px-8 py-4 sm:py-6 shrink-0"
                  style={{
                    background: "linear-gradient(135deg,#7F40E8,#410686)",
                  }}
                >
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-white">
                      Try PurpleCallio
                    </h2>
                    <p className="text-white/80 mt-1.5 text-sm sm:text-base">
                      Test a real-time video call in seconds.
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="text-white/80 hover:text-white transition-colors"
                    aria-label="Close"
                  >
                    <X size={26} />
                  </button>
                </div>

                {/* BODY */}
                <div className="min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-8 py-5 sm:py-7">
                  {/* Progress steps */}
                  <div className="mb-8">
                    <div className="flex items-center">
                      {STEPS.map((s, i) => {
                        const stepNum = i + 1;
                        const done = connected || (stepNum < currentStep) || (stepNum === 4 && connected);
                        const active = stepNum === currentStep;
                        return (
                          <div
                            key={s.label}
                            className="flex items-center flex-1 last:flex-none"
                          >
                            <div className="flex flex-col items-center">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all"
                                style={{
                                  background: done
                                    ? "linear-gradient(135deg,#7F40E8,#410686)"
                                    : active
                                    ? "#F3ECFB"
                                    : "#F8F4FD",
                                  border: active && !done
                                    ? "1px solid #7F40E8"
                                    : "1px solid #E7DFF5",
                                  color: done ? "#fff" : active ? "#6425C4" : "#3D3650",
                                }}
                              >
                                {done ? <Check size={15} /> : stepNum}
                              </div>
                              <span
                                className="text-[10px] mt-1.5 text-center leading-tight max-w-[70px]"
                                style={{
                                  color:
                                    done || active ? "#3D3650" : "#3D3650",
                                }}
                              >
                                {s.label}
                              </span>
                            </div>
                            {stepNum < STEPS.length && (
                              <div
                                className="flex-1 h-px mx-2 mb-4"
                                style={{
                                  background:
                                    stepNum < currentStep || connected
                                      ? "#7F40E8"
                                      : "#E7DFF5",
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

{/* STEP CONTENT — only the current step renders */}
                  {callStatus === "EXPIRED" ? (
                    <div className="py-8 text-center">
                      <h3 className="text-2xl font-bold text-[#170B2E]">Demo call ended</h3>
                      <p className="mt-2 text-sm text-[#3D3650]">Playground calls are limited to 1 minute.</p>
                      <a href="/signup" className="mt-5 inline-block text-sm font-semibold underline text-[#6425C4]">Create a free account to continue testing</a>
                    </div>
                  ) : connected ? (
                    /* STEP 4 — CONNECTED */
                    <motion.div
                      key="connected"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
<div className="text-center mb-6">
                        <h3 className="text-2xl font-bold text-[#170B2E]">
                          <span className="inline-flex items-center gap-2">You're connected <PartyPopper size={22} /></span>
                        </h3>
                        <p className="text-[#3D3650] mt-1.5">
                            Two devices are now on the same call. {secondsLeft !== null && `Demo time remaining: ${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`}
                        </p>
                      </div>

                      <div
                        className="rounded-2xl p-6 mb-6 text-center"
                        style={{
                          background: "#ECFDF5",
                          border: "1px solid #10B981",
                        }}
                      >
                        <div className="flex items-center justify-center gap-2 text-emerald-700 font-semibold mb-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                          {isAudio ? "Audio Call Active" : "Video Call Active"}
                        </div>
                        <p className="text-[#170B2E] text-sm mb-4">
                          <span className="inline-flex items-center gap-1.5"><Users size={16} className="text-emerald-700" /> 2 Participants</span>
                        </p>
                        <div className="flex flex-wrap justify-center gap-3 text-sm">
                          <span className="inline-flex items-center gap-1.5 text-emerald-700">
                            <Mic size={15} /> Audio
                          </span>
                          {!isAudio && (
                            <>
                              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                                <Video size={15} /> Video
                              </span>
                              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                                <MonitorPlay size={15} /> Screen
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl p-5 mb-6">
                        <p className="text-[#3D3650] font-medium mb-3 text-sm">
                          Try these features
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-[#3D3650]">
                          {isAudio ? (
                            <>
                              <div className="flex items-center gap-2">
                                <Mic size={16} /> Mute / unmute
                              </div>
                              <div className="flex items-center gap-2">
                                <Smartphone size={16} /> Join from another device
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <Video size={16} /> Turn camera on/off
                              </div>
                              <div className="flex items-center gap-2">
                                <Mic size={16} /> Mute / unmute
                              </div>
                              <div className="flex items-center gap-2">
                                <MonitorPlay size={16} /> Share your screen
                              </div>
                              <div className="flex items-center gap-2">
                                <Smartphone size={16} /> Join from another device
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={onOpenCaller}
                        className="w-full py-3.5 rounded-xl text-white font-semibold transition hover:opacity-90 flex items-center justify-center gap-2"
                        style={{
                          background:
                            "linear-gradient(135deg,#7F40E8,#410686)",
                        }}
                      >
                        Open Full Call Experience
                        <ExternalLink size={17} />
                      </button>
                    </motion.div>
                  ) : firstDeviceJoined ? (
                    /* STEP 3 — JOIN FROM ANOTHER DEVICE (second device only) */
                    <motion.div
                      key="second-device"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <Smartphone size={18} color="#7F40E8" />
                        <h3 className="text-[#170B2E] font-semibold">
                          Join from another device
                        </h3>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-5 items-center mb-6">
                        {/* QR */}
                        <div className="bg-white border border-[#E7DFF5] rounded-2xl p-4 flex-shrink-0">
                          <QRCode
                            value={session.receiverUrl}
                            size={168}
                          />
                        </div>

                        <div className="flex-1 w-full">
                          <p className="text-[#3D3650] text-sm mb-4 leading-relaxed">
                            Scan this QR code with your phone or another
                            device to join this call.
                          </p>

                          <div className="flex flex-col gap-2.5">
                            <button
                              onClick={() => onCopy(session.receiverUrl)}
                              className="w-full py-2.5 rounded-xl text-[#3D3650] text-sm font-medium border border-[#E7DFF5] transition hover:opacity-90 flex items-center justify-center gap-2"
                              style={{ background: "#F8F4FD" }}
                            >
                              <Copy size={16} />
                              Copy Invite Link
                            </button>
                            <button
                              onClick={onOpenReceiver}
                              className="w-full py-2.5 rounded-xl text-white text-sm font-medium transition hover:opacity-90 flex items-center justify-center gap-2"
                              style={{
                                background:
                                  "linear-gradient(135deg,#7F40E8,#410686)",
                              }}
                            >
                              <ExternalLink size={16} />
                              Open on Another Device
                            </button>
                          </div>

                          {/* Show/hide raw link */}
                          <button
                            onClick={() => setShowLink((s) => !s)}
                            className="mt-3 text-xs text-[#3D3650] hover:text-[#3D3650] flex items-center gap-1 transition-colors"
                          >
                            {showLink ? (
                              <ChevronUp size={14} />
                            ) : (
                              <ChevronDown size={14} />
                            )}
                            {showLink ? "Hide link" : "Show link"}
                          </button>
                          {showLink && (
                            <div
                              className="mt-2 break-all text-[11px] text-[#3D3650] rounded-lg px-3 py-2"
                              style={{
                                background: "#F8F4FD",
                                border: "1px solid #E7DFF5",
                              }}
                            >
                              {session.receiverUrl}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* LIVE STATUS */}
                      <div
                        className="rounded-2xl p-5 flex items-center gap-3"
                        style={{
                          background: "#ECFDF5",
                          border: "1px solid #10B981",
                        }}
                      >
                        <div
                          className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                          style={{
                            background: "rgba(34,197,94,.15)",
                          }}
                        >
                          <CheckCircle2 color="#059669" size={22} />
                        </div>
                        <div>
                          <p
                            className="font-semibold flex items-center gap-2"
                            style={{ color: "#059669" }}
                          >
                            <span
                              className="w-2 h-2 rounded-full inline-block animate-pulse"
                              style={{ background: "#059669" }}
                            />
                            1 participant connected
                          </p>
                          <p className="text-[#3D3650] text-xs mt-0.5">
                            Open the call on another device to test the
                            connection.
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    /* STEP 2 — OPEN THE FIRST DEVICE (first device only) */
                    <motion.div
                      key="first-device"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <Monitor size={18} color="#7F40E8" />
                        <h3 className="text-[#170B2E] font-semibold">
                          Open the first device
                        </h3>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-5 items-center mb-6">
                        {/* QR */}
                        <div className="bg-white border border-[#E7DFF5] rounded-2xl p-4 flex-shrink-0">
                          <QRCode value={session.callerUrl} size={168} />
                        </div>

                        <div className="flex-1 w-full">
                          <p className="text-[#3D3650] text-sm mb-2 leading-relaxed">
                            Scan this QR code with your phone, or open the
                            call right here on this device.
                          </p>
                          <p className="text-[#3D3650] text-xs mb-4 leading-relaxed">
                            That opens a new tab with a green{" "}
                            <span className="text-[#3D3650] font-medium">
                              Call
                            </span>{" "}
                            button — tap it there to start ringing. This
                            screen moves on by itself once it does.
                          </p>

                          <div className="flex flex-col gap-2.5">
                            <button
                              onClick={() => onCopy(session.callerUrl)}
                              className="w-full py-2.5 rounded-xl text-[#3D3650] text-sm font-medium border border-[#E7DFF5] transition hover:opacity-90 flex items-center justify-center gap-2"
                              style={{ background: "#F8F4FD" }}
                            >
                              <Copy size={16} />
                              Copy Invite Link
                            </button>
                            <button
                              onClick={() => {
                                setCallWindowOpened(true);
                                onOpenCaller();
                              }}
                              className="w-full py-2.5 rounded-xl text-white text-sm font-medium transition hover:opacity-90 flex items-center justify-center gap-2"
                              style={{
                                background:
                                  "linear-gradient(135deg,#7F40E8,#410686)",
                              }}
                            >
                              Open Call on This Device
                              <ExternalLink size={16} />
                            </button>
                          </div>

                          {/* Show/hide raw link */}
                          <button
                            onClick={() => setShowCallerLink((s) => !s)}
                            className="mt-3 text-xs text-[#3D3650] hover:text-[#3D3650] flex items-center gap-1 transition-colors"
                          >
                            {showCallerLink ? (
                              <ChevronUp size={14} />
                            ) : (
                              <ChevronDown size={14} />
                            )}
                            {showCallerLink ? "Hide link" : "Show link"}
                          </button>
                          {showCallerLink && (
                            <div
                              className="mt-2 break-all text-[11px] text-[#3D3650] rounded-lg px-3 py-2"
                              style={{
                                background: "#F8F4FD",
                                border: "1px solid #E7DFF5",
                              }}
                            >
                              {session.callerUrl}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* LIVE STATUS */}
                      <div
                        className="rounded-2xl p-5 mt-6 flex items-center gap-3"
                        style={{
                          background: callWindowOpened ? "#FFFBEB" : "#F3ECFB",
                          border: callWindowOpened
                            ? "1px solid #F59E0B"
                            : "1px solid #7F40E8",
                        }}
                      >
                        <div
                          className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                          style={{
                            background: callWindowOpened
                              ? "rgba(245,158,11,.15)"
                              : "rgba(127,64,232,.12)",
                          }}
                        >
                          <Rocket
                            color={callWindowOpened ? "#B45309" : "#7F40E8"}
                            size={20}
                          />
                        </div>
                        <div>
                          <p
                            className="font-semibold flex items-center gap-2"
                            style={{ color: "#3D3650" }}
                          >
                            <span
                              className="w-2 h-2 rounded-full inline-block animate-pulse"
                              style={{ background: callWindowOpened ? "#F59E0B" : "#7F40E8" }}
                            />
                            {callWindowOpened
                              ? "Waiting for you to tap Call..."
                              : "Waiting for another device..."}
                          </p>
                          <p className="text-[#3D3650] text-xs mt-0.5">
                            {callWindowOpened
                              ? "Go back to the tab you just opened and tap the green Call button — this page updates automatically once the call starts."
                              : "Open the first device to get started."}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
