# @purplecallio/react

Official React components and hooks for PurpleCallio, a developer-focused real-time communication infrastructure platform.

The package provides reusable React components, hooks, controls, participant layouts, device management, and meeting state.

## Features

- React meeting provider
- Meeting room
- Participant grid
- Participant tiles
- Active speaker view
- Camera controls
- Microphone controls
- Screen sharing
- Leave/end-call controls
- Device selector
- Waiting room
- Connection status
- Speaking indicator
- Local video preview
- Participant hooks
- Device hooks
- Connection state hooks
- TypeScript support

---

# Installation

```bash
npm install @purplecallio/react
```

`@purplecallio/react` uses the PurpleCallio SDK internally.

If you are also using the SDK directly in your application:

```bash
npm install @purplecallio/react @purplecallio/sdk
```

---

# Requirements

- React 18+
- React DOM 18+
- A browser with WebRTC support
- Camera/microphone permissions for audio/video functionality

---

# Basic Architecture

```text
Your React Application
          │
          ▼
   @purplecallio/react
          │
          ▼
    @purplecallio/sdk
          │
          ▼
      PurpleCallio
          │
          ▼
        WebRTC
```

`@purplecallio/react` provides the React layer while `@purplecallio/sdk` provides the underlying PurpleCallio communication engine.

---

# Authentication & Session Setup

`MeetingProvider` needs three pieces of information before it can connect a call: a **participant token**, a **call ID**, and a **signaling URL**. This section documents exactly where each one comes from, verified against the current `@purplecallio/sdk` (0.2.2) implementation — nothing here is guessed.

## 1. Create the call on your server

Never use your PurpleCallio API key in browser code. Create the call from your backend with `@purplecallio/sdk`'s `PurpleCallioClient`:

```ts
// Server-side only.
import { PurpleCallioClient } from "@purplecallio/sdk";

const client = new PurpleCallioClient({ apiKey: process.env.PURPLECALLIO_API_KEY! });
const call = await client.createCall({ callerId, receiverId, type: "VIDEO" });
```

`createCall()` resolves to a `CreateCallResult`, which (per `packages/sdk/src/types/index.ts`) includes:

```ts
interface CreateCallResult {
  callId: string;
  participants: Array<{
    participantId: string;
    token: string;      // pass this participant's own token, never another's
    hostedUrl: string;
    expiresAt: string;
  }>;
  // ...other fields not needed by MeetingProvider
}
```

Send each participant **their own** `token` and the shared `callId` to their browser over your own authenticated API — never send one participant's token to a different participant.

## 2. `signalUrl` and `apiUrl`

`MeetingProvider` (and the `PurpleCallioMeeting` engine it wraps) requires a `signalUrl`; it accepts an optional `apiUrl` for REST requests such as TURN credentials. These values are not currently included in `CreateCallResult`, so return them with the call session from your backend.

Use the Socket.IO origin for `signalUrl` and the REST API base for `apiUrl`. With the current Nginx routing, the hosted deployment uses `signalUrl: 'https://<your-purplecallio-host>'` and `apiUrl: 'https://<your-purplecallio-host>/api'`. If `apiUrl` is omitted for compatibility, the SDK uses `signalUrl` as the REST base; provide it explicitly when REST is mounted under a prefix.

---

# Meeting Provider

`MeetingProvider` constructs the underlying `PurpleCallioMeeting` engine (from `@purplecallio/sdk`) and provides its meeting state, participant information, media streams, connection state, and controls to your React components via context.

## Props (`MeetingProviderProps`, verified against `packages/react/src/context.tsx`)

| Prop | Type | Required | Notes |
|---|---|---|---|
| `token` | `string` | **yes** | Participant token — see "Authentication & Session Setup" above. Never an API key. |
| `callId` | `string` | **yes** | From `CreateCallResult.callId`. |
| `signalUrl` | `string` | **yes** | See "Authentication & Session Setup" above. |
| `apiUrl` | `string` | no | REST API base URL, including any proxy path prefix such as `/api`. |
| `video` | `boolean` | no | Default `true`. |
| `audio` | `boolean` | no | Default `true`. |
| `iceServers` | `RTCIceServer[]` | no | Passed straight through to the engine. |
| `onStateChange` | `(state: MeetingContextValue) => void` | no | Called whenever the meeting context value changes. |
| `children` | `React.ReactNode` | **yes** | |

## Two things the source confirms that are easy to miss

