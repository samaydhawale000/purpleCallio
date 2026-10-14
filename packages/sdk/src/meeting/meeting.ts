import type {
   EngineConfig,
   MeetingSnapshot,
   Participant,
   ParticipantRole,
} from "../types";
import { SignalingTransport } from "../transport/socket";
import {
   SignalingEvents,
   SignalingEvent,
   SignalingEventMap,
} from "../signaling/events";
import { ConnectionStateMachine } from "../state/connection-state";
import { ParticipantStore } from "../state/participant-store";
import { MeetingState } from "../state/meeting-state";
import { CameraController } from "../media/camera";
import { MicrophoneController } from "../media/microphone";
import { ScreenShareController } from "../media/screenShare";
import {
   IceRecovery,
   candidateMatchesRemote,
   readMediaBytes,
   readSelectedPath,
   type ConnectivityFailureReason,
   type MediaPath,
} from "../webrtc/connectivity";

/** Poll interval for path classification and media-flow checks. */
const STATS_POLL_MS = 1_000;
/** Report the path this long after connecting even if no media arrived yet. */
const MEDIA_WAIT_MS = 5_000;
/** Inbound media silent this long on a connected call → recover. */
const MEDIA_STALL_MS = 10_000;

/**
 * Headless PurpleCallio meeting engine.
 *
 * Orchestrates the signaling transport, WebRTC peer connection, and media
 * controllers behind a single clean API. Layering:
 *   - signaling/transport → socket only (no WebRTC)
 *   - media/* → WebRTC only (no sockets)
 *   - state/* → pure state (no side effects)
 *   - meeting.ts → wires them together
 *
 * @example
 * const meeting = new PurpleCallio({ token, callId, signalUrl, iceServers });
 * await meeting.join();
 * meeting.camera.toggle();
 * meeting.microphone.isEnabled();
 * meeting.screenShare.start();
 * meeting.leave();
 */
export class PurpleCallioMeeting {
   private readonly config: EngineConfig;
   private transport: SignalingTransport | null = null;
   private pc: RTCPeerConnection | null = null;
   private localStream: MediaStream | null = null;
   private participantRole: ParticipantRole | null = null;
   private offerCreated = false;
   private iceServers: RTCIceServer[] = [];
   private recovery: IceRecovery | null = null;
   /** Offer/answer/candidates are applied strictly in arrival order. */
   private signalingQueue: Promise<void> = Promise.resolve();
   private negotiationStartedAt: number | null = null;
   private statsTimer: ReturnType<typeof setInterval> | null = null;
   private media = {
      connectedAt: null as number | null,
      firstInboundAt: null as number | null,
      lastInbound: 0,
      lastInboundChangeAt: 0,
   };
   private readonly pendingIceCandidates: RTCIceCandidateInit[] = [];
   private readonly seenIceCandidates = new Set<string>();
   private transportReported = false;
   private reportedPath: MediaPath | null = null;
   private resolvedApiBase: string | null = null;
   private readonly reportedIceOutcomes = new Set<
      "SUCCESS" | "FAILED" | "GAVE_UP"
   >();
   private audioOutputDeviceId = "";
   private readonly audioElements = new Set<HTMLMediaElement>();

   private readonly connection = new ConnectionStateMachine();
   private readonly participantStore = new ParticipantStore();
   private readonly meetingState = new MeetingState();

   private cameraCtrl: CameraController;
   private microphoneCtrl: MicrophoneController;
   private screenShareCtrl: ScreenShareController;

   private joinPromise: Promise<void> | null = null;
   private joinedRoom = false;
   private restoringRoom = false;
   private callEnded = false;
   private cleanupFns: Array<() => void> = [];

   constructor(config: EngineConfig) {
      if (!config.token) throw new Error("PurpleCallio: token is required");
      if (!config.callId) throw new Error("PurpleCallio: callId is required");
      if (!config.signalUrl)
         throw new Error("PurpleCallio: signalUrl is required");
      this.config = config;

      this.cameraCtrl = new CameraController(() => this.localStream);
      this.microphoneCtrl = new MicrophoneController(() => this.localStream);
      this.screenShareCtrl = new ScreenShareController(
         () => this.pc,
         () => this.localStream,
      );

      // Wire media controllers → meeting state → listeners.
      this.cameraCtrl.onChange((enabled) => {
         this.meetingState.updateMedia({ camera: enabled });
         this.emitMedia("camera", enabled);
      });
      this.microphoneCtrl.onChange((enabled) => {
         this.meetingState.updateMedia({ microphone: enabled });
         this.emitMedia("microphone", enabled);
      });
      this.screenShareCtrl.onChange((active) => {
         this.meetingState.updateMedia({ screenShare: active });
         this.emitMedia("screenShare", active);
      });
   }

