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
   private readonly pendingIceCandidates: RTCIceCandidateInit[] = [];
   private readonly seenIceCandidates = new Set<string>();
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
      this.meetingState.localStream = stream;
      this.cameraCtrl.setStreamProvider(() => this.localStream);
      this.microphoneCtrl.setStreamProvider(() => this.localStream);

      const pc = new RTCPeerConnection({ iceServers });
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
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

      this.cameraCtrl.sync();
      this.microphoneCtrl.sync();
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
         const res = await fetch(
            `${(this.config.apiUrl ?? this.config.signalUrl).replace(/\/$/, "")}/turn/credentials`,
            {
               headers: { Authorization: `Bearer ${this.config.token}` },
            },
         );
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

   private createOffer = async () => {
      if (!this.pc || this.participantRole !== "CALLER" || this.offerCreated)
         return;
      this.offerCreated = true;
      try {
         const offer = await this.pc.createOffer();
         await this.pc.setLocalDescription(offer);
         this.transport?.emit("offer", { offer });
      } catch (error) {
         this.offerCreated = false;
         throw error;
      }
   };

   private handleOffer = async (payload: {
      offer: RTCSessionDescriptionInit;
   }) => {
      if (!this.pc || this.pc.signalingState === "closed") return;
      if (this.pc.remoteDescription?.sdp === payload.offer.sdp) return;
      await this.pc.setRemoteDescription(
         new RTCSessionDescription(payload.offer),
      );
      await this.flushIceCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.transport?.emit("answer", { answer });
   };

   private handleAnswer = async (payload: {
      answer: RTCSessionDescriptionInit;
   }) => {
      if (!this.pc || this.pc.signalingState === "closed") return;
      if (this.pc.remoteDescription?.sdp === payload.answer.sdp) return;
      await this.pc.setRemoteDescription(
         new RTCSessionDescription(payload.answer),
      );
      await this.flushIceCandidates();
   };

   private handleIceCandidate = async (payload: {
      candidate: RTCIceCandidateInit;
   }) => {
      const pc = this.pc;
      if (!pc || isPeerClosed(pc)) return;
      const key = JSON.stringify(payload.candidate);
      if (this.seenIceCandidates.has(key)) return;
      this.seenIceCandidates.add(key);
      if (this.seenIceCandidates.size > 512) this.seenIceCandidates.clear();
      if (!pc.remoteDescription) {
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
      const candidates = this.pendingIceCandidates.splice(0);
      for (const candidate of candidates) {
         if (this.pc !== pc || isPeerClosed(pc)) return;
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
            if (p.participantId !== this.meetingState.snapshot().participantId)
               void this.createOffer().catch(() =>
                  this.emit("connection.diagnostic", { code: "ICE_FAILED" }),
               );
         }),
      );

      offs.push(
         raw("call.state", (p) => {
            this.applyParticipantSnapshot(p.participants ?? []);
            if (
               (p.participants ?? []).some(
                  (participant: Participant) =>
                     participant.participantId !==
                     this.meetingState.snapshot().participantId,
               )
            )
               void this.createOffer().catch(() =>
                  this.emit("connection.diagnostic", { code: "ICE_FAILED" }),
               );
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
         raw("offer", (p) => {
            void this.handleOffer(p).catch(() =>
               this.emit("connection.diagnostic", { code: "ICE_FAILED" }),
            );
         }),
      );
      offs.push(
         raw("answer", (p) => {
            void this.handleAnswer(p).catch(() =>
               this.emit("connection.diagnostic", { code: "ICE_FAILED" }),
            );
         }),
      );
      offs.push(
         raw("ice-candidate", (p) => {
            void this.handleIceCandidate(p).catch(() =>
               this.emit("connection.diagnostic", { code: "ICE_FAILED" }),
            );
         }),
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
      } catch {
         this.joinedRoom = false;
         this.connection.set("error");
         this.emit("connection.diagnostic", { code: "ICE_FAILED" });
      } finally {
         this.restoringRoom = false;
      }
   }

   private cleanupMedia(): void {
      this.pc?.close();
      this.pc = null;
      this.localStream?.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      this.meetingState.localStream = null;
      this.meetingState.remoteStream = null;
      this.emit("remote.stream.ended", {});
      this.cleanupFns.forEach((f) => f());
      this.cleanupFns = [];
      this.offerCreated = false;
      this.pendingIceCandidates.length = 0;
      this.seenIceCandidates.clear();
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
