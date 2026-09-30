import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeMeeting } from './fake-meeting';

vi.mock('@purplecallio/sdk', async () => {
  const mod = await import('./fake-meeting');
  return { PurpleCallioMeeting: mod.FakeMeeting };
});

// Imported after the mock is registered so the provider picks up FakeMeeting.
import { MeetingProvider, MeetingRoom, useMeeting } from '../src/index';

const baseProps = {
  token: 'participant-token',
  callId: 'call-1',
  signalUrl: 'wss://example.com',
};

function TestConsumer() {
  const { media, toggleCamera, toggleMicrophone, enableCamera, disableMicrophone } =
    useMeeting();
  return (
    <div>
      <span data-testid="camera-state">{String(media.camera)}</span>
      <span data-testid="mic-state">{String(media.microphone)}</span>
      <button data-testid="toggle-camera" onClick={toggleCamera}>
        toggle camera
      </button>
      <button data-testid="toggle-mic" onClick={toggleMicrophone}>
        toggle mic
      </button>
      <button data-testid="enable-camera" onClick={enableCamera}>
        enable camera
      </button>
      <button data-testid="disable-mic" onClick={disableMicrophone}>
        disable mic
      </button>
    </div>
  );
}

function renderProvider() {
  render(
    <MeetingProvider {...baseProps}>
      <TestConsumer />
    </MeetingProvider>,
  );
  return FakeMeeting.instances[FakeMeeting.instances.length - 1];
}

beforeEach(() => {
  FakeMeeting.instances.length = 0;
});

describe('MeetingProvider toggle behavior', () => {
  it('shows the waiting room after the room join reaches joined state', () => {
    render(
      <MeetingProvider {...baseProps}>
        <MeetingRoom waitingRoomTimeoutMs={60_000}>
          <TestConsumer />
        </MeetingRoom>
      </MeetingProvider>,
    );
    const engine = FakeMeeting.instances[FakeMeeting.instances.length - 1];

    act(() => engine.setConnectionState('joined'));

    expect(screen.getByText('Waiting for the other participant…')).toBeTruthy();
  });

  it('toggleCamera() delegates to the engine\'s camera.toggle(), not enable()/disable()', () => {
    const engine = renderProvider();

    act(() => {
      screen.getByTestId('toggle-camera').click();
    });

    expect(engine.camera.toggle).toHaveBeenCalledTimes(1);
    expect(engine.camera.enable).not.toHaveBeenCalled();
    expect(engine.camera.disable).not.toHaveBeenCalled();
  });

  it('toggleMicrophone() delegates to the engine\'s microphone.toggle(), not enable()/disable()', () => {
    const engine = renderProvider();

    act(() => {
      screen.getByTestId('toggle-mic').click();
    });

    expect(engine.microphone.toggle).toHaveBeenCalledTimes(1);
    expect(engine.microphone.enable).not.toHaveBeenCalled();
    expect(engine.microphone.disable).not.toHaveBeenCalled();
  });

  it('repeated toggles each call the engine again', () => {
    const engine = renderProvider();

    act(() => {
      screen.getByTestId('toggle-camera').click();
      screen.getByTestId('toggle-camera').click();
      screen.getByTestId('toggle-camera').click();
    });

    expect(engine.camera.toggle).toHaveBeenCalledTimes(3);
  });

  it('React state stays synchronized with camera.enabled/disabled events after a toggle', () => {
    const engine = renderProvider();

    // The fake engine's `toggle()` is a bare mock — it doesn't itself flip
    // state or emit events (that behavior lives in the real SDK's
    // CameraController). What we're verifying here is the provider's own
    // event wiring: when the engine *reports* a state change, React state
    // reflects it, regardless of what triggered that report.
    act(() => {
      engine.emit('camera.disabled', { callId: 'call-1', participantId: 'p1' });
    });
    expect(screen.getByTestId('camera-state').textContent).toBe('false');

    act(() => {
      engine.emit('camera.enabled', { callId: 'call-1', participantId: 'p1' });
    });
    expect(screen.getByTestId('camera-state').textContent).toBe('true');
  });

  it('React state stays synchronized with microphone.enabled/disabled events after a toggle', () => {
    const engine = renderProvider();

    act(() => {
      engine.emit('microphone.disabled', { callId: 'call-1', participantId: 'p1' });
    });
    expect(screen.getByTestId('mic-state').textContent).toBe('false');

    act(() => {
      engine.emit('microphone.enabled', { callId: 'call-1', participantId: 'p1' });
    });
    expect(screen.getByTestId('mic-state').textContent).toBe('true');
  });

  it('does not break existing enableCamera()/disableMicrophone() behavior', () => {
    const engine = renderProvider();

    act(() => {
      screen.getByTestId('enable-camera').click();
      screen.getByTestId('disable-mic').click();
    });

    expect(engine.camera.enable).toHaveBeenCalledTimes(1);
    expect(engine.microphone.disable).toHaveBeenCalledTimes(1);
    // Confirms the toggle fix didn't accidentally repurpose enable/disable.
    expect(engine.camera.toggle).not.toHaveBeenCalled();
    expect(engine.microphone.toggle).not.toHaveBeenCalled();
  });
});