   // ── Public API ───────────────────────────────────────────

   async join(): Promise<void> {
      // Idempotent: if already connected/joining, return the same promise.
      if (this.connection.state === "joined") return;
      if (this.joinedRoom && this.transport) return;
      if (this.callEnded) throw new Error("CALL_ENDED");
      if (this.joinPromise) return this.joinPromise;

      this.joinPromise = this.joinInternal();
      try {
         await this.joinPromise;
      } catch (error) {
         this.transport?.disconnect();
         this.transport = null;
         this.joinedRoom = false;
         this.cleanupMedia();
         this.participantStore.clear();
         this.meetingState.reset();
         this.connection.set("error");
         throw error;
      } finally {
         this.joinPromise = null;
      }
   }

   leave(): Promise<void> {
      if (
         this.connection.state === "leaving" ||
         this.connection.state === "disconnected"
      ) {
         return Promise.resolve();
      }
      this.connection.set("leaving");
      this.screenShareCtrl.stop();
      this.cleanupMedia();
      this.transport?.emit("leave-call", { callId: this.config.callId });
      this.transport?.disconnect();
      this.transport = null;
      this.joinedRoom = false;
      this.participantStore.clear();
      this.meetingState.reset();
      this.connection.set("disconnected");
      this.emit("disconnected", { reason: "left" });
      return Promise.resolve();
   }

   camera = {
      enable: () => this.cameraCtrl.enable(),
      disable: () => this.cameraCtrl.disable(),
      toggle: () => this.cameraCtrl.toggle(),
      isEnabled: () => this.cameraCtrl.isEnabled(),
   };

   microphone = {
      enable: () => this.microphoneCtrl.enable(),
      disable: () => this.microphoneCtrl.disable(),
      toggle: () => this.microphoneCtrl.toggle(),
      isEnabled: () => this.microphoneCtrl.isEnabled(),
   };

   screenShare = {
      start: () => this.screenShareCtrl.start(),
      stop: () => this.screenShareCtrl.stop(),
      isActive: () => this.screenShareCtrl.isActive(),
   };

   participants(): Participant[] {
      return this.participantStore.list();
   }

   connectionState(): string {
      return this.connection.state;
   }

   get localStreamRef(): MediaStream | null {
      return this.localStream;
   }

   async setAudioInput(deviceId: string): Promise<void> {
      await this.replaceInputTrack("audio", deviceId);
   }

   async setVideoInput(deviceId: string): Promise<void> {
      await this.replaceInputTrack("video", deviceId);
   }

   async setAudioOutput(deviceId: string): Promise<void> {
      const elements = [...this.audioElements];
      const prototypeSupportsSinkId =
         typeof HTMLMediaElement !== "undefined" &&
         "setSinkId" in HTMLMediaElement.prototype;
      const supportsSinkId =
         prototypeSupportsSinkId &&
         elements.every(
            (element) =>
               typeof (
                  element as HTMLMediaElement & {
                     setSinkId?: (id: string) => Promise<void>;
                  }
               ).setSinkId === "function",
         );
      if (!supportsSinkId) {
         throw new Error("AUDIO_OUTPUT_SWITCH_UNSUPPORTED");
      }
      const applied: HTMLMediaElement[] = [];
      try {
         for (const element of elements) {
            await (
               element as HTMLMediaElement & {
                  setSinkId: (id: string) => Promise<void>;
               }
            ).setSinkId(deviceId);
            applied.push(element);
         }
         this.audioOutputDeviceId = deviceId;
      } catch {
         for (const element of applied) {
            try {
               await (
                  element as HTMLMediaElement & {
                     setSinkId: (id: string) => Promise<void>;
                  }
               ).setSinkId(this.audioOutputDeviceId);
            } catch {
               /* preserve original output error */
            }
         }
         throw new Error("DEVICE_SWITCH_FAILED");
      }
   }

   registerAudioElement(element: HTMLMediaElement): () => void {
      this.audioElements.add(element);
      const setter = (
         element as HTMLMediaElement & {
            setSinkId?: (id: string) => Promise<void>;
         }
      ).setSinkId;
      if (this.audioOutputDeviceId && setter)
         void setter
            .call(element, this.audioOutputDeviceId)
            .catch(() =>
               this.emit("connection.diagnostic", {
                  code: "AUDIO_OUTPUT_SWITCH_FAILED",
               }),
            );
      return () => this.audioElements.delete(element);
   }