1. **`MeetingProvider` does not join the call automatically.** It only constructs the engine on mount. You must call `join()` yourself — see the example below.
2. **The engine is created once, from the first render's props**, and is not recreated if `token`/`callId`/`signalUrl` change on a later render. To join a different call, remount the provider (for example with a React `key`).

## Usage

```tsx
import { useEffect } from "react";
import { MeetingProvider, useMeeting } from "@purplecallio/react";

function Call({ token, callId, signalUrl, apiUrl }: { token: string; callId: string; signalUrl: string; apiUrl: string }) {
  return (
    <MeetingProvider token={token} callId={callId} signalUrl={signalUrl} apiUrl={apiUrl}>
      <Room />
    </MeetingProvider>
  );
}

function Room() {
  const { join, leave, connectionState } = useMeeting();

  useEffect(() => {
    join();
    return () => {
      leave();
    };
  }, [join, leave]);

  return <p>Connection: {connectionState}</p>;
}
```

Components and hooks that depend on meeting state should be rendered inside `MeetingProvider`.

---

# Meeting Hooks

## `useMeeting()`

Returns the complete meeting context.

```tsx
import { useMeeting } from "@purplecallio/react";

function MeetingControls() {
  const {
    callId,
    participantId,
    connectionState,
    participants,
    localStream,
    remoteStream,
    join,
    leave,
    toggleCamera,
    toggleMicrophone
  } = useMeeting();

  return (
    <div>
      <p>Call: {callId}</p>
      <p>Connection: {connectionState}</p>
      <p>Participants: {participants.length}</p>
    </div>
  );
}
```

The meeting context exposes:

```text
engine
callId
participantId
connectionState
participants
media
remoteStream
localStream
join
leave
toggleCamera
toggleMicrophone
toggleScreenShare
enableCamera
disableCamera
enableMicrophone
disableMicrophone
startScreenShare
stopScreenShare
```

> **Known issue — `toggleScreenShare()`**: verified against `packages/react/src/context.tsx`, this currently always calls the engine's `screenShare.start()`, regardless of whether sharing is already active — it does not actually toggle. Use `startScreenShare()`/`stopScreenShare()` directly (checking `media.screenShare` for current state) until this is fixed. See "Screen Sharing" below.

---

# `useParticipants()`

Returns the current participants.

```tsx
import { useParticipants } from "@purplecallio/react";

function Participants() {
  const participants = useParticipants();

  return (
    <div>
      {participants.map((participant) => (
        <div key={participant.participantId}>
          {participant.participantId}
        </div>
      ))}
    </div>
  );
}
```

Return type:

```ts
Participant[]
```

---

# `useParticipant()`

Retrieve a specific participant by participant ID.

```tsx
import { useParticipant } from "@purplecallio/react";

function ParticipantInfo() {
  const participant = useParticipant("participant-123");

  if (!participant) {
    return <div>Participant not found</div>;
  }

  return (
    <div>
      {participant.participantId}
    </div>
  );
}
```

Return type:

```ts
Participant | undefined
```

---

# `useDevices()`

Provides access to available audio and video devices.

```tsx
import { useDevices } from "@purplecallio/react";

function Devices() {
  const {
    audioInputs,
    audioOutputs,
    videoInputs,
    selected,
    loading,
    refresh,
    setAudioInput,
    setAudioOutput,
    setVideoInput
  } = useDevices();

  return (
    <div>
      <p>
        Device loading:
        {loading ? "Yes" : "No"}
      </p>

      {audioInputs.map((device) => (
        <button
          key={device.deviceId}
          onClick={() => setAudioInput(device.deviceId)}
        >
          {device.label}
        </button>
      ))}
    </div>
  );
}
```

## Device Information

```ts
interface DeviceInfo {
  deviceId: string;
  kind: MediaDeviceKind;
  label: string;
}
```

## Device Result

```ts
interface DevicesResult {
  audioInputs: DeviceInfo[];
  audioOutputs: DeviceInfo[];
  videoInputs: DeviceInfo[];

  selected: {
    audioInput: string;
    audioOutput: string;
    videoInput: string;
  };

  loading: boolean;

  refresh: () => Promise<void>;

  setAudioInput: (deviceId: string) => void;
  setAudioOutput: (deviceId: string) => void;
  setVideoInput: (deviceId: string) => void;
}
```

---

# `useConnection()`

Returns the current PurpleCallio connection state.

