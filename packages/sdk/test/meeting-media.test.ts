import { afterEach, describe, expect, it, vi } from 'vitest';
import { PurpleCallioMeeting } from '../src/meeting/meeting';

describe('PurpleCallioMeeting media and REST routing', () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('replaces the active microphone sender before stopping the previous track', async () => {
    const oldTrack = { kind: 'audio', enabled: false, stop: vi.fn() };
    const newTrack = { kind: 'audio', enabled: true, stop: vi.fn() };
    const tracks = [oldTrack as any];
    const stream = {
      getAudioTracks: () => tracks,
      getVideoTracks: () => [],
      removeTrack: (track: unknown) => tracks.splice(tracks.indexOf(track as any), 1),
      addTrack: (track: unknown) => tracks.push(track as any),
    } as unknown as MediaStream;
    const replaceTrack = vi.fn(async () => undefined);
    const meeting = new PurpleCallioMeeting({ token: 'token', callId: 'call', signalUrl: 'https://signal' });
    Object.assign(meeting as any, {
      localStream: stream,
      pc: { getSenders: () => [{ track: oldTrack, replaceTrack }] },
    });
    const getUserMedia = vi.fn(async () => ({ getAudioTracks: () => [newTrack], getTracks: () => [newTrack] }));
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });

    await meeting.setAudioInput('usb-mic');

    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'usb-mic' } }, video: false });
    expect(replaceTrack).toHaveBeenCalledWith(newTrack);
    expect(newTrack.enabled).toBe(false);
    expect(oldTrack.stop).toHaveBeenCalledOnce();
    expect(stream.getAudioTracks()).toEqual([newTrack]);
  });

  it('keeps the old microphone live if replaceTrack fails', async () => {
    const oldTrack = { kind: 'audio', enabled: true, stop: vi.fn() };
    const newTrack = { kind: 'audio', enabled: true, stop: vi.fn() };
    const stream = {
      getAudioTracks: () => [oldTrack],
      getVideoTracks: () => [],
      removeTrack: vi.fn(),
      addTrack: vi.fn(),
    } as unknown as MediaStream;
    const meeting = new PurpleCallioMeeting({ token: 'token', callId: 'call', signalUrl: 'https://signal' });
    Object.assign(meeting as any, {
      localStream: stream,
      pc: { getSenders: () => [{ track: oldTrack, replaceTrack: vi.fn().mockRejectedValue(new Error('replace failed')) }] },
    });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getAudioTracks: () => [newTrack], getTracks: () => [newTrack] }) } } });

    await expect(meeting.setAudioInput('usb-mic')).rejects.toThrow('DEVICE_SWITCH_FAILED');
    expect(oldTrack.stop).not.toHaveBeenCalled();
    expect(newTrack.stop).toHaveBeenCalledOnce();
  });

  it('requests TURN credentials from apiUrl rather than signalUrl', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ iceServers: [{ urls: 'turn:turn.example' }] }) }));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const meeting = new PurpleCallioMeeting({
      token: 'token',
      callId: 'call',
      signalUrl: 'https://signal.example',
      apiUrl: 'https://api.example/api/',
    });

    await (meeting as any).fetchBackendIceServers();

    expect(fetch).toHaveBeenCalledWith('https://api.example/api/turn/credentials', {
      headers: { Authorization: 'Bearer token' },
    });
  });
});