   private async replaceInputTrack(
      kind: "audio" | "video",
      deviceId: string,
   ): Promise<void> {
      if (
         !deviceId ||
         !navigator.mediaDevices?.getUserMedia ||
         !this.localStream ||
         !this.pc
      ) {
         throw new Error("DEVICE_SWITCH_FAILED");
      }
      const oldTrack =
         kind === "audio"
            ? this.localStream.getAudioTracks()[0]
            : this.localStream.getVideoTracks()[0];
      if (!oldTrack) throw new Error("DEVICE_SWITCH_FAILED");
      let acquired: MediaStream | null = null;
      try {
         acquired = await navigator.mediaDevices.getUserMedia({
            audio: kind === "audio" ? { deviceId: { exact: deviceId } } : false,
            video: kind === "video" ? { deviceId: { exact: deviceId } } : false,
         });
         const nextTrack =
            kind === "audio"
               ? acquired.getAudioTracks()[0]
               : acquired.getVideoTracks()[0];
         const sender = this.pc
            .getSenders()
            .find((item) => item.track?.kind === kind);
         if (!nextTrack || !sender) throw new Error("DEVICE_SWITCH_FAILED");
         nextTrack.enabled = oldTrack.enabled;
         await sender.replaceTrack(nextTrack);
         this.localStream.removeTrack(oldTrack);
         this.localStream.addTrack(nextTrack);
         oldTrack.stop();
         acquired
            .getTracks()
            .filter((track) => track !== nextTrack)
            .forEach((track) => track.stop());
         this.meetingState.localStream = this.localStream;
      } catch (error) {
         acquired?.getTracks().forEach((track) => track.stop());
         throw error instanceof Error &&
            error.message === "DEVICE_SWITCH_FAILED"
            ? error
            : new Error("DEVICE_SWITCH_FAILED");
      }
   }

   /** Snapshot exposes identity + state, never tokens. */
   snapshot(): MeetingSnapshot {
      return {
         callId: this.config.callId,
         participantId: this.meetingState.snapshot().participantId,
         participants: this.participantStore.list(),
         connectionState: this.connection.state,
         media: this.meetingState.media,
         remoteStream: this.meetingState.remoteStream,
      };
   }

   // ── Events ───────────────────────────────────────────────

   on<K extends SignalingEvent>(
      event: K,
      listener: (payload: SignalingEventMap[K]) => void,
   ): () => void {
      if (!this.signaling) this.signaling = new SignalingEvents();
      return this.signaling.on(event, listener);
   }

   off<K extends SignalingEvent>(
      event: K,
      listener: (payload: SignalingEventMap[K]) => void,
   ): void {
      this.signaling?.off(event, listener);
   }

   /** Subscribe to connection state changes. */
   onConnectionStateChanged(listener: (state: string) => void): () => void {
      return this.connection.onChange((s) => listener(s));
   }

   /** Subscribe to participant list changes. */
   onParticipantsChanged(
      listener: (participants: Participant[]) => void,
   ): () => void {
      return this.participantStore.onChange(listener);
   }

   /** Subscribe to local/remote stream + media changes. */
   onMeetingStateChanged(
      listener: (s: ReturnType<MeetingState["snapshot"]>) => void,
   ): () => void {
      return this.meetingState.onChange(listener);
   }

   private signaling: SignalingEvents | null = null;

   private emit<K extends SignalingEvent>(
      event: K,
      payload: SignalingEventMap[K],
   ): void {
      this.signaling?.emit(event, payload);
   }

   // ── Media events ─────────────────────────────────────────

   private emitMedia(
      kind: "camera" | "microphone" | "screenShare",
      active: boolean,
   ) {
      const event = (
         kind === "camera"
            ? active
               ? "camera.enabled"
               : "camera.disabled"
            : kind === "microphone"
              ? active
                 ? "microphone.enabled"
                 : "microphone.disabled"
              : active
                ? "screenShare.started"
                : "screenShare.stopped"
      ) as SignalingEvent;
      this.transport?.emit(event, { callId: this.config.callId });
      this.emit(event, {
         callId: this.config.callId,
         participantId: this.meetingState.snapshot().participantId,
      });
   }

   // ── Internals ────────────────────────────────────────────