```tsx
import { useConnection } from "@purplecallio/react";

function Connection() {
  const connectionState = useConnection();

  return (
    <div>
      Connection: {connectionState}
    </div>
  );
}
```

Return type:

```ts
ConnectionState
```

---

# Layout Components

## `MeetingRoom`

A high-level meeting container.

```tsx
import {
  MeetingProvider,
  MeetingRoom
} from "@purplecallio/react";

function App({ token, callId, signalUrl, apiUrl }: { token: string; callId: string; signalUrl: string; apiUrl: string }) {
  return (
    <MeetingProvider token={token} callId={callId} signalUrl={signalUrl} apiUrl={apiUrl}>
      <MeetingRoom>
        {/* Meeting content */}
      </MeetingRoom>
    </MeetingProvider>
  );
}
```

Props:

```ts
interface MeetingRoomProps {
  children?: React.ReactNode;
  className?: string;
  showWaitingRoom?: boolean;
  waitingRoomLabel?: string;
}
```

Defaults:

```text
showWaitingRoom = true
waitingRoomLabel = "Waiting for the other participant…"
```

---

# `ParticipantGrid`

Displays multiple participant streams.

```tsx
import { ParticipantGrid } from "@purplecallio/react";

<ParticipantGrid
  streams={streams}
  names={names}
  localStream={localStream}
/>
```

Props:

```ts
interface ParticipantGridProps {
  streams: Record<string, MediaStream | null>;
  names?: Record<string, string>;
  localStream?: MediaStream | null;
  localName?: string;
  localId?: string;
}
```

Defaults:

```text
localName = "You"
localId = "me"
```

---

# `ParticipantTile`

Displays an individual participant.

```tsx
import { ParticipantTile } from "@purplecallio/react";

<ParticipantTile
  participantId="participant-123"
  name="John"
  stream={remoteStream}
/>
```

Props:

```ts
interface ParticipantTileProps {
  participantId: string;
  name?: string;
  stream?: MediaStream | null;
  muted?: boolean;
  mirror?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
```

---

# `ActiveSpeakerView`

Displays a primary active speaker.

```tsx
import { ActiveSpeakerView } from "@purplecallio/react";

<ActiveSpeakerView
  stream={speakerStream}
  name="John"
  participantId="participant-123"
  localStream={localStream}
/>
```

Props:

```ts
interface ActiveSpeakerViewProps {
  stream: MediaStream | null;
  name?: string;
  participantId?: string;
  localStream?: MediaStream | null;
}
```

Default:

```text
participantId = "speaker"
```

---

# `Avatar`

Displays a participant avatar.

```tsx
import { Avatar } from "@purplecallio/react";

<Avatar
  id="participant-123"
  size={48}
/>
```

Props:

```ts
id: string;
size?: number;
```

Default:

```text
size = 48
```

---

# Call Controls

## `ControlButton`

Generic reusable meeting control.

```tsx
import { ControlButton } from "@purplecallio/react";

<ControlButton
  label="Camera"
  active={true}
  onClick={() => {
    console.log("Camera clicked");
  }}
>
  Camera
</ControlButton>
```

Props:

```ts
interface ControlButtonProps {
  label: string;
  active: boolean;
  activeColor?: string;
  onClick: () => void;
  disabled?: boolean;
  size?: number;
  children: React.ReactNode;
  title?: string;
}
```

---

# `CameraButton`

Built-in camera toggle control.

```tsx
import { CameraButton } from "@purplecallio/react";

<CameraButton />
```

Custom labels:

```tsx
<CameraButton
  labelOn="Turn camera off"
  labelOff="Turn camera on"
/>
```

Props:

```ts
interface CameraButtonProps {
  labelOn?: string;
  labelOff?: string;
  className?: string;
}
```

Default labels:

```text
Camera on
Camera off
```

---

# `MicrophoneButton`

Built-in microphone toggle control.

```tsx
import { MicrophoneButton } from "@purplecallio/react";

<MicrophoneButton />
```

Custom labels:

```tsx
<MicrophoneButton
  labelOn="Mute"
  labelOff="Unmute"
/>
```

Props:

```ts
interface MicrophoneButtonProps {
  labelOn?: string;
  labelOff?: string;
}
```

Default labels:

```text
Unmute
Mute
```

---

# `ScreenShareButton`

Built-in screen sharing control.

```tsx
import { ScreenShareButton } from "@purplecallio/react";

<ScreenShareButton />
```

