"use client";

import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { socket } from "../lib/socket";

// ── Types ─────────────────────────────────────────────────

type CallState =
   | "lobby"
   | "connecting"
   | "waiting"
   | "incoming"
   | "in-call"
   | "rejected"
   | "cancelled"
   | "busy"
   | "missed"
   | "ended"
   | "connection-failed"
   | "error";

// Reconnecting is a sub-state of 'in-call' (see ConnectionBanner) — the call
// screen stays up while a network blip is recovered, rather than bouncing
// the user out to a different screen and back.
type ConnectionIssue = "none" | "reconnecting";

type ConnectionQuality = "good" | "unstable" | "poor";

interface RemoteMediaState {
   camera: boolean;
   microphone: boolean;
   screenShare: boolean;
}

interface IncomingCallData {
   callId: string;
   callerId: string;
   callerName?: string;
   callerAvatar?: string;
   type: "AUDIO" | "VIDEO";
}

interface Branding {
   companyName: string;
   logoUrl: string | null;
   primaryColor: string;
   theme: "LIGHT" | "DARK";
   waitingRoom: boolean;
}

interface DeviceInfo {
   deviceId: string;
   kind: MediaDeviceKind;
   label: string;
}

const DEFAULT_BRANDING: Branding = {
   companyName: "PurpleCallio",
   logoUrl: null,
   primaryColor: "#2563EB",
   theme: "DARK",
   waitingRoom: false,
};

// ── Helpers ───────────────────────────────────────────────