   private async joinInternal(): Promise<void> {
      this.connection.set("connecting");

      // 1. Acquire local media.
      await this.initLocalMedia();

      // 2. Connect + authenticate (single handshake).
      this.connection.set("authenticating");
      this.transport = new SignalingTransport(
         this.config.signalUrl,
         this.config.token,
      );
      this.attachTransport(this.transport);
      await this.transport.connect();

      // 3. Join the call room.
      this.connection.set("joining");
      const joined = await this.transport.emitWithAck<{
         success: boolean;
         error?: string;
         state?: { participants: Participant[] };
      }>("join-call", { callId: this.config.callId });
      if (!joined?.success)
         throw new Error(joined?.error ?? "CALL_JOIN_FAILED");
      this.joinedRoom = true;
      if (joined.state)
         this.applyParticipantSnapshot(joined.state.participants);
      this.connection.set("joined");
   }

   private async initLocalMedia(): Promise<void> {
      const [stream, iceServers] = await Promise.all([
         navigator.mediaDevices.getUserMedia({
            audio: this.config.audio ?? true,
            video: this.config.video ?? true,
         }),
         this.resolveIceServers(),
      ]);

      this.localStream = stream;
      this.iceServers = iceServers;
      this.meetingState.localStream = stream;
      this.cameraCtrl.setStreamProvider(() => this.localStream);
      this.microphoneCtrl.setStreamProvider(() => this.localStream);

      this.createPeerConnection(
         stream.getTracks().map((track) => ({ track, stream })),
      );

      this.cameraCtrl.sync();
      this.microphoneCtrl.sync();
   }

   /**
    * One RTCPeerConnection per negotiation with the current remote peer.
    * ICE servers (STUN + TURN) are resolved before this runs, so the very
    * first gathering already includes relay candidates: ICE tries direct
    * pairs and falls back to TURN within the same negotiation.
    */
   private createPeerConnection(
      senders: Array<{ track: MediaStreamTrack; stream: MediaStream }>,
   ): RTCPeerConnection {
      const pc = new RTCPeerConnection({
         iceServers: this.iceServers,
         iceTransportPolicy: this.config.iceTransportPolicy ?? "all",
      });
      senders.forEach(({ track, stream }) => pc.addTrack(track, stream));
      this.pc = pc;

      pc.ontrack = (event) => {
         const s =
            event.streams[0] ??
            this.meetingState.remoteStream ??
            new MediaStream();
         if (!s.getTracks().includes(event.track)) s.addTrack(event.track);
         this.meetingState.remoteStream = s;
         this.emit("remote.stream", s);
      };

      pc.onicecandidate = (event) => {
         if (event.candidate && this.transport) {
            this.transport.emit("ice-candidate", {
               candidate: event.candidate,
            });
         }
      };

      const recovery = new IceRecovery({
         ...this.config.iceRecovery,
         canRestart: () =>
            this.pc === pc &&
            this.participantRole === "CALLER" &&
            this.joinedRoom &&
            !!this.transport?.isConnected,
         restart: () => this.restartIce(pc),
         onStatus: (status, reason) => {
            if (this.pc !== pc) return;
            this.emit("connection.status", {
               status,
               reason,
               restarts: recovery.restartCount,
            });
         },
         onGiveUp: (reason) => {
            if (this.pc !== pc) return;
            this.emit("connection.diagnostic", { code: "ICE_FAILED" });
            void this.reportIceOutcome(pc, "FAILED", reason, true);
         },
      });
      this.recovery = recovery;

      pc.oniceconnectionstatechange = () => {
         if (this.pc !== pc) return;
         const iceState = pc.iceConnectionState;
         recovery.onIceState(iceState);
         if (iceState === "connected" || iceState === "completed") {
            const now = Date.now();
            if (this.media.connectedAt === null) this.media.connectedAt = now;
            // Media silence before this (re)connection is not a stall.
            this.media.lastInboundChangeAt = now;
            this.startStatsMonitor(pc);
            void this.reportIceOutcome(pc, "SUCCESS");
         } else if (iceState === "failed") {
            // Only a hard 'failed' counts: 'disconnected' often recovers.
            void this.reportIceOutcome(pc, "FAILED", "ICE_FAILED");
         }
      };

      return pc;
   }

   /** Replace a peer connection whose remote end is a different (new) peer. */
   private resetPeerConnection(): RTCPeerConnection | null {
      const old = this.pc;
      if (!old || !this.localStream) return null;
      const stream = this.localStream;
      const senders = old
         .getSenders()
         .flatMap((sender) => (sender.track ? [{ track: sender.track, stream }] : []));
      this.teardownPeerConnection();
      this.meetingState.remoteStream = null;
      this.emit("remote.stream.ended", {});
      return this.createPeerConnection(
         senders.length
            ? senders
            : stream.getTracks().map((track) => ({ track, stream })),
      );
   }