Default labels:

```text
Share screen
Stop share
```

> **Verified limitation**: this component calls `toggleScreenShare()` internally, which — as documented above under `useMeeting()` — always starts a new share rather than stopping an active one. In practice this means clicking the button a second time (to stop sharing) does not work correctly. Screen sharing itself works; build your own control with `startScreenShare()`/`stopScreenShare()` and `media.screenShare` (see "Screen Sharing" below) until this component is fixed.

---

# `LeaveButton`

Built-in call leave/end control.

```tsx
import { LeaveButton } from "@purplecallio/react";

<LeaveButton />
```

Custom label and callback:

```tsx
<LeaveButton
  label="End call"
  onLeave={() => {
    console.log("Call ended");
  }}
/>
```

Props:

```ts
interface LeaveButtonProps {
  label?: string;
  onLeave?: () => void;
  size?: number;
}
```

Default label:

```text
End call
```

---

# Device Selector

Use the built-in device selector:

```tsx
import { DeviceSelector } from "@purplecallio/react";

<DeviceSelector />
```

Hide the label:

```tsx
<DeviceSelector showLabel={false} />
```

Props:

```ts
interface DeviceSelectorProps {
  showLabel?: boolean;
  className?: string;
}
```

---

# Waiting Room

Display a waiting room while waiting for another participant.

```tsx
import { WaitingRoom } from "@purplecallio/react";

<WaitingRoom
  title="Waiting for participant"
  subtitle="The other participant has not joined yet."
>
  {/* Optional content */}
</WaitingRoom>
```

Props:

```ts
interface WaitingRoomProps {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
}
```

---

# Connection Status

Display the current connection state.

```tsx
import { ConnectionStatus } from "@purplecallio/react";

<ConnectionStatus />
```

---

# Speaking Indicator

Display an indicator when a participant is speaking.

```tsx
import { SpeakingIndicator } from "@purplecallio/react";

<SpeakingIndicator
  active={true}
  label="Speaking"
/>
```

Props:

```ts
interface SpeakingIndicatorProps {
  active?: boolean;
  label?: string;
  color?: string;
}
```

---

# Local Video Preview

Display the local camera stream.

```tsx
import { LocalVideoPreview } from "@purplecallio/react";

<LocalVideoPreview />
```

Custom class:

```tsx
<LocalVideoPreview className="my-preview" />
```

Props:

```ts
interface LocalVideoPreviewProps {
  className?: string;
}
```

---

# Icons

The package exports reusable meeting icons:

```tsx
import {
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
  PhoneDownIcon,
  ScreenShareIcon
} from "@purplecallio/react";
```

Available icons:

```text
MicIcon
MicOffIcon
VideoIcon
VideoOffIcon
PhoneDownIcon
ScreenShareIcon
```

---

# Complete UI Example

This is a full, verified, end-to-end example — every prop and hook value here is confirmed against the current source (`packages/react/src/context.tsx`, `hooks.ts`, `components/*.tsx`). It deliberately does not use `ScreenShareButton` (see the known issue above) or `ParticipantGrid` (its `streams` prop expects a per-participant map; the current engine only exposes a single `remoteStream` for the other side of a 1:1 call — build that map yourself if you need it, e.g. `{ [otherParticipantId]: remoteStream }`). `ParticipantTile` renders a single stream directly and matches the current 1:1 call model without extra wiring.

`token`, `callId`, and `signalUrl` here come from your own backend — see "Authentication & Session Setup" above.

```tsx
import { useEffect } from "react";
import {
  MeetingProvider,
  useMeeting,
  ParticipantTile,
  CameraButton,
  MicrophoneButton,
  LeaveButton,
  ConnectionStatus
} from "@purplecallio/react";

export default function Meeting({ token, callId, signalUrl, apiUrl }: { token: string; callId: string; signalUrl: string; apiUrl: string }) {
  return (
    <MeetingProvider token={token} callId={callId} signalUrl={signalUrl} apiUrl={apiUrl}>
      <Room />
    </MeetingProvider>
  );
}

function Room() {
  const { join, leave, participantId, localStream, remoteStream } = useMeeting();

  // MeetingProvider constructs the engine but does not join automatically.
  useEffect(() => {
    join();
    return () => {
      leave();
    };
  }, [join, leave]);

  return (
    <div>
      <ConnectionStatus />

      <div style={{ display: "flex", gap: 12 }}>
        <ParticipantTile participantId={participantId ?? "me"} stream={localStream} muted mirror />
        <ParticipantTile participantId="remote" stream={remoteStream} />
      </div>

      <div>
        <CameraButton />
        <MicrophoneButton />
        <LeaveButton />
      </div>
    </div>
  );
}
```

