import React from 'react';
import { render, screen, act, renderHook, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeAgentCall } from './fake-agent-call';

vi.mock('@purplecallio/sdk', async () => {
  const mod = await import('./fake-agent-call');
  return { PurpleCallioAgentCall: mod.FakeAgentCall };
});

// Imported after the mock is registered so the hook picks up FakeAgentCall.
import { PurpleCallioAI, usePurpleCallioAI } from '../src/index';

const apiUrl = 'https://api.example.com';

function lastCall(): FakeAgentCall {
  return FakeAgentCall.instances[FakeAgentCall.instances.length - 1];
}

async function startHook(getToken = vi.fn(async () => 'bj_ai_token')) {
  const hook = renderHook(() => usePurpleCallioAI({ getToken, apiUrl }));
  let started!: Promise<void>;
  await act(async () => {
    started = hook.result.current.start();
    await Promise.resolve();
  });
  return { hook, getToken, started, call: lastCall() };
}

beforeEach(() => {
  FakeAgentCall.instances.length = 0;
});

describe('usePurpleCallioAI', () => {
  it('fetches a token and builds the call with the required apiUrl', async () => {
    const { hook, getToken, call } = await startHook();

    expect(getToken).toHaveBeenCalledTimes(1);
    expect(call.config).toMatchObject({ token: 'bj_ai_token', apiUrl });
    expect(hook.result.current.status).toBe('connecting');
  });

  it('accepts the whole createSession() result from getToken', async () => {
    const { call } = await startHook(vi.fn(async () => ({ token: 'bj_ai_obj' }) as any));
    expect(call.config.token).toBe('bj_ai_obj');
  });

  it('tracks connection, agent state, transcript and duration', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      const { hook, call, started } = await startHook();

      await act(async () => {
        call.resolveStart();
        await started;
      });
      expect(hook.result.current.status).toBe('connected');

      act(() => {
        call.emit('agentState', 'speaking');
        call.emit('transcript', { role: 'agent', text: 'Hel', final: false });
        call.emit('transcript', { role: 'agent', text: 'Hello there', final: true });
        call.emit('transcript', { role: 'user', text: 'Hi', final: true });
      });
      expect(hook.result.current.agentState).toBe('speaking');
      expect(hook.result.current.transcript.map((l) => l.text)).toEqual(['Hello there', 'Hi']);

      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(hook.result.current.durationSeconds).toBe(3);

      act(() => hook.result.current.end());
      expect(call.endCalls).toBe(1);
      expect(hook.result.current.status).toBe('ended');
      expect(hook.result.current.endedReason).toBe('participant');
      // Duration stays at the final value after the call ends.
      expect(hook.result.current.durationSeconds).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mute/unmute delegate to the call and mirror isMuted', async () => {
    const { hook, call } = await startHook();
    act(() => hook.result.current.mute());
    expect(call.isMuted).toBe(true);
    expect(hook.result.current.isMuted).toBe(true);
    act(() => hook.result.current.unmute());
    expect(hook.result.current.isMuted).toBe(false);
  });

  it('collects tool confirmations and answers them', async () => {
    const { hook, call } = await startHook();

    act(() => call.emit('tool.confirmation_required', { id: 't1', name: 'refund' }));
    expect(hook.result.current.pendingConfirmations).toEqual([{ id: 't1', name: 'refund' }]);

    act(() => hook.result.current.confirmTool('t1', true));
    expect(call.confirmTool).toHaveBeenCalledWith('t1', true);
    expect(hook.result.current.pendingConfirmations).toEqual([]);

    act(() => {
      call.emit('tool_call', { id: 't2', name: 'lookup', status: 'running' });
      call.emit('tool_call', { id: 't2', name: 'lookup', status: 'success' });
    });
    expect(hook.result.current.toolCalls).toEqual([{ id: 't2', name: 'lookup', status: 'success', code: undefined }]);
  });

  it('surfaces a start failure as error and ended, without throwing', async () => {
    const { hook, call, started } = await startHook();

    await act(async () => {
      call.rejectStart('AI_PROVIDER_UNAVAILABLE');
      await started;
    });

    expect(hook.result.current.error?.code).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(hook.result.current.status).toBe('ended');
    expect(hook.result.current.endedReason).toBe('error');
  });

  it('reports a getToken failure without creating a call', async () => {
    const { hook } = await startHook(vi.fn(async () => {
      throw new Error('backend down');
    }));

    expect(FakeAgentCall.instances).toHaveLength(0);
    expect(hook.result.current.error?.code).toBe('AI_SESSION_CREATE_FAILED');
    expect(hook.result.current.status).toBe('ended');
  });

  it('keeps an error code from the customer backend', async () => {
    const { hook } = await startHook(vi.fn(async () => {
      throw Object.assign(new Error('no credits'), { code: 'AI_INSUFFICIENT_CREDITS' });
    }));
    expect(hook.result.current.error?.code).toBe('AI_INSUFFICIENT_CREDITS');
  });

  it('end() while the token is loading cancels the start', async () => {
    let resolveToken!: (t: string) => void;
    const getToken = vi.fn(() => new Promise<string>((r) => (resolveToken = r)));
    const hook = renderHook(() => usePurpleCallioAI({ getToken, apiUrl }));

    let started!: Promise<void>;
    act(() => {
      started = hook.result.current.start();
    });
    expect(hook.result.current.status).toBe('starting');
    act(() => hook.result.current.end());
    await act(async () => {
      resolveToken('bj_ai_late');
      await started;
    });

    expect(FakeAgentCall.instances).toHaveLength(0);
    expect(hook.result.current.status).toBe('ended');
  });

  it('ends the call on unmount', async () => {
    const { hook, call } = await startHook();
    hook.unmount();
    expect(call.endCalls).toBe(1);
  });

  it('ignores a second start() while one is running', async () => {
    const { hook, getToken } = await startHook();
    await act(async () => {
      await hook.result.current.start();
    });
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(FakeAgentCall.instances).toHaveLength(1);
  });
});