   private teardownPeerConnection(): void {
      this.stopStatsMonitor();
      this.recovery?.dispose();
      this.recovery = null;
      this.pc?.close();
      this.pc = null;
      this.offerCreated = false;
      this.negotiationStartedAt = null;
      this.media = {
         connectedAt: null,
         firstInboundAt: null,
         lastInbound: 0,
         lastInboundChangeAt: 0,
      };
      this.transportReported = false;
      this.reportedPath = null;
      this.reportedIceOutcomes.clear();
      this.pendingIceCandidates.length = 0;
      this.seenIceCandidates.clear();
   }

   /**
    * Resolve ICE servers honoring custom configuration:
    *  - If `overrideIceServers` is set, use ONLY custom servers.
    *  - If custom servers are provided, merge them with backend servers,
    *    de-duplicating by URL.
    *  - Otherwise fetch from the backend.
    */
   private async resolveIceServers(): Promise<RTCIceServer[]> {
      const custom = this.config.iceServers ?? [];
      if (this.config.overrideIceServers) {
         return deployUnique(custom);
      }

      const backend = await this.fetchBackendIceServers();
      if (custom.length === 0) return backend;
      return deployUnique([...custom, ...backend]);
   }

   private async fetchBackendIceServers(): Promise<RTCIceServer[]> {
      try {
         const res = await this.apiFetch("/turn/credentials", {
            headers: { Authorization: `Bearer ${this.config.token}` },
         });
         if (!res.ok) throw new Error();
         const data = (await res.json()) as { iceServers: RTCIceServer[] };
         return data.iceServers ?? [];
      } catch {
         if (
            typeof process !== "undefined" &&
            process.env?.NODE_ENV !== "production"
         ) {
            console.warn(
               "[PurpleCallio] TURN_CREDENTIALS_FAILED; continuing with STUN fallback.",
            );
         }
         this.emit("connection.diagnostic", {
            code: "TURN_CREDENTIALS_FAILED",
         });
         return [{ urls: "stun:stun.l.google.com:19302" }];
      }
   }

   /**
    * fetch() against the REST API. An explicit `apiUrl` is used as-is.
    * Without one, REST may sit at the signaling origin (a bare server) or
    * under `/api` behind the standard Nginx deployment, where the origin root
    * is the web app. Try the origin first and fall through to `/api` when it
    * answers with a non-API (non-JSON) 404 — or, in a browser, when fetch()
    * rejects because the web app fails the CORS preflight — remembering
    * whichever base worked.
    */
   private async apiFetch(path: string, init: RequestInit): Promise<Response> {
      const signal = this.config.signalUrl.replace(/\/$/, "");
      const bases = this.resolvedApiBase
         ? [this.resolvedApiBase]
         : this.config.apiUrl
           ? [this.config.apiUrl.replace(/\/$/, "")]
           : [signal, `${signal}/api`];
      for (let i = 0; ; i++) {
         const isLast = i === bases.length - 1;
         let res: Response;
         try {
            res = await fetch(`${bases[i]}${path}`, init);
         } catch (error) {
            if (isLast) throw error;
            continue;
         }
         const contentType = res.headers?.get?.("content-type") ?? "";
         if (!isLast && res.status === 404 && !contentType.includes("json"))
            continue;
         this.resolvedApiBase = bases[i];
         return res;
      }
   }

   /**
    * Polls getStats() while the call is connected: classifies the selected
    * candidate pair (P2P vs TURN), confirms media is actually arriving, and
    * hands a stalled-but-"connected" call to the recovery policy.
    */
   private startStatsMonitor(pc: RTCPeerConnection): void {
      if (!this.statsTimer)
         this.statsTimer = setInterval(() => {
            void this.pollStats(pc);
         }, STATS_POLL_MS);
      void this.pollStats(pc);
   }

   private stopStatsMonitor(): void {
      if (this.statsTimer) clearInterval(this.statsTimer);
      this.statsTimer = null;
   }