---

# Building a Custom UI

You are not required to use all the built-in components.

You can use the hooks to create your own interface:

```tsx
import { useEffect } from "react";
import {
  useMeeting,
  useParticipants,
  useConnection
} from "@purplecallio/react";

function CustomMeetingUI() {
  const meeting = useMeeting();
  const participants = useParticipants();
  const connection = useConnection();

  useEffect(() => {
    meeting.join();
    return () => {
      meeting.leave();
    };
  }, [meeting.join, meeting.leave]);

  return (
    <div>
      <div>Connection: {connection}</div>

      <div>
        Participants: {participants.length}
      </div>

      <button onClick={meeting.toggleMicrophone}>
        Toggle microphone
      </button>

      <button onClick={meeting.toggleCamera}>
        Toggle camera
      </button>

      {/* toggleScreenShare() is currently a known issue — see above.
          Use startScreenShare()/stopScreenShare() with meeting.media.screenShare instead. */}
      <button onClick={meeting.media.screenShare ? meeting.stopScreenShare : meeting.startScreenShare}>
        {meeting.media.screenShare ? "Stop sharing" : "Share screen"}
      </button>

      <button onClick={meeting.leave}>
        Leave
      </button>
    </div>
  );
}
```

This approach lets you keep your own application design while using PurpleCallio's meeting state and WebRTC functionality.

---

# Meeting Controls Available Through `useMeeting()`

The meeting context provides the following controls:

```text
join()
leave()

toggleCamera()
toggleMicrophone()
toggleScreenShare()

enableCamera()
disableCamera()

enableMicrophone()
disableMicrophone()

startScreenShare()
stopScreenShare()
```

> `toggleScreenShare()` is listed for completeness but has a known issue — see "Screen Sharing" further up. Prefer `startScreenShare()`/`stopScreenShare()` together with `media.screenShare`.

Example:

```tsx
const {
  toggleCamera,
  toggleMicrophone,
  enableCamera,
  disableCamera,
  enableMicrophone,
  disableMicrophone,
  startScreenShare,
  stopScreenShare,
  leave
} = useMeeting();
```

---

# Browser Permissions

PurpleCallio uses browser media APIs for real-time communication.

Depending on the functionality you use, the browser may request access to:

- Camera
- Microphone
- Screen sharing

Users must grant the required permissions for those features to work.

Your application should handle permission errors and provide an appropriate user experience when access is denied.

---

# API Keys

Do not put your PurpleCallio project API key inside React components or browser code.

Bad:

```tsx
const client = new PurpleCallioClient({
  apiKey: "YOUR_SECRET_API_KEY"
});
```

Instead, create/manage calls from your backend and provide the required session information to your frontend.

Recommended architecture:

```text
Browser
   │
   │ session information
   ▼
Your Backend
   │
   │ API key
   ▼
PurpleCallio API
```

The PurpleCallio API key should remain server-side.

---

# TypeScript

The package includes TypeScript declaration files.

Your editor should automatically provide type checking and autocomplete when using:

```tsx
import {
  MeetingProvider,
  MeetingRoom,
  ParticipantGrid,
  CameraButton,
  MicrophoneButton
} from "@purplecallio/react";
```

---

# Available Exports

The package currently exports:

```text
MeetingProvider
useMeetingContext

useMeeting
useParticipants
useParticipant
useDevices
useConnection

MeetingRoom
ParticipantGrid
ParticipantTile
ActiveSpeakerView
Avatar

ControlButton
CameraButton
MicrophoneButton
ScreenShareButton
LeaveButton

MicIcon
MicOffIcon
VideoIcon
VideoOffIcon
PhoneDownIcon
ScreenShareIcon

DeviceSelector
WaitingRoom
ConnectionStatus
SpeakingIndicator
LocalVideoPreview
```

---

# Related Package

PurpleCallio JavaScript/TypeScript SDK:

```bash
npm install @purplecallio/sdk
```

The SDK provides:

- REST API client
- Call management
- Participant session handling
- Headless WebRTC meeting functionality
- TypeScript types

---

# Package

```text
@purplecallio/react
```

Current package version:

```text
0.1.1
```

---

# License

MIT