function Avatar({
   id,
   size = 64,
   color,
}: {
   id: string;
   size?: number;
   color?: string;
}) {
   const initials = id.slice(0, 2).toUpperCase();
   return (
      <div
         style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: "#1E2D50",
            border: `2px solid ${color ?? "#2563EB"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: size * 0.35,
            fontFamily: "ui-monospace, monospace",
            color: "#E2E8F0",
            flexShrink: 0,
         }}
      >
         {initials}
      </div>
   );
}

function useDurationTimer(active: boolean) {
   const [seconds, setSeconds] = useState(0);
   const ref = useRef<ReturnType<typeof setInterval> | null>(null);

   useEffect(() => {
      if (active) {
         setSeconds(0);
         ref.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      } else {
         if (ref.current) clearInterval(ref.current);
      }
      return () => {
         if (ref.current) clearInterval(ref.current);
      };
   }, [active]);

   const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
   const ss = String(seconds % 60).padStart(2, "0");
   return `${mm}:${ss}`;
}

function useDeviceEnumerate() {
   const [devices, setDevices] = useState<DeviceInfo[]>([]);
   const [loading, setLoading] = useState(true);

   const refresh = useCallback(async () => {
      try {
         const list = await navigator.mediaDevices.enumerateDevices();
         setDevices(
            list.map((d) => ({
               deviceId: d.deviceId,
               kind: d.kind,
               label: d.label,
            })),
         );
      } catch {
         setDevices([]);
      } finally {
         setLoading(false);
      }
   }, []);

   useEffect(() => {
      refresh();
      if (!navigator.mediaDevices) {
         console.warn("MediaDevices API is not available");
         return;
      }

      navigator.mediaDevices.addEventListener("devicechange", refresh);

      return () => {
         navigator.mediaDevices?.removeEventListener("devicechange", refresh);
      };
   }, [refresh]);

   const audioInputs = devices.filter((d) => d.kind === "audioinput");
   const audioOutputs = devices.filter((d) => d.kind === "audiooutput");
   const videoInputs = devices.filter((d) => d.kind === "videoinput");

   return { devices, audioInputs, audioOutputs, videoInputs, loading, refresh };
}

/**
 * Loops one of PurpleCallio's original call-sound assets (see
 * public/sounds/SOURCE.md — synthesized in-house, no third-party audio).
 * Driven entirely by call state (the caller waiting_effect below), never by
 * an independent timer. play() always stops any existing instance first, so
 * repeated calls (call 1 ends, call 2 starts) can never overlap into
 * "ringtone + ringtone". Autoplay-restriction failures are swallowed —
 * playback resumes on the next user gesture, but the call itself is never
 * affected by whether the sound plays.
 */
function useSoundLoop(src: string) {
   const audioRef = useRef<HTMLAudioElement | null>(null);
   const gestureCleanupRef = useRef<(() => void) | null>(null);

   const stop = useCallback(() => {
      gestureCleanupRef.current?.();
      gestureCleanupRef.current = null;
      const el = audioRef.current;
      if (!el) return;
      el.pause();
      el.currentTime = 0;
      audioRef.current = null;
   }, []);

   const play = useCallback(() => {
      stop();
      const el = new Audio(src);
      el.loop = true;
      el.volume = 0.5;
      audioRef.current = el;

      el.play().catch(() => {
         // Blocked by the browser's autoplay policy until a user gesture —
         // never surface this as a call error, just retry on the next click
         // or keypress anywhere on the page.
         const resume = () => {
            el.play().catch(() => {});
            gestureCleanupRef.current = null;
            document.removeEventListener("click", resume);
            document.removeEventListener("keydown", resume);
         };
         gestureCleanupRef.current = () => {
            document.removeEventListener("click", resume);
            document.removeEventListener("keydown", resume);
         };
         document.addEventListener("click", resume, { once: true });
         document.addEventListener("keydown", resume, { once: true });
      });
   }, [src, stop]);

   useEffect(() => stop, [stop]);

   return { play, stop };
}

// getUserMedia that can never hang the accept flow — it rejects after a
// timeout if the browser doesn't resolve the camera/mic permission prompt.
function getUserMediaWithTimeout(
   constraints: MediaStreamConstraints,
   timeoutMs = 8000,
): Promise<MediaStream> {
   return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
         reject(new Error("Media permission timed out"));
      }, timeoutMs);
      navigator.mediaDevices
         .getUserMedia(constraints)
         .then((stream) => {
            clearTimeout(timer);
            resolve(stream);
         })
         .catch((err) => {
            clearTimeout(timer);
            reject(err);
         });
   });
}

function classifyMediaError(err: unknown): { title: string; body: string } {
   const name = err instanceof Error ? err.name : "";
   switch (name) {
      case "NotAllowedError":
      case "SecurityError":
         return {
            title: "Camera/microphone access is blocked",
            body: "Allow camera and microphone access for this site in your browser settings, then reload the page.",
         };
      case "NotFoundError":
      case "OverconstrainedError":
         return {
            title: "No camera or microphone found",
            body: "Connect a camera/microphone and reload the page, or continue — the other participant can still be heard/seen.",
         };
      case "NotReadableError":
         return {
            title: "Camera or microphone is already in use",
            body: "Another app or browser tab may be using your camera/microphone. Close it and reload the page.",
         };
      default:
         return {
            title: "Could not access camera/microphone",
            body: "Check your device permissions and try reloading the page.",
         };
   }
}

// ── Main ──────────────────────────────────────────────────

function CallPageContent() {
   const searchParams = useSearchParams();
   const token = searchParams.get("token");
   const urlCallId = searchParams.get("callId");

   const [state, setState] = useState<CallState>("connecting");
   const [callType, setCallType] = useState<"AUDIO" | "VIDEO">("VIDEO");
   const [incomingData, setIncomingData] = useState<IncomingCallData | null>(
      null,
   );
   const [isMuted, setIsMuted] = useState(false);
   const [isVideoOff, setIsVideoOff] = useState(false);
   const [isScreenSharing, setIsScreenSharing] = useState(false);
   const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
   const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
   const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
   const [showDevices, setShowDevices] = useState(false);
   const [selectedDevice, setSelectedDevice] = useState({
      audio: "",
      video: "",
   });
   const [selfName, setSelfName] = useState("You");
   const [connectionIssue, setConnectionIssue] =
      useState<ConnectionIssue>("none");
   const [connectionQuality, setConnectionQuality] =
      useState<ConnectionQuality>("good");
   const [mediaError, setMediaError] = useState<{
      title: string;
      body: string;
   } | null>(null);
   const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
   const [remoteMedia, setRemoteMedia] = useState<RemoteMediaState>({
      camera: true,
      microphone: true,
      screenShare: false,
   });

   const deviceState = useDeviceEnumerate();
   const ringback = useSoundLoop("/sounds/ringback.mp3");
   const ringtone = useSoundLoop("/sounds/ringtone.mp3");

   const localVideoRef = useRef<HTMLVideoElement>(null);
   const remoteVideoRef = useRef<HTMLVideoElement>(null);
   const remoteAudioRef = useRef<HTMLAudioElement>(null);
   const pcRef = useRef<RTCPeerConnection | null>(null);
   const localStreamRef = useRef<MediaStream | null>(null);
   const remoteStreamRef = useRef<MediaStream | null>(null);
   const screenStreamRef = useRef<MediaStream | null>(null);
   const stateRef = useRef<CallState>("connecting");
   const callTypeRef = useRef<"AUDIO" | "VIDEO">("VIDEO");
   const selfParticipantIdRef = useRef<string | null>(null);
   const selfRoleRef = useRef<"CALLER" | "RECEIVER" | null>(null);
   const reconnectFailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
   );
   const negotiatingRef = useRef(false);
   const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
   const lifecycleEndedRef = useRef(false);
   const prevStatsRef = useRef<{ lost: number; received: number } | null>(null);
   const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
   // Reported once per call, the first time ICE connects — not on every
   // reconnect/restart, so a single flaky renegotiation can't double-count.
   const transportReportedRef = useRef(false);
   // Independent one-shot flags (not a single shared lock) so a call that
   // hits a definitive ICE failure and then recovers via restart reports
   // BOTH — the failure is still true history, but the call still counts as
   // eventually successful for reliability aggregation server-side.
   const iceSuccessReportedRef = useRef(false);
   const iceFailureReportedRef = useRef(false);

   // The local video element is mounted only after the call enters the
   // in-call state, so attachMedia can run before its ref exists.
   useEffect(() => {
      const video = localVideoRef.current;
      const stream = localStreamRef.current;
      if (!video || !stream || screenStreamRef.current) return;
      video.srcObject = stream;
      video.play().catch(() => {});
   }, [state, callType, isVideoOff, isScreenSharing]);

   const duration = useDurationTimer(state === "in-call");
   const isDark = branding.theme === "DARK";
   const primary = branding.primaryColor;
   const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3005";

   useEffect(() => {
      stateRef.current = state;
   }, [state]);

   useEffect(() => {
      callTypeRef.current = callType;
   }, [callType]);

   // Fetch branding + participant identity.
   useEffect(() => {
      if (!token || !urlCallId) return;
      (async () => {
         try {
            const res = await fetch(`${apiUrl}/calls/${urlCallId}/details`, {
               headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
               const data = await res.json();
               if (data.type === "AUDIO" || data.type === "VIDEO") {
                  setCallType(data.type);
                  callTypeRef.current = data.type;
               }
               if (data.branding) {
                  setBranding({
                     companyName: data.branding.companyName ?? "PurpleCallio",
                     logoUrl: data.branding.logoUrl ?? null,
                     primaryColor: data.branding.primaryColor ?? "#2563EB",
                     theme: data.branding.theme ?? "DARK",
                     waitingRoom: data.branding.waitingRoom ?? false,
                  });
               }
               setSelfName(data.participantId ?? "You");
            }
         } catch {
            // Fall back to defaults.
         }
      })();
   }, [token, urlCallId, apiUrl]);

   const fetchIceServers = useCallback(async (): Promise<RTCIceServer[]> => {
      try {
         const res = await fetch(`${apiUrl}/turn/credentials`, {
            headers: { Authorization: `Bearer ${token}` },
         });
         if (!res.ok) throw new Error();
         const data = (await res.json()) as { iceServers: RTCIceServer[] };
         return data.iceServers;
      } catch {
         return [{ urls: "stun:stun.l.google.com:19302" }];
      }
   }, [token, apiUrl]);

   const stopStatsPolling = useCallback(() => {
      if (statsIntervalRef.current) {
         clearInterval(statsIntervalRef.current);
         statsIntervalRef.current = null;
      }
      prevStatsRef.current = null;
   }, []);

   // Polls getStats() for packet loss (delta since last poll, not cumulative
   // since call start — a cumulative ratio dilutes to near-zero after a
   // couple minutes and would never reflect a fresh problem) and round-trip
   // time on the active candidate pair, and classifies it into a simple
   // Good/Unstable/Poor tier for the UI.
   const startStatsPolling = useCallback(
      (pc: RTCPeerConnection) => {
         stopStatsPolling();
         statsIntervalRef.current = setInterval(async () => {
            try {
               const report = await pc.getStats();
               let rtt: number | null = null;
               let lost = 0;
               let received = 0;
               report.forEach((entry: any) => {
                  if (
                     entry.type === "candidate-pair" &&
                     entry.state === "succeeded" &&
                     entry.nominated
                  ) {
                     if (typeof entry.currentRoundTripTime === "number")
                        rtt = entry.currentRoundTripTime * 1000;
                  }
                  if (entry.type === "inbound-rtp" && !entry.isRemote) {
                     lost += entry.packetsLost ?? 0;
                     received += entry.packetsReceived ?? 0;
                  }
               });

               let lossRate = 0;
               if (prevStatsRef.current) {
                  const dLost = Math.max(0, lost - prevStatsRef.current.lost);
                  const dReceived = Math.max(
                     0,
                     received - prevStatsRef.current.received,
                  );
                  const total = dLost + dReceived;
                  lossRate = total > 0 ? dLost / total : 0;
               }
               prevStatsRef.current = { lost, received };

               let quality: ConnectionQuality = "good";
               if (lossRate > 0.08 || (rtt !== null && rtt > 400))
                  quality = "poor";
               else if (lossRate > 0.02 || (rtt !== null && rtt > 150))
                  quality = "unstable";
               setConnectionQuality(quality);
            } catch {
               // getStats is best-effort — never let it break the call.
            }
         }, 3000);
      },
      [stopStatsPolling],
   );

   // Populated after attemptIceRestart is defined further below (it needs
   // createOffer, which is declared later) — kept as a ref so createPeer's
   // ICE-state handler can call it without a circular declaration order.
   const iceRestartRef = useRef<() => void>(() => {});

   // Create the RTCPeerConnection synchronously so nothing blocks the accept
   // flow. ICE servers are applied in the background via setConfiguration().
   const createPeer = useCallback((): RTCPeerConnection => {
      const pc = new RTCPeerConnection({
         iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      pc.ontrack = (event) => {
         // Some browsers omit event.streams for individual tracks. Keep one
         // stable stream and append those tracks, rather than treating a valid
         // remote video track as "no video" and rendering the camera-off view.
         const stream =
            event.streams[0] ?? remoteStreamRef.current ?? new MediaStream();
         if (
            !event.streams[0] &&
            !stream.getTracks().some((track) => track.id === event.track.id)
         ) {
            stream.addTrack(event.track);
         }
         remoteStreamRef.current = stream;
         setRemoteStream(stream);

         const refreshRemoteVideo = () => {
            setHasRemoteVideo(
               stream
                  .getVideoTracks()
                  .some((track) => track.readyState === "live"),
            );
         };
         refreshRemoteVideo();
         event.track.onunmute = refreshRemoteVideo;
         event.track.onended = refreshRemoteVideo;
      };

      pc.onicecandidate = (event) => {
         if (event.candidate)
            socket.emit("ice-candidate", { candidate: event.candidate });
      };

      // A network blip (disconnected) gets a grace period to self-heal, then
      // an active ICE restart; a hard 'failed' restarts immediately. Either
      // way, if we're not back within the watchdog window, this is a real
      // failure, not a blip — surface it instead of hanging forever.
      pc.oniceconnectionstatechange = () => {
         const iceState = pc.iceConnectionState;
         if (iceState === "disconnected" || iceState === "failed") {
            setConnectionIssue("reconnecting");

            // Only a hard 'failed' is a definitive ICE failure — a network
            // blip commonly bounces disconnected → connected on its own, and
            // reporting that as a failure would misrepresent reliability.
            if (iceState === "failed") reportIceOutcome(pc, "FAILED");

            if (!reconnectFailTimerRef.current) {
               const restartDelay = iceState === "failed" ? 0 : 3000;
               setTimeout(() => {
                  if (pcRef.current === pc) iceRestartRef.current();
               }, restartDelay);

               reconnectFailTimerRef.current = setTimeout(() => {
                  const p = pcRef.current;
                  if (
                     p === pc &&
                     p.iceConnectionState !== "connected" &&
                     p.iceConnectionState !== "completed"
                  ) {
                     setConnectionIssue("none");
                     setState("connection-failed");
                  }
                  reconnectFailTimerRef.current = null;
               }, 15000);
            }
         } else if (iceState === "connected" || iceState === "completed") {
            setConnectionIssue("none");
            if (reconnectFailTimerRef.current) {
               clearTimeout(reconnectFailTimerRef.current);
               reconnectFailTimerRef.current = null;
            }
            startStatsPolling(pc);
            reportWebrtcTransport(pc);
            reportIceOutcome(pc, "SUCCESS");
         }
      };

      // Apply real ICE/TURN servers in the background (never blocks the call).
      fetchIceServers()
         .then((servers) => pc.setConfiguration({ iceServers: servers }))
         .catch(() => {});

      return pc;
   }, [fetchIceServers, startStatsPolling]);

   // Acquire media (bounded by a timeout so it can never hang) and attach the
   // local tracks to the peer connection. Best-effort: falls back to audio-only.
   const attachMedia = useCallback(
      async (pc: RTCPeerConnection, video = true) => {
         const constraints: MediaStreamConstraints = { audio: true };
         if (video) {
            constraints.video = selectedDevice.video
               ? { deviceId: { exact: selectedDevice.video } }
               : true;
         }
         const stream = await getUserMediaWithTimeout(constraints);
         localStreamRef.current = stream;
         if (localVideoRef.current) localVideoRef.current.srcObject = stream;
         stream.getTracks().forEach((t) => {
            pc.addTrack(t, stream);
            // Fires when a device is physically unplugged (or otherwise stops
            // supplying media) mid-call — surface it instead of just going
            // silently black/silent with no explanation.
            t.onended = () => {
               if (localStreamRef.current !== stream) return; // stale track from a prior stream
               setDeviceNotice(
                  t.kind === "video"
                     ? "Camera disconnected."
                     : "Microphone disconnected.",
               );
            };
         });
         setMediaError(null);
      },
      [selectedDevice.video],
   );

   const initMedia = useCallback(
      async (video = true) => {
         const pc = pcRef.current ?? createPeer();
         await attachMedia(pc, video);
      },
      [createPeer, attachMedia],
   );

   const createOffer = useCallback(async () => {
      if (!pcRef.current) return;
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      socket.emit("offer", { offer });
   }, []);

   // Drains ICE candidates that arrived before setRemoteDescription resolved
   // (trickle ICE races with signaling — a candidate can beat the offer/answer
   // over the wire).
   const flushPendingCandidates = useCallback(async (pc: RTCPeerConnection) => {
      const queued = pendingCandidatesRef.current;
      pendingCandidatesRef.current = [];
      for (const candidate of queued) {
         await pc
            .addIceCandidate(new RTCIceCandidate(candidate))
            .catch((err) => {
               console.error("addIceCandidate (flushed) failed", err);
            });
      }
   }, []);

   // Actively try to recover a degraded connection. Only the original
   // offerer (the CALLER) re-negotiates — if both sides tried, they'd race
   // (signaling glare); the other side's existing 'offer' handler already
   // treats a renegotiation offer the same as the initial one.
   const attemptIceRestart = useCallback(async () => {
      const pc = pcRef.current;
      if (!pc || negotiatingRef.current) return;
      if (selfRoleRef.current !== "CALLER") return;

      negotiatingRef.current = true;
      try {
         const offer = await pc.createOffer({ iceRestart: true });
         await pc.setLocalDescription(offer);
         socket.emit("offer", { offer });
      } catch (err) {
         console.error("ICE restart failed", err);
      } finally {
         negotiatingRef.current = false;
      }
   }, []);

   useEffect(() => {
      iceRestartRef.current = attemptIceRestart;
   }, [attemptIceRestart]);

   const cleanup = useCallback(() => {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      screenStreamRef.current = null;
      pendingCandidatesRef.current = [];
      stopStatsPolling();
      ringback.stop();
      ringtone.stop();
      if (reconnectFailTimerRef.current) {
         clearTimeout(reconnectFailTimerRef.current);
         reconnectFailTimerRef.current = null;
      }
      setRemoteStream(null);
      setHasRemoteVideo(false);
      setConnectionIssue("none");
      setConnectionQuality("good");
      setRemoteMedia({ camera: true, microphone: true, screenShare: false });
      setDeviceNotice(null);
   }, [stopStatsPolling, ringback, ringtone]);

   useEffect(() => {
      if (!token || !urlCallId) {
         setState("error");
         return;
      }

      socket.on("incoming-call", (data: IncomingCallData) => {
         setIncomingData(data);
         setCallType(data.type);
         setState("incoming");
      });

      socket.on("call-accepted", async () => {
         try {
            // Create the peer connection synchronously so the offer is never
            // dropped, then attach local media (bounded by a timeout) so the offer
            // carries tracks.
            const pc = pcRef.current ?? createPeer();
            const isVideo = callTypeRef.current === "VIDEO";
            await attachMedia(pc, isVideo)
               .catch(() => attachMedia(pc, false))
               .catch((err) => setMediaError(classifyMediaError(err)));

            setState("in-call");
            // Join the gateway's Socket.IO room for this call — without this,
            // the media-state broadcasts (camera/mic/screen-share toggles,
            // participant.updated) have nowhere to be relayed to.
            socket.emit("join-call", { callId: urlCallId });
            await createOffer();
            socket.emit("call.started", { callId: urlCallId });
         } catch (err) {
            console.error("Failed to answer accepted call", err);
            setState("error");
         }
      });

      socket.on("call-rejected", () => setState("rejected"));

      // Caller cancelled while still ringing — distinct from the receiver
      // declining (call-rejected) and from a plain timeout (call-missed).
      socket.on("call-cancelled", () => {
         if (stateRef.current === "ended" || stateRef.current === "cancelled")
            return;
         cleanup();
         setState("cancelled");
      });

      // Receiver was already on another call — this call was never actually rung.
      socket.on("call-busy", () => {
         cleanup();
         setState("busy");
      });

      socket.on("call-missed", () => {
         if (stateRef.current === "ended" || stateRef.current === "missed")
            return;
         cleanup();
         setState("missed");
      });

      socket.on(
         "offer",
         async ({ offer }: { offer: RTCSessionDescriptionInit }) => {
            if (!pcRef.current) return;
            const pc = pcRef.current;

            // Ensure local media is attached before answering so the answer carries
            // the receiver's audio/video tracks. Bounded by a timeout (never hangs).
            if (pc.getSenders().length === 0) {
               const isVideo = callTypeRef.current === "VIDEO";
               await attachMedia(pc, isVideo)
                  .catch(() => attachMedia(pc, false))
                  .catch((err) => setMediaError(classifyMediaError(err)));
            }

            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            await flushPendingCandidates(pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit("answer", { answer });
         },
      );

      socket.on(
         "answer",
         async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
            if (!pcRef.current) return;
            await pcRef.current.setRemoteDescription(
               new RTCSessionDescription(answer),
            );
            await flushPendingCandidates(pcRef.current);
         },
      );

      // Trickle ICE races with signaling: a candidate can arrive before the
      // remote description is set (addIceCandidate throws InvalidStateError
      // if so) — queue it and flush once setRemoteDescription resolves,
      // instead of dropping/erroring on it.
      socket.on(
         "ice-candidate",
         async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
            const pc = pcRef.current;
            if (!pc) return;
            if (!pc.remoteDescription) {
               pendingCandidatesRef.current.push(candidate);
               return;
            }
            await pc
               .addIceCandidate(new RTCIceCandidate(candidate))
               .catch((err) => {
                  console.error("addIceCandidate failed", err);
               });
         },
      );

      socket.on("call-ended", () => {
         if (stateRef.current === "ended") return;
         cleanup();
         setState("ended");
      });

      // Carries our own resolved role/participantId — captured so
      // participant.updated (broadcast to the whole room, including us) can
      // tell which updates are about the OTHER participant.
      socket.on(
         "connected",
         (data: { participantId: string; role: "CALLER" | "RECEIVER" }) => {
            selfParticipantIdRef.current = data.participantId;
            selfRoleRef.current = data.role;
         },
      );

      // The other participant muted/unmuted, toggled camera, or started/stopped
      // screen share — reflect it immediately rather than only inferring video
      // presence once from the initial ontrack.
      //
      // Deliberately NOT using the generic 'participant.updated' broadcast here
      // even though it carries a full media snapshot: the room service
      // initializes everyone's camera/mic to false at join time and only
      // flips a field when that SPECIFIC toggle fires, so a snapshot read at
      // the time of an unrelated toggle (e.g. muting) would report a stale
      // "camera: false" default and incorrectly hide the remote video. Each
      // dedicated event only updates the one field it's actually about.
      const onCameraOn = (d: { participantId: string }) => {
         if (d.participantId === selfParticipantIdRef.current) return;
         setRemoteMedia((m) => ({ ...m, camera: true }));
      };
      const onCameraOff = (d: { participantId: string }) => {
         if (d.participantId === selfParticipantIdRef.current) return;
         setRemoteMedia((m) => ({ ...m, camera: false }));
      };
      const onMicOn = (d: { participantId: string }) => {
         if (d.participantId === selfParticipantIdRef.current) return;
         setRemoteMedia((m) => ({ ...m, microphone: true }));
      };
      const onMicOff = (d: { participantId: string }) => {
         if (d.participantId === selfParticipantIdRef.current) return;
         setRemoteMedia((m) => ({ ...m, microphone: false }));
      };
      const onScreenStart = (d: { participantId: string }) => {
         if (d.participantId === selfParticipantIdRef.current) return;
         setRemoteMedia((m) => ({ ...m, screenShare: true }));
      };
      const onScreenStop = (d: { participantId: string }) => {
         if (d.participantId === selfParticipantIdRef.current) return;
         setRemoteMedia((m) => ({ ...m, screenShare: false }));
      };
      socket.on("camera.enabled", onCameraOn);
      socket.on("camera.disabled", onCameraOff);
      socket.on("microphone.enabled", onMicOn);
      socket.on("microphone.disabled", onMicOff);
      socket.on("screenShare.started", onScreenStart);
      socket.on("screenShare.stopped", onScreenStop);

      socket.on("connect", () => {
         socket.emit(
            "authenticate",
            { token },
            (response: { success: boolean; role: string }) => {
               if (!response?.success) {
                  setState("error");
                  return;
               }
               // Receiver keeps the original behavior exactly: stay on
               // "connecting" until 'incoming-call' arrives, no extra step.
               // Only the caller gets a lobby — ringing (and the ringback
               // tone) waits for their explicit "Call" tap.
               if (response.role === "CALLER") setState("lobby");
            },
         );
      });

      socket.connect();

      return () => {
         [
            "incoming-call",
            "call-accepted",
            "call-rejected",
            "call-cancelled",
            "call-busy",
            "call-missed",
            "offer",
            "answer",
            "ice-candidate",
            "call-ended",
            "connected",
            "camera.enabled",
            "camera.disabled",
            "microphone.enabled",
            "microphone.disabled",
            "screenShare.started",
            "screenShare.stopped",
            "connect",
         ].forEach((e) => socket.off(e));
         socket.disconnect();
         cleanup();
      };
   }, []); // eslint-disable-line react-hooks/exhaustive-deps 

   useEffect(() => {
      if (state === "waiting") {
         ringback.play();
      } else {
         ringback.stop();
      }
      if (state === "incoming") {
         ringtone.play();
      } else {
         ringtone.stop();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [state]);

   // Transient toast — auto-dismiss so a one-time device-disconnect notice
   // doesn't sit on screen for the rest of the call.
   useEffect(() => {
      if (!deviceNotice) return;
      const t = setTimeout(() => setDeviceNotice(null), 6000);
      return () => clearTimeout(t);
   }, [deviceNotice]);

   useEffect(() => {
      if (remoteVideoRef.current && remoteStream) {
         remoteVideoRef.current.srcObject = remoteStream;
         remoteVideoRef.current.play().catch(() => {});
      }
      if (remoteAudioRef.current && remoteStream) {
         remoteAudioRef.current.srcObject = remoteStream;
         remoteAudioRef.current.play().catch(() => {});
      }
   }, [callType, remoteMedia.camera, remoteStream]);

   // Apply theme background.
   useEffect(() => {
      document.documentElement.style.background = isDark
         ? "#060A17"
         : "#F1F5F9";
      return () => {
         document.documentElement.style.background = "";
      };
   }, [isDark]);

   // The only action on the lobby screen. Nothing before this point has
   // touched the socket or requested a permission — this is the single
   // moment both begin, for both the caller and the receiver.
   function startCallFlow() {
      // The socket is already connected in the background (needed so a
      // receiver's incoming-call can arrive without an extra click) — the
      // lobby only ever shows for the caller, so this just starts ringing.
      setState("waiting");
      // Tell an opener window (the Playground demo dialog) that the call has
      // actually started, so it only advances to "join from another device"
      // once there's really something to join — not the instant this tab
      // opened.
      if (window.opener) {
         window.opener.postMessage(
            { source: "purplecallio-call", type: "started", callId: urlCallId },
            window.location.origin,
         );
      }
   }

   async function sessionPost(path: string, body?: unknown) {
      const res = await fetch(`${apiUrl}${path}`, {
         method: "POST",
         headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
         },
         body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`${path} failed with ${res.status}`);
      return res;
   }

   // Classifies this call as P2P or TURN from the browser's own WebRTC
   // stats — the only place that actually knows which candidate pair won.
   // "relay" means media is flowing through the TURN server; "host"/"srflx"
   // means the two peers connected directly. Best-effort: a stats-shape
   // surprise here should never affect the call itself.
   async function reportWebrtcTransport(pc: RTCPeerConnection) {
      if (transportReportedRef.current || !urlCallId) return;
      try {
         const stats = await pc.getStats();
         let selectedPair: any = null;
         stats.forEach((report: any) => {
            if (report.type === "candidate-pair" && report.state === "succeeded") {
               if (report.nominated || !selectedPair) selectedPair = report;
            }
         });
         if (!selectedPair) return;

         let candidateType: string | undefined;
         stats.forEach((report: any) => {
            if (report.id === selectedPair.localCandidateId) {
               candidateType = report.candidateType;
            }
         });
         if (!candidateType) return;

         transportReportedRef.current = true;
         const transport = candidateType === "relay" ? "TURN" : "P2P";
         await sessionPost(`/calls/${urlCallId}/webrtc-transport`, {
            transport,
            candidateType,
         }).catch(() => {});
      } catch {
         // getStats() shape varies across browsers — never let this block the call.
      }
   }

   // Reports at most once per outcome per call (see the two refs' comment) —
   // a call can legitimately report both a FAILED and a later SUCCESS.
   async function reportIceOutcome(pc: RTCPeerConnection, outcome: "SUCCESS" | "FAILED") {
      if (!urlCallId) return;
      const reportedRef = outcome === "SUCCESS" ? iceSuccessReportedRef : iceFailureReportedRef;
      if (reportedRef.current) return;
      reportedRef.current = true;
      await sessionPost(`/calls/${urlCallId}/webrtc-ice`, {
         outcome,
         iceConnectionState: pc.iceConnectionState,
         connectionState: pc.connectionState,
      }).catch(() => {});
   }

   async function acceptCall() {
      if (!incomingData) return;
      try {
         setCallType(incomingData.type);
         callTypeRef.current = incomingData.type;
         const pc = pcRef.current ?? createPeer();

         await attachMedia(pc, incomingData.type === "VIDEO")
            .catch(() => attachMedia(pc, false))
            .catch((err) => setMediaError(classifyMediaError(err)));

         // Accept + join the call server-side so the caller is notified.
         await sessionPost(`/calls/${incomingData.callId}/accept`);
         await sessionPost(`/calls/${incomingData.callId}/join`);
         setState("in-call");
         socket.emit("join-call", { callId: incomingData.callId });
         socket.emit("call.started", { callId: incomingData.callId });
      } catch (err) {
         console.error("Failed to accept call", err);
         setState("error");
      }
   }

   async function rejectCall() {
      if (!incomingData) return;
      await sessionPost(`/calls/${incomingData.callId}/reject`).catch((err) => {
         console.error("Failed to reject call", err);
      });
      setState("rejected");
   }

   // Caller hangs up while still ringing — distinct from rejectCall (which
   // only the receiver can do).
   async function cancelCall() {
      if (!urlCallId) return;
      lifecycleEndedRef.current = true;
      await sessionPost(`/calls/${urlCallId}/cancel`).catch((err) => {
         console.error("Failed to cancel call", err);
      });
      cleanup();
      setState("cancelled");
   }

   async function endCall() {
      if (!urlCallId) return;
      lifecycleEndedRef.current = true;
      socket.emit("call.ended", { callId: urlCallId });
      socket.emit("call-ended");
      await sessionPost(`/calls/${urlCallId}/leave`).catch(() => {});
      await sessionPost(`/calls/${urlCallId}/end`).catch(() => {});
      cleanup();
      setState("ended");
   }

   useEffect(() => {
      if (!token || !urlCallId) return;

      const endCallOnPageExit = () => {
         if (lifecycleEndedRef.current || stateRef.current !== "in-call")
            return;
         lifecycleEndedRef.current = true;
         socket.emit("call.ended", { callId: urlCallId });
         void fetch(`${apiUrl}/calls/${urlCallId}/end`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            keepalive: true,
         }).catch(() => {});
      };

      window.addEventListener("pagehide", endCallOnPageExit);
      return () => window.removeEventListener("pagehide", endCallOnPageExit);
   }, [apiUrl, token, urlCallId]);

   function toggleMute() {
      const track = localStreamRef.current?.getAudioTracks()[0];
      if (!track) return;
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
      socket.emit(
         track.enabled ? "microphone.enabled" : "microphone.disabled",
         {
            callId: urlCallId,
         },
      );
   }

   function toggleVideo() {
      const track = localStreamRef.current?.getVideoTracks()[0];
      if (!track) return;
      track.enabled = !track.enabled;
      setIsVideoOff(!track.enabled);
      socket.emit(track.enabled ? "camera.enabled" : "camera.disabled", {
         callId: urlCallId,
      });
   }

   async function startScreenShare() {
      try {
         const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
         });
         const screenTrack = screenStream.getVideoTracks()[0];
         screenStreamRef.current = screenStream;

         const sender = pcRef.current
            ?.getSenders()
            .find((s) => s.track?.kind === "video");
         if (sender) await sender.replaceTrack(screenTrack);

         if (localVideoRef.current)
            localVideoRef.current.srcObject = screenStream;
         screenTrack.onended = () => stopScreenShare();

         setIsScreenSharing(true);
         socket.emit("screenShare.started", { callId: urlCallId });
      } catch {
         // User cancelled the picker.
      }
   }

   async function stopScreenShare() {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;

      const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
      const sender = pcRef.current
         ?.getSenders()
         .find((s) => s.track?.kind === "video");
      if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);

      if (localVideoRef.current && localStreamRef.current) {
         localVideoRef.current.srcObject = localStreamRef.current;
      }

      setIsScreenSharing(false);
      socket.emit("screenShare.stopped", { callId: urlCallId });
   }

   function selectDevice(kind: "audio" | "video", deviceId: string) {
      setSelectedDevice((prev) => ({ ...prev, [kind]: deviceId }));
   }

   // ── Shared screen shell ─────────────────────────────────

   const shellBg = isDark ? "#060A17" : "#F1F5F9";
   const surfaceBg = isDark ? "#0D1425" : "#FFFFFF";
   const borderColor = isDark ? "#1A2240" : "#E2E8F0";
   const textPrimary = isDark ? "#FFFFFF" : "#0F172A";
   const textSecondary = isDark ? "#CBD5E1" : "#334155";

   function Screen({ children }: { children: React.ReactNode }) {
      return (
         <div
            className="min-h-screen flex flex-col items-center justify-center px-6"
            style={{ background: shellBg }}
         >
            <div className="flex flex-col items-center text-center">
               {children}
            </div>
            <div className="absolute bottom-6 flex items-center gap-2">
               {branding.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                     src={branding.logoUrl}
                     alt={branding.companyName}
                     style={{ height: 18 }}
                  />
               )}
               <span
                  className="font-mono text-xs"
                  style={{ color: isDark ? "#CBD5E1" : "#334155" }}
               >
                  {branding.companyName}
               </span>
            </div>
         </div>
      );
   }

   function Spinner() {
      return (
         <div
            className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: primary, borderTopColor: "transparent" }}
         />
      );
   }

   // ── State screens ────────────────────────────────────────

   if (!token || !urlCallId || state === "error") {
      return (
         <Screen>
            <p className="text-sm" style={{ color: textSecondary }}>
               Invalid or expired call link.
            </p>
            <p
               className="text-xs mt-2"
               style={{ color: isDark ? "#CBD5E1" : "#334155" }}
            >
               Contact the sender for a new link.
            </p>
         </Screen>
      );
   }

   if (state === "lobby") {
      return (
         <Screen>
            <div
               className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
               style={{ background: surfaceBg, border: `2px solid ${primary}` }}
            >
               {callType === "VIDEO" ? <VideoIcon /> : <MicIcon />}
            </div>
            <p className="font-medium mb-1" style={{ color: textPrimary }}>
               Ready to start your {callType === "VIDEO" ? "video" : "audio"}{" "}
               call
            </p>
            <p
               className="text-sm mb-8 max-w-xs"
               style={{ color: textSecondary }}
            >
               We'll ask for {callType === "VIDEO" ? "camera and " : ""}
               microphone access once you tap Call.
            </p>
            <button
               onClick={startCallFlow}
               style={{ background: "#0F3D1F" }}
               className="w-16 h-16 rounded-full flex items-center justify-center hover:brightness-110 transition-all"
               aria-label="Call"
            >
               <PhoneIcon />
            </button>
            <p
               className="text-xs mt-4 font-medium tracking-wide"
               style={{ color: textSecondary }}
            >
               Call
            </p>
         </Screen>
      );
   }

   if (state === "connecting") {
      return (
         <Screen>
            <Spinner />
            <p className="text-sm mt-5" style={{ color: textSecondary }}>
               Connecting…
            </p>
         </Screen>
      );
   }

   if (state === "waiting") {
      return (
         <Screen>
            <div className="relative mb-6">
               <div
                  className="w-20 h-20 rounded-full animate-pulse"
                  style={{
                     background: surfaceBg,
                     border: `2px solid ${primary}`,
                  }}
               />
               <span
                  className="absolute inset-0 flex items-center justify-center font-mono text-xs"
                  style={{ color: primary }}
               >
                  …
               </span>
            </div>
            <p className="font-medium mb-1" style={{ color: textPrimary }}>
               Waiting for answer
            </p>
            <p className="text-sm mb-6" style={{ color: textSecondary }}>
               The other participant will join shortly
            </p>
            <button
               onClick={cancelCall}
               style={{ background: "#3F1515" }}
               className="w-14 h-14 rounded-full flex items-center justify-center hover:brightness-110 transition-all"
               aria-label="Cancel call"
            >
               <PhoneDownIcon />
            </button>
            {branding.waitingRoom && (
               <div
                  className="mt-8 w-full max-w-xs"
                  style={{
                     background: surfaceBg,
                     border: `1px solid ${borderColor}`,
                     borderRadius: 12,
                     padding: 16,
                  }}
               >
                  <p
                     className="text-xs font-semibold mb-3"
                     style={{ color: textSecondary }}
                  >
                     Device setup
                  </p>
                  <div className="flex flex-col gap-3">
                     <label
                        className="text-xs"
                        style={{ color: textSecondary }}
                     >
                        Microphone
                        <select
                           value={selectedDevice.audio}
                           onChange={(e) =>
                              selectDevice("audio", e.target.value)
                           }
                           className="w-full mt-1 px-2 py-1.5 rounded-lg text-sm"
                           style={{
                              background: shellBg,
                              color: textPrimary,
                              border: `1px solid ${borderColor}`,
                           }}
                        >
                           <option value="">Default</option>
                           {deviceState.audioInputs.map((d) => (
                              <option key={d.deviceId} value={d.deviceId}>
                                 {d.label ||
                                    `Microphone ${d.deviceId.slice(0, 4)}`}
                              </option>
                           ))}
                        </select>
                     </label>
                     <label
                        className="text-xs"
                        style={{ color: textSecondary }}
                     >
                        Camera
                        <select
                           value={selectedDevice.video}
                           onChange={(e) =>
                              selectDevice("video", e.target.value)
                           }
                           className="w-full mt-1 px-2 py-1.5 rounded-lg text-sm"
                           style={{
                              background: shellBg,
                              color: textPrimary,
                              border: `1px solid ${borderColor}`,
                           }}
                        >
                           <option value="">Default</option>
                           {deviceState.videoInputs.map((d) => (
                              <option key={d.deviceId} value={d.deviceId}>
                                 {d.label || `Camera ${d.deviceId.slice(0, 4)}`}
                              </option>
                           ))}
                        </select>
                     </label>
                  </div>
               </div>
            )}
         </Screen>
      );
   }

   if (state === "incoming") {
      return (
         <Screen>
            <div className="mb-6">
               {incomingData?.callerAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                     src={incomingData.callerAvatar}
                     alt={incomingData.callerName ?? incomingData.callerId}
                     width={80}
                     height={80}
                     style={{
                        borderRadius: "50%",
                        border: `2px solid ${primary}`,
                        objectFit: "cover",
                     }}
                  />
               ) : (
                  <Avatar
                     id={
                        incomingData?.callerName ??
                        incomingData?.callerId ??
                        "??"
                     }
                     size={80}
                     color={primary}
                  />
               )}
            </div>
            <p
               className="text-xs uppercase tracking-widest mb-1"
               style={{ color: textSecondary }}
            >
               Incoming {incomingData?.type === "VIDEO" ? "video" : "audio"}{" "}
               call
            </p>
            <p
               className="text-2xl font-semibold mb-10"
               style={{ color: textPrimary }}
            >
               {incomingData?.callerName ?? incomingData?.callerId}
            </p>
            <div className="flex gap-8">
               <button
                  onClick={rejectCall}
                  style={{ background: "#3F1515" }}
                  className="w-16 h-16 rounded-full flex items-center justify-center hover:brightness-110 transition-all"
                  aria-label="Decline"
               >
                  <PhoneDownIcon />
               </button>
               <button
                  onClick={acceptCall}
                  style={{ background: "#0F3D1F" }}
                  className="w-16 h-16 rounded-full flex items-center justify-center hover:brightness-110 transition-all"
                  aria-label="Accept"
               >
                  <PhoneIcon />
               </button>
            </div>
         </Screen>
      );
   }

   if (state === "rejected") {
      return (
         <Screen>
            <p style={{ color: textSecondary }}>Call declined.</p>
         </Screen>
      );
   }

   if (state === "cancelled") {
      return (
         <Screen>
            <p style={{ color: textSecondary }}>The call was cancelled.</p>
         </Screen>
      );
   }

   if (state === "busy") {
      return (
         <Screen>
            <p className="font-medium mb-1" style={{ color: textPrimary }}>
               Busy
            </p>
            <p className="text-sm" style={{ color: textSecondary }}>
               The other participant is already on another call.
            </p>
         </Screen>
      );
   }

   if (state === "missed") {
      return (
         <Screen>
            <p className="font-medium mb-1" style={{ color: textPrimary }}>
               No answer
            </p>
            <p className="text-sm" style={{ color: textSecondary }}>
               The other participant didn't answer.
            </p>
         </Screen>
      );
   }

   if (state === "connection-failed") {
      return (
         <Screen>
            <p className="font-medium mb-1" style={{ color: textPrimary }}>
               Unable to connect
            </p>
            <p className="text-sm max-w-xs" style={{ color: textSecondary }}>
               The connection couldn't be established or was lost and didn't
               recover. Please try again.
            </p>
         </Screen>
      );
   }

   if (state === "ended") {
      return (
         <Screen>
            <p className="font-medium mb-1" style={{ color: textPrimary }}>
               Call ended
            </p>
            <p className="text-sm" style={{ color: textSecondary }}>
               {duration}
            </p>
         </Screen>
      );
   }

   // ── In-call ──────────────────────────────────────────────
   return (
      <div
         className="h-[100dvh] max-h-[100dvh] overflow-hidden flex flex-col"
         style={{ background: shellBg }}
      >
         {/* Header strip */}
         <div
            className="flex shrink-0 items-center justify-between px-5 py-3"
            style={{ borderBottom: `1px solid ${borderColor}` }}
         >
            <span
               className="flex items-center gap-2 font-mono text-xs tracking-wider"
               style={{ color: isDark ? "#CBD5E1" : "#334155" }}
            >
               {branding.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                     src={branding.logoUrl}
                     alt={branding.companyName}
                     style={{ height: 16 }}
                  />
               )}
               {branding.companyName}
            </span>
            <span className="flex items-center gap-3">
               <ConnectionQualityDot quality={connectionQuality} />
               <span
                  className="font-mono text-sm tabular-nums"
                  style={{ color: isDark ? "#CBD5E1" : "#334155" }}
               >
                  {duration}
               </span>
            </span>
         </div>

         {/* Hidden audio element — plays remote audio for audio-only calls */}
         <audio
            ref={remoteAudioRef}
            autoPlay
            playsInline
            style={{ display: "none" }}
         />

         {/* Video area */}
         <div
            className="flex-1 relative overflow-hidden"
            style={{ minHeight: 0 }}
         >
            {callType === "VIDEO" && hasRemoteVideo && remoteMedia.camera ? (
               <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                  style={{
                     background: surfaceBg,
                     // Their screen share replaces this same video track —
                     // never mirror that, or any text/UI on it reads backwards.
                     transform: remoteMedia.screenShare ? undefined : "scaleX(-1)",
                  }}
               />
            ) : (
               <div
                  className="w-full h-full flex flex-col items-center justify-center gap-4"
                  style={{ background: surfaceBg }}
               >
                  <Avatar
                     id={incomingData?.callerId ?? "user"}
                     size={96}
                     color={primary}
                  />
                  <p className="text-sm" style={{ color: textSecondary }}>
                     {callType === "AUDIO" ? "Audio call" : "Camera off"}
                  </p>
               </div>
            )}

            {!remoteMedia.microphone && (
               <div
                  className="absolute top-4 left-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                  style={{ background: "rgba(0,0,0,0.55)", color: "#F87171" }}
               >
                  <MicOffIcon /> Muted
               </div>
            )}

            {remoteMedia.screenShare && (
               <div
                  className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs"
                  style={{ background: "rgba(0,0,0,0.55)", color: "#93C5FD" }}
               >
                  Presenting their screen
               </div>
            )}

            {connectionIssue === "reconnecting" && (
               <div
                  className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 py-2 text-sm"
                  style={{
                     background: "rgba(217,119,6,0.9)",
                     color: "#0F172A",
                  }}
               >
                  <span
                     className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
                     style={{
                        borderColor: "#0F172A",
                        borderTopColor: "transparent",
                     }}
                  />
                  Reconnecting…
               </div>
            )}

            {mediaError && (
               <div
                  className="absolute inset-x-4 bottom-4 rounded-xl p-4"
                  style={{
                     background: "rgba(127,29,29,0.92)",
                     color: "#FEE2E2",
                  }}
               >
                  <p className="text-sm font-semibold">{mediaError.title}</p>
                  <p className="text-xs mt-1">{mediaError.body}</p>
               </div>
            )}

            {deviceNotice && (
               <div
                  className="absolute top-4 right-4 px-3 py-1.5 rounded-full text-xs"
                  style={{ background: "rgba(0,0,0,0.65)", color: "#FBBF24" }}
               >
                  {deviceNotice}
               </div>
            )}

            {/* Local PiP */}
            {callType === "VIDEO" && (
               <div
                  className="absolute bottom-4 right-4 overflow-hidden"
                  style={{
                     width: 160,
                     height: 112,
                     border: `1px solid ${borderColor}`,
                     background: surfaceBg,
                     borderRadius: 8,
                  }}
               >
                  {isVideoOff ? (
                     <div className="w-full h-full flex items-center justify-center">
                        <Avatar id="me" size={40} color={primary} />
                     </div>
                  ) : (
                     <video
                        ref={localVideoRef}
                        autoPlay
                        muted
                        playsInline
                        className="w-full h-full object-cover"
                        style={{
                           transform: isScreenSharing ? undefined : "scaleX(-1)",
                        }}
                     />
                  )}
               </div>
            )}

            {/* Device selector overlay */}
            {showDevices && (
               <div
                  className="absolute top-4 right-4 rounded-xl p-4"
                  style={{
                     background: surfaceBg,
                     border: `1px solid ${borderColor}`,
                     boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
                     zIndex: 20,
                     width: 240,
                  }}
               >
                  <p
                     className="text-xs font-semibold mb-3"
                     style={{ color: textPrimary }}
                  >
                     Devices
                  </p>
                  <div className="flex flex-col gap-3">
                     <label
                        className="text-xs"
                        style={{ color: textSecondary }}
                     >
                        Microphone
                        <select
                           value={selectedDevice.audio}
                           onChange={(e) =>
                              selectDevice("audio", e.target.value)
                           }
                           className="w-full mt-1 px-2 py-1.5 rounded-lg text-sm"
                           style={{
                              background: shellBg,
                              color: textPrimary,
                              border: `1px solid ${borderColor}`,
                           }}
                        >
                           <option value="">Default</option>
                           {deviceState.audioInputs.map((d) => (
                              <option key={d.deviceId} value={d.deviceId}>
                                 {d.label ||
                                    `Microphone ${d.deviceId.slice(0, 4)}`}
                              </option>
                           ))}
                        </select>
                     </label>
                     <label
                        className="text-xs"
                        style={{ color: textSecondary }}
                     >
                        Speaker
                        <select
                           className="w-full mt-1 px-2 py-1.5 rounded-lg text-sm"
                           style={{
                              background: shellBg,
                              color: textPrimary,
                              border: `1px solid ${borderColor}`,
                           }}
                        >
                           {deviceState.audioOutputs.map((d) => (
                              <option key={d.deviceId} value={d.deviceId}>
                                 {d.label ||
                                    `Speaker ${d.deviceId.slice(0, 4)}`}
                              </option>
                           ))}
                        </select>
                     </label>
                     <label
                        className="text-xs"
                        style={{ color: textSecondary }}
                     >
                        Camera
                        <select
                           value={selectedDevice.video}
                           onChange={(e) =>
                              selectDevice("video", e.target.value)
                           }
                           className="w-full mt-1 px-2 py-1.5 rounded-lg text-sm"
                           style={{
                              background: shellBg,
                              color: textPrimary,
                              border: `1px solid ${borderColor}`,
                           }}
                        >
                           <option value="">Default</option>
                           {deviceState.videoInputs.map((d) => (
                              <option key={d.deviceId} value={d.deviceId}>
                                 {d.label || `Camera ${d.deviceId.slice(0, 4)}`}
                              </option>
                           ))}
                        </select>
                     </label>
                  </div>
               </div>
            )}
         </div>

         {/* Controls */}
         <div
            className="flex justify-center items-center gap-3 sm:gap-4 px-4 sm:px-6 py-5 flex-wrap"
            style={{ borderTop: `1px solid ${borderColor}` }}
         >
            <ControlButton
               active={isMuted}
               activeColor="#3F1515"
               onClick={toggleMute}
               label={isMuted ? "Unmute" : "Mute"}
               dark={isDark}
               borderColor={borderColor}
            >
               {isMuted ? <MicOffIcon /> : <MicIcon />}
            </ControlButton>

            {callType === "VIDEO" && (
               <ControlButton
                  active={isVideoOff}
                  activeColor="#3F1515"
                  onClick={toggleVideo}
                  label={isVideoOff ? "Camera on" : "Camera off"}
                  dark={isDark}
                  borderColor={borderColor}
               >
                  {isVideoOff ? <VideoOffIcon /> : <VideoIcon />}
               </ControlButton>
            )}

            {callType === "VIDEO" && (
               <ControlButton
                  active={isScreenSharing}
                  activeColor="#1E3A5F"
                  onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                  label={isScreenSharing ? "Stop share" : "Share screen"}
                  dark={isDark}
                  borderColor={borderColor}
               >
                  <ScreenShareIcon active={isScreenSharing} />
               </ControlButton>
            )}

            <ControlButton
               active={showDevices}
               activeColor="#1E3A5F"
               onClick={() => setShowDevices((s) => !s)}
               label="Devices"
               dark={isDark}
               borderColor={borderColor}
            >
               <SettingsIcon />
            </ControlButton>

            <ControlButton
               active
               activeColor="#7F1D1D"
               onClick={endCall}
               label="End call"
               size={56}
               dark={isDark}
               borderColor={borderColor}
            >
               <PhoneDownIcon />
            </ControlButton>
         </div>
      </div>
   );
}

// ── Sub-components ────────────────────────────────────────

function ConnectionQualityDot({ quality }: { quality: ConnectionQuality }) {
   const color =
      quality === "good"
         ? "#34D399"
         : quality === "unstable"
           ? "#FBBF24"
           : "#F87171";
   const label =
      quality === "good"
         ? "Good connection"
         : quality === "unstable"
           ? "Unstable connection"
           : "Poor connection";
   return (
      <span
         className="w-2 h-2 rounded-full"
         style={{ background: color }}
         title={label}
         aria-label={label}
      />
   );
}

function ControlButton({
   children,
   active,
   activeColor,
   onClick,
   label,
   size = 48,
   dark = true,
   borderColor = "#1A2240",
}: {
   children: React.ReactNode;
   active: boolean;
   activeColor: string;
   onClick: () => void;
   label: string;
   size?: number;
   dark?: boolean;
   borderColor?: string;
}) {
   const idleBg = dark ? "#1A2240" : "#E2E8F0";
   return (
      <div className="flex flex-col items-center gap-1.5">
         <button
            onClick={onClick}
            aria-label={label}
            style={{
               width: size,
               height: size,
               borderRadius: "50%",
               background: active ? activeColor : idleBg,
               border: "1px solid",
               borderColor: active ? "transparent" : borderColor,
               display: "flex",
               alignItems: "center",
               justifyContent: "center",
               transition: "background 0.15s",
               cursor: "pointer",
            }}
         >
            {children}
         </button>
         <span
            className="text-xs"
            style={{ color: dark ? "#CBD5E1" : "#334155" }}
         >
            {label}
         </span>
      </div>
   );
}

// ── Icons (inline SVG, no external deps) ─────────────────

function MicIcon() {
   return (
      <svg
         width="18"
         height="18"
         viewBox="0 0 24 24"
         fill="none"
         stroke="#94A3B8"
         strokeWidth="2"
         strokeLinecap="round"
         strokeLinejoin="round"
      >
         <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
         <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
         <line x1="12" y1="19" x2="12" y2="23" />
         <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
   );
}

function MicOffIcon() {
   return (
      <svg
         width="18"
         height="18"
         viewBox="0 0 24 24"
         fill="none"
         stroke="#F87171"
         strokeWidth="2"
         strokeLinecap="round"
         strokeLinejoin="round"
      >
         <line x1="1" y1="1" x2="23" y2="23" />
         <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
         <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
         <line x1="12" y1="19" x2="12" y2="23" />
         <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
   );
}

function VideoIcon() {
   return (
      <svg
         width="18"
         height="18"
         viewBox="0 0 24 24"
         fill="none"
         stroke="#94A3B8"
         strokeWidth="2"
         strokeLinecap="round"
         strokeLinejoin="round"
      >
         <polygon points="23 7 16 12 23 17 23 7" />
         <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
   );
}

function VideoOffIcon() {
   return (
      <svg
         width="18"
         height="18"
         viewBox="0 0 24 24"
         fill="none"
         stroke="#F87171"
         strokeWidth="2"
         strokeLinecap="round"
         strokeLinejoin="round"
      >
         <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34" />
         <polygon points="23 7 16 12 23 17 23 7" />
         <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
   );
}

function PhoneIcon() {
   return (
      <svg
         width="22"
         height="22"
         viewBox="0 0 24 24"
         fill="none"
         stroke="#4ADE80"
         strokeWidth="2"
         strokeLinecap="round"
         strokeLinejoin="round"
      >
         <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 5.51 5.51l1.27-.84a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.2 16l.72.92z" />
      </svg>
   );
}

function PhoneDownIcon() {
   return (
      <svg
         width="22"
         height="22"
         viewBox="0 0 24 24"
         fill="none"
         stroke="#F87171"
         strokeWidth="2"
         strokeLinecap="round"
         strokeLinejoin="round"
      >
         <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-.85a2 2 0 0 1 2.11-.43 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.44-2.47M6.51 6.51A19.5 19.5 0 0 0 3.07 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 1.82 1.2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.44 2.08L6.51 8.8" />
         <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
   );
}

function ScreenShareIcon({ active }: { active: boolean }) {
   const stroke = active ? "#60A5FA" : "#94A3B8";
   return (
      <svg
         width="18"
         height="18"
         viewBox="0 0 24 24"
         fill="none"
         stroke={stroke}
         strokeWidth="2"
         strokeLinecap="round"
         strokeLinejoin="round"
      >
         <rect x="2" y="3" width="20" height="14" rx="2" />
         <polyline points="8 21 12 17 16 21" />
         <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
   );
}

function SettingsIcon() {
   return (
      <svg
         width="18"
         height="18"
         viewBox="0 0 24 24"
         fill="none"
         stroke="#94A3B8"
         strokeWidth="2"
         strokeLinecap="round"
         strokeLinejoin="round"
      >
         <circle cx="12" cy="12" r="3" />
         <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
   );
}

// ── Page shell ─────────────────────────────────────────────

export default function CallPage() {
   return (
      <Suspense
         fallback={
            <div
               className="min-h-screen flex items-center justify-center"
               style={{ background: "#060A17" }}
            >
               <div className="w-10 h-10 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
            </div>
         }
      >
         <CallPageContent />
      </Suspense>
   );
}