   private async pollStats(pc: RTCPeerConnection): Promise<void> {
      if (this.pc !== pc || isPeerClosed(pc)) return;
      let stats: RTCStatsReport;
      try {
         stats = await pc.getStats();
      } catch {
         return; // getStats() shape varies across platforms — never block the call
      }
      if (this.pc !== pc) return;
      const now = Date.now();
      const { inbound } = readMediaBytes(stats);
      if (inbound > this.media.lastInbound) {
         this.media.lastInbound = inbound;
         this.media.lastInboundChangeAt = now;
         if (this.media.firstInboundAt === null) this.media.firstInboundAt = now;
      }

      const connected = this.recovery?.isConnected ?? false;
      if (
         connected &&
         this.media.firstInboundAt !== null &&
         now - this.media.lastInboundChangeAt > MEDIA_STALL_MS
      ) {
         this.media.lastInboundChangeAt = now;
         this.recovery?.onMediaStalled();
      }

      const path = readSelectedPath(stats);
      if (!connected || path.path === "UNKNOWN") return;
      const mediaSeen = this.media.firstInboundAt !== null;
      const waited =
         this.media.connectedAt !== null &&
         now - this.media.connectedAt >= MEDIA_WAIT_MS;
      // Report once per (re)connection, after media arrives (or a short
      // wait), and again if a later restart moved the call to another path.
      if (this.transportReported && this.reportedPath === path.path) return;
      if (!mediaSeen && !waited && !this.transportReported) return;
      this.transportReported = true;
      this.reportedPath = path.path;
      const started = this.negotiationStartedAt;
      this.emit("connection.status", {
         status: "connected",
         path: path.path,
         restarts: this.recovery?.restartCount ?? 0,
      });
      await this.postTelemetry("webrtc-transport", {
         transport: path.path,
         candidateType: path.localCandidateType,
         remoteCandidateType: path.remoteCandidateType,
         protocol: path.protocol,
         relayProtocol: path.relayProtocol,
         rttMs: path.rttMs,
         availableOutgoingBitrate: path.availableOutgoingBitrate,
         setupMs:
            started !== null && this.media.connectedAt !== null
               ? Math.max(0, this.media.connectedAt - started)
               : undefined,
         firstMediaMs:
            started !== null && this.media.firstInboundAt !== null
               ? Math.max(0, this.media.firstInboundAt - started)
               : undefined,
         mediaVerified: mediaSeen,
         iceRestarts: this.recovery?.restartCount ?? 0,
      });
   }

   /**
    * At most once per outcome per peer connection; a FAILED can later
    * recover to SUCCESS. `final` marks recovery giving up (reported once).
    */
   private async reportIceOutcome(
      pc: RTCPeerConnection,
      outcome: "SUCCESS" | "FAILED",
      reason?: ConnectivityFailureReason,
      final = false,
   ): Promise<void> {
      const key = final ? "GAVE_UP" : outcome;
      if (this.pc !== pc || this.reportedIceOutcomes.has(key)) return;
      this.reportedIceOutcomes.add(key);
      await this.postTelemetry("webrtc-ice", {
         outcome,
         iceConnectionState: pc.iceConnectionState,
         connectionState: pc.connectionState,
         ...(reason ? { reason: final ? "RECOVERY_EXHAUSTED" : reason } : {}),
         ...(final ? { cause: reason } : {}),
         iceRestarts: this.recovery?.restartCount ?? 0,
      });
   }