describe('<PurpleCallioAI />', () => {
  it('starts, shows status, mutes, ends, and applies className', async () => {
    const getToken = vi.fn(async () => 'bj_ai_token');
    const { container } = render(<PurpleCallioAI getToken={getToken} apiUrl={apiUrl} className="custom" />);
    expect(container.firstElementChild?.className).toBe('bj-ai custom');
    expect(screen.getByRole('status').textContent).toBe('Ready');

    await act(async () => {
      fireEvent.click(screen.getByText('Start call'));
      await Promise.resolve();
    });
    const call = lastCall();
    expect(call.config.apiUrl).toBe(apiUrl);

    await act(async () => call.resolveStart());
    expect(screen.getByRole('status').textContent).toBe('Listening');
    expect(screen.getByText('0:00')).toBeTruthy();

    act(() => call.emit('agentState', 'speaking'));
    expect(screen.getByRole('status').textContent).toBe('Agent speaking');
    expect(container.querySelector('.bj-ai-indicator')?.getAttribute('data-speaking')).toBe('true');

    act(() => {
      fireEvent.click(screen.getByText('Mute'));
    });
    expect(call.isMuted).toBe(true);
    expect(screen.getByText('Unmute')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByText('End'));
    });
    expect(call.endCalls).toBe(1);
    expect(screen.getByRole('status').textContent).toBe('Call ended');
    expect(screen.getByText('Start call')).toBeTruthy();
  });

  it('shows error text and the tool-confirmation prompt', async () => {
    render(<PurpleCallioAI getToken={async () => 'bj_ai_token'} apiUrl={apiUrl} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Start call'));
      await Promise.resolve();
    });
    const call = lastCall();
    await act(async () => call.resolveStart());

    act(() => call.emit('tool.confirmation_required', { id: 't1', name: 'refund' }));
    expect(screen.getByText('refund')).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByText('Deny'));
    });
    expect(call.confirmTool).toHaveBeenCalledWith('t1', false);
    expect(screen.queryByText('refund')).toBeNull();

    act(() => call.emit('error', Object.assign(new Error('x'), { code: 'AI_MAX_DURATION_REACHED' })));
    expect(screen.getByRole('alert').textContent).toBe('The call reached its maximum duration.');
  });
});
