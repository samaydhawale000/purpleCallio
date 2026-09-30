import { useCallback, useEffect, useState } from 'react';

import {
  ConnectionState,
  Participant,
} from '@purplecallio/sdk';

import { useMeetingContext } from './context';

/** Access the full meeting state + controls. */
export function useMeeting() {
  return useMeetingContext();
}

/** Live list of participants (including yourself). */
export function useParticipants(): Participant[] {
  return useMeetingContext().participants;
}

/** Look up a single participant by id. */
export function useParticipant(participantId: string): Participant | undefined {
  const participants = useParticipants();
  return participants.find((p) => p.participantId === participantId);
}

export interface DeviceInfo {
  deviceId: string;
  kind: MediaDeviceKind;
  label: string;
}

export interface DevicesResult {
  audioInputs: DeviceInfo[];
  audioOutputs: DeviceInfo[];
  videoInputs: DeviceInfo[];
  selected: {
    audioInput: string;
    audioOutput: string;
    videoInput: string;
  };
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setAudioInput: (deviceId: string) => Promise<void>;
  setAudioOutput: (deviceId: string) => Promise<void>;
  setVideoInput: (deviceId: string) => Promise<void>;
}

/** Enumerate available media devices and switch between them. */
export function useDevices(): DevicesResult {
  const { engine } = useMeetingContext();

  const [audioInputs, setAudioInputs] = useState<DeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<DeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<DeviceInfo[]>([]);
  const [selected, setSelected] = useState({
    audioInput: '',
    audioOutput: '',
    videoInput: '',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      setLoading(false);
      setError('DEVICE_ENUMERATION_UNSUPPORTED');
      return;
    }
    try {
    const devices = await navigator.mediaDevices.enumerateDevices();

    const inputs: DeviceInfo[] = [];
    const outputs: DeviceInfo[] = [];
    const vids: DeviceInfo[] = [];

    devices.forEach((d) => {
      const info = { deviceId: d.deviceId, kind: d.kind, label: d.label };
      if (d.kind === 'audioinput') inputs.push(info);
      else if (d.kind === 'audiooutput') outputs.push(info);
      else if (d.kind === 'videoinput') vids.push(info);
    });

    setAudioInputs(inputs);
    setAudioOutputs(outputs);
    setVideoInputs(vids);

    setSelected((prev) => ({
      audioInput: inputs.some((item) => item.deviceId === prev.audioInput) ? prev.audioInput : inputs[0]?.deviceId || '',
      audioOutput: outputs.some((item) => item.deviceId === prev.audioOutput) ? prev.audioOutput : outputs[0]?.deviceId || '',
      videoInput: vids.some((item) => item.deviceId === prev.videoInput) ? prev.videoInput : vids[0]?.deviceId || '',
    }));
    setError(null);
    } catch {
      setError('DEVICE_ENUMERATION_FAILED');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setAudioInput = useCallback(
    async (deviceId: string) => {
      if (!engine) throw new Error('MEETING_NOT_JOINED');
      try {
        await engine.setAudioInput(deviceId);
        setSelected((s) => ({ ...s, audioInput: deviceId }));
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'DEVICE_SWITCH_FAILED');
        throw cause;
      }
    },
    [engine],
  );

  const setAudioOutput = useCallback(async (deviceId: string) => {
    if (!engine) throw new Error('MEETING_NOT_JOINED');
    try {
      await engine.setAudioOutput(deviceId);
      setSelected((s) => ({ ...s, audioOutput: deviceId }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'DEVICE_SWITCH_FAILED');
      throw cause;
    }
  }, [engine]);

  const setVideoInput = useCallback(
    async (deviceId: string) => {
      if (!engine) throw new Error('MEETING_NOT_JOINED');
      try {
        await engine.setVideoInput(deviceId);
        setSelected((s) => ({ ...s, videoInput: deviceId }));
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'DEVICE_SWITCH_FAILED');
        throw cause;
      }
    },
    [engine],
  );

  return {
    audioInputs,
    audioOutputs,
    videoInputs,
    selected,
    loading,
    error,
    refresh,
    setAudioInput,
    setAudioOutput,
    setVideoInput,
  };
}

/** Live connection state ('idle' | 'connecting' | 'connected' | ...). */
export function useConnection(): ConnectionState {
  return useMeetingContext().connectionState;
}