   private async postTelemetry(path: string, body: unknown): Promise<void> {
      if (typeof fetch !== "function") return;
      try {
         await this.apiFetch(
            `/calls/${encodeURIComponent(this.config.callId)}/${path}`,
            {
               method: "POST",
               headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${this.config.token}`,
               },
               body: JSON.stringify(body),
            },
         );
      } catch {
         /* telemetry is best-effort */
      }
   }

   private createOffer = async () => {
      const pc = this.pc;
      if (!pc || this.participantRole !== "CALLER" || this.offerCreated)
         return;
      this.offerCreated = true;
      try {
         const offer = await pc.createOffer();
         await pc.setLocalDescription(offer);
         this.markNegotiationStarted();
         this.transport?.emit("offer", { offer });
      } catch (error) {
         if (this.pc === pc) this.offerCreated = false;
         throw error;
      }
   };

   /** ICE restart: fresh ICE credentials, re-gathered host/srflx/relay candidates. */
   private async restartIce(pc: RTCPeerConnection): Promise<void> {
      if (this.pc !== pc || isPeerClosed(pc)) return;
      const offer = await pc.createOffer({ iceRestart: true });
      if (this.pc !== pc) return;
      await pc.setLocalDescription(offer);
      this.transport?.emit("offer", { offer });
   }

   private markNegotiationStarted(): void {
      if (this.negotiationStartedAt === null)
         this.negotiationStartedAt = Date.now();
      this.recovery?.start();
   }

   private negotiateIfPeerPresent(roomSize: number | undefined): void {
      if (typeof roomSize !== "number" || roomSize < 2) return;
      // The peer is (back) in the room: a recovery that stalled while
      // signaling was unavailable can send its restart offer now.
      this.recovery?.onSignalingRestored();
      void this.createOffer().catch(() =>
         this.emit("connection.diagnostic", { code: "ICE_FAILED" }),
      );
   }

   /** Serializes signaling so an offer, its answer and candidates never interleave. */
   private enqueueSignaling(task: () => Promise<void>): void {
      this.signalingQueue = this.signalingQueue
         .then(task)
         .catch(() =>
            this.emit("connection.diagnostic", { code: "ICE_FAILED" }),
         );
   }

   private handleOffer = async (payload: {
      offer: RTCSessionDescriptionInit;
   }) => {
      let pc = this.pc;
      if (!pc || isPeerClosed(pc)) return;
      if (pc.remoteDescription?.sdp === payload.offer.sdp) return;
      try {
         await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
      } catch (error) {
         // An offer from a peer that rejoined with a new RTCPeerConnection
         // (page refresh) carries a new DTLS identity that cannot be applied
         // to the old connection: start over on a fresh one.
         if (!pc.remoteDescription) throw error;
         pc = this.resetPeerConnection();
         if (!pc) throw error;
         await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
      }
      this.markNegotiationStarted();
      await this.flushIceCandidates();
      const answer = await pc.createAnswer();
      if (this.pc !== pc) return;
      await pc.setLocalDescription(answer);
      this.transport?.emit("answer", { answer });
   };

   private handleAnswer = async (payload: {
      answer: RTCSessionDescriptionInit;
   }) => {
      const pc = this.pc;
      if (!pc || isPeerClosed(pc)) return;
      // Only an answer to our outstanding offer applies; a duplicate or
      // stale one would fail or corrupt the negotiation.
      if ((pc.signalingState as string) !== "have-local-offer") return;
      try {
         await pc.setRemoteDescription(
            new RTCSessionDescription(payload.answer),
         );
      } catch (error) {
         // The receiver answered from a new peer connection (it reloaded
         // since our offer was negotiated): renegotiate from scratch.
         if (!pc.remoteDescription) throw error;
         if (!this.resetPeerConnection()) throw error;
         await this.createOffer();
         return;
      }
      await this.flushIceCandidates();
   };

   private handleIceCandidate = async (payload: {
      candidate: RTCIceCandidateInit;
   }) => {
      const pc = this.pc;
      if (!pc || isPeerClosed(pc) || !payload?.candidate) return;
      const key = JSON.stringify(payload.candidate);
      if (this.seenIceCandidates.has(key)) return;
      this.seenIceCandidates.add(key);
      if (this.seenIceCandidates.size > 512) this.seenIceCandidates.clear();
      if (!candidateMatchesRemote(payload.candidate, pc.remoteDescription)) {
         // Before the (new) remote description: hold until it is applied.
         if (this.pendingIceCandidates.length >= 256)
            this.pendingIceCandidates.shift();
         this.pendingIceCandidates.push(payload.candidate);
         return;
      }
      try {
         await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch {
         if (this.pc === pc)
            this.emit("connection.diagnostic", { code: "ICE_FAILED" });
      }
   };

   private async flushIceCandidates(): Promise<void> {
      const pc = this.pc;
      if (!pc?.remoteDescription || isPeerClosed(pc)) return;
      const queued = this.pendingIceCandidates.splice(0);
      for (const candidate of queued) {
         if (this.pc !== pc || isPeerClosed(pc)) return;
         if (!candidateMatchesRemote(candidate, pc.remoteDescription)) {
            // Belongs to a newer ICE generation than the one just applied.
            this.pendingIceCandidates.push(candidate);
            continue;
         }
         try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
         } catch {
            if (this.pc === pc)
               this.emit("connection.diagnostic", { code: "ICE_FAILED" });
         }
      }
   }

   private attachTransport(transport: SignalingTransport): void {
      const raw = transport.on;
      const offs: Array<() => void> = [];

      offs.push(
         raw("connected", (p) => {
            this.participantRole = p.role;
            this.meetingState.identity = {
               callId: p.callId,
               participantId: p.participantId,
               role: p.role,
            };
            this.connection.set("connected");
            this.emit("connected", p);
            if (this.joinedRoom) void this.restoreRoom();
         }),
      );

      offs.push(
         raw("reconnected", (p) => {
            this.connection.set("connected");
            this.emit("reconnected", p);
         }),
      );

      offs.push(
         raw("disconnected", (p) => {
            this.connection.set("disconnected");
            this.emit("disconnected", p);
         }),
      );

      offs.push(
         raw("participant.joined", (p) => {
            this.participantStore.upsert({
               participantId: p.participantId,
               role: this.resolveRole(p.participantId),
            });
            this.emit("participant.joined", p);
            this.negotiateIfPeerPresent(p.participants);
         }),
      );

      offs.push(
         raw("call.state", (p) => {
            this.applyParticipantSnapshot(p.participants ?? []);
            this.negotiateIfPeerPresent((p.participants ?? []).length);
         }),
      );

      offs.push(
         raw("participant.left", (p) => {
            this.participantStore.remove(p.participantId);
            this.emit("participant.left", p);
         }),
      );

      offs.push(
         raw("participant.updated", (p) => {
            if (p.media)
               this.participantStore.updateMedia(p.participantId, p.media);
            this.emit("participant.updated", p);
         }),
      );

      // Media relays.
      offs.push(raw("camera.enabled", (p) => this.emit("camera.enabled", p)));
      offs.push(raw("camera.disabled", (p) => this.emit("camera.disabled", p)));
      offs.push(
         raw("microphone.enabled", (p) => this.emit("microphone.enabled", p)),
      );
      offs.push(
         raw("microphone.disabled", (p) => this.emit("microphone.disabled", p)),
      );
      offs.push(
         raw("screenShare.started", (p) => this.emit("screenShare.started", p)),
      );
      offs.push(
         raw("screenShare.stopped", (p) => this.emit("screenShare.stopped", p)),
      );

      offs.push(
         raw("call.started", (p) => {
            this.emit("call.started", p);
         }),
      );
      offs.push(
         raw("call.ended", (p) => {
            this.callEnded = true;
            this.joinedRoom = false;
            this.emit("call.ended", p);
            this.cleanupMedia();
            this.transport?.disconnect();
            this.transport = null;
            this.connection.set("disconnected");
         }),
      );
      offs.push(
         raw("call.expired", (p) => {
            this.callEnded = true;
            this.joinedRoom = false;
            this.emit("call.expired", p);
            this.cleanupMedia();
            this.transport?.disconnect();
            this.transport = null;
            this.connection.set("disconnected");
         }),
      );

      // WebRTC signaling.
      offs.push(
         raw("offer", (p) => this.enqueueSignaling(() => this.handleOffer(p))),
      );
      offs.push(
         raw("answer", (p) =>
            this.enqueueSignaling(() => this.handleAnswer(p)),
         ),
      );
      offs.push(
         raw("ice-candidate", (p) =>
            this.enqueueSignaling(() => this.handleIceCandidate(p)),
         ),
      );

      this.cleanupFns = offs;
   }

   private resolveRole(participantId: string): ParticipantRole {
      const mine = this.meetingState.snapshot().participantId;
      return participantId === mine ? "CALLER" : "RECEIVER";
   }

   private applyParticipantSnapshot(participants: Participant[]): void {
      this.participantStore.replace(participants);
   }

   private async restoreRoom(): Promise<void> {
      if (
         !this.joinedRoom ||
         this.restoringRoom ||
         !this.transport?.isConnected
      )
         return;
      this.restoringRoom = true;
      try {
         const joined = await this.transport.emitWithAck<{
            success: boolean;
            error?: string;
            state?: { participants: Participant[] };
         }>("join-call", { callId: this.config.callId });
         if (!joined?.success)
            throw new Error(joined?.error ?? "CALL_JOIN_FAILED");
         if (joined.state)
            this.applyParticipantSnapshot(joined.state.participants);
         this.connection.set("joined");
         // Restart offers sent while the socket was down were dropped.
         this.recovery?.onSignalingRestored();
      } catch {
         this.joinedRoom = false;
         this.connection.set("error");
         this.emit("connection.diagnostic", { code: "ICE_FAILED" });
      } finally {
         this.restoringRoom = false;
      }
   }

   private cleanupMedia(): void {
      this.teardownPeerConnection();
      this.signalingQueue = Promise.resolve();
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      this.meetingState.localStream = null;
      this.meetingState.remoteStream = null;
      this.emit("remote.stream.ended", {});
      this.cleanupFns.forEach((f) => f());
      this.cleanupFns = [];
      this.participantRole = null;
   }
}

/** De-duplicate ICE servers by their `urls` field (string or array). */
function deployUnique(servers: RTCIceServer[]): RTCIceServer[] {
   const seen = new Set<string>();
   const out: RTCIceServer[] = [];
   for (const s of servers) {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      const key = urls.join("|");
      if (!seen.has(key)) {
         seen.add(key);
         out.push(s);
      }
   }
   return out;
}

function isPeerClosed(pc: RTCPeerConnection): boolean {
   return (pc.signalingState as string) === "closed";
}
