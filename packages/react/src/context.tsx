import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  PurpleCallioMeeting,
  ConnectionState,
  Participant,
} from '@purplecallio/sdk';

export interface MeetingProviderProps {
  token: string;
  callId: string;
  signalUrl: string;
  apiUrl?: string;
  video?: boolean;
  audio?: boolean;
  /** Custom ICE servers passed through to the engine. */
  iceServers?: RTCIceServer[];
  onStateChange?: (state: MeetingContextValue) => void;
  children: React.ReactNode;
}

export interface MeetingContextValue {
  engine: PurpleCallioMeeting | null;
  callId: string;
  participantId: string | null;
  connectionState: ConnectionState;
  participants: Participant[];
  media: {
    camera: boolean;
    microphone: boolean;
    screenShare: boolean;
  };
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  join: () => Promise<void>;
  leave: () => Promise<void>;
  toggleCamera: () => void;
  toggleMicrophone: () => void;
  toggleScreenShare: () => void;
  enableCamera: () => void;
  disableCamera: () => void;
  enableMicrophone: () => void;
  disableMicrophone: () => void;
  startScreenShare: () => void;
  stopScreenShare: () => void;
}

const MeetingContext = createContext<MeetingContextValue | null>(null);

export function useMeetingContext(): MeetingContextValue {
  const ctx = useContext(MeetingContext);
  if (!ctx) {
    throw new Error(
      'useMeeting* hooks must be used within a <MeetingProvider>',
    );
  }
  return ctx;
}

export function MeetingProvider({
  token,
  callId,
  signalUrl,
  apiUrl,
  video = true,
  audio = true,
  iceServers,
  onStateChange,
  children,
}: MeetingProviderProps) {
  const engineRef = useRef<PurpleCallioMeeting | null>(null);

  const [connectionState, setConnectionState] =
    useState<ConnectionState>('idle');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [media, setMedia] = useState({
    camera: video,
    microphone: audio,
    screenShare: false,
  });
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);

  // Create the engine once.
  if (!engineRef.current) {
engineRef.current = new PurpleCallioMeeting({
      token,
      callId,
      signalUrl,
      apiUrl,
      video,
      audio,
      iceServers,
    });
  }
  const engine = engineRef.current;

  // Subscribe to engine events.
  useEffect(() => {
    if (!engine) return;

    const offs: Array<() => void> = [];

    offs.push(engine.onConnectionStateChanged((state) => setConnectionState(state as ConnectionState)));

    offs.push(
      engine.on('connected', (p) => {
        setParticipantId(p.participantId);
      }),
    );
    offs.push(
      engine.on('remote.stream', (stream) => setRemoteStream(stream)),
    );
    offs.push(
      engine.on('remote.stream.ended', () => setRemoteStream(null)),
    );
    offs.push(
      engine.onParticipantsChanged(setParticipants),
    );
    offs.push(engine.onMeetingStateChanged?.((state) => {
      setLocalStream(state.localStream);
      setRemoteStream(state.remoteStream);
      setParticipantId(state.participantId || null);
      setMedia(state.media);
    }) ?? (() => {}));
    offs.push(engine.on('camera.enabled', () => setMedia((m) => ({ ...m, camera: true }))));
    offs.push(engine.on('camera.disabled', () => setMedia((m) => ({ ...m, camera: false }))));
    offs.push(engine.on('microphone.enabled', () => setMedia((m) => ({ ...m, microphone: true }))));
    offs.push(engine.on('microphone.disabled', () => setMedia((m) => ({ ...m, microphone: false }))));
    offs.push(engine.on('screenShare.started', () => setMedia((m) => ({ ...m, screenShare: true }))));
    offs.push(engine.on('screenShare.stopped', () => setMedia((m) => ({ ...m, screenShare: false }))));

    return () => {
      offs.forEach((off) => off());
    };
  }, [engine]);

  // Defer final cleanup so StrictMode's development-only setup/cleanup replay
  // does not tear down an engine that is immediately mounted again.
  const lifecycleRef = useRef(0);
  useEffect(() => {
    const generation = ++lifecycleRef.current;
    return () => {
      queueMicrotask(() => {
        if (lifecycleRef.current === generation) void engine.leave();
      });
    };
  }, [engine]);

  const join = useCallback(async () => {
    if (!engine) return;
    await engine.join();
  }, [engine]);

  const leave = useCallback(async () => {
    if (!engine) return;
    await engine.leave();
    setConnectionState('disconnected');
    setRemoteStream(null);
    setLocalStream(null);
    setParticipantId(null);
    setParticipants([]);
    setMedia({ camera: false, microphone: false, screenShare: false });
  }, [engine]);

  const toggleCamera = useCallback(() => {
    engine?.camera.toggle();
  }, [engine]);
  const toggleMicrophone = useCallback(() => {
    engine?.microphone.toggle();
  }, [engine]);
  const toggleScreenShare = useCallback(() => {
    engine?.screenShare.start();
  }, [engine]);

  const enableCamera = useCallback(() => engine?.camera.enable(), [engine]);
  const disableCamera = useCallback(() => engine?.camera.disable(), [engine]);
  const enableMicrophone = useCallback(() => engine?.microphone.enable(), [engine]);
  const disableMicrophone = useCallback(() => engine?.microphone.disable(), [engine]);
  const startScreenShare = useCallback(() => engine?.screenShare.start(), [engine]);
  const stopScreenShare = useCallback(() => engine?.screenShare.stop(), [engine]);

  const value = useMemo<MeetingContextValue>(
    () => ({
      engine,
      callId,
      participantId,
      connectionState,
      participants,
      media,
      remoteStream,
      localStream,
      join,
      leave,
      toggleCamera,
      toggleMicrophone,
      toggleScreenShare,
      enableCamera,
      disableCamera,
      enableMicrophone,
      disableMicrophone,
      startScreenShare,
      stopScreenShare,
    }),
    [
      engine,
      callId,
      participantId,
      connectionState,
      participants,
      media,
      remoteStream,
      localStream,
      join,
      leave,
      toggleCamera,
      toggleMicrophone,
      toggleScreenShare,
      enableCamera,
      disableCamera,
      enableMicrophone,
      disableMicrophone,
      startScreenShare,
      stopScreenShare,
    ],
  );

  useEffect(() => {
    onStateChange?.(value);
  }, [value, onStateChange]);

  return (
    <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>
  );
}
