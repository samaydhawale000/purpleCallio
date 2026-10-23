import { afterEach, describe, expect, it, vi } from 'vitest';

import { PurpleCallioClient } from '../src/client';

const client = () => new PurpleCallioClient({ apiKey: 'bj_live_k', apiUrl: 'https://host.example/' });

const respond = (status: number, body: unknown) =>
  vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));

describe('PurpleCallioClient.ai', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('createSession posts the agent, participant and metadata with the API key', async () => {
    const result = { sessionId: 's1', callId: 'c1', token: 'bj_ai_x', expiresAt: 'later', connectUrl: 'https://host.example/ai' };
    const fetchMock = respond(201, result);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      client().ai.createSession({ agentId: 'a1', participant: { id: 'u1', name: 'Ann' }, metadata: { orderId: 7 } }),
    ).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://host.example/ai/sessions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('bj_live_k');
    expect(JSON.parse(init.body as string)).toEqual({
      agentId: 'a1',
      participant: { id: 'u1', name: 'Ann' },
      metadata: { orderId: 7 },
    });
  });

  it('getSession and endSession hit the session routes', async () => {
    const fetchMock = respond(200, { sessionId: 's/1' });
    vi.stubGlobal('fetch', fetchMock);

    await client().ai.getSession('s/1');
    await client().ai.endSession('s/1');

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'GET https://host.example/ai/sessions/s%2F1',
      'POST https://host.example/ai/sessions/s%2F1/end',
    ]);
  });

  it('errors carry the server code', async () => {
    vi.stubGlobal('fetch', respond(402, { code: 'AI_PAID_PLAN_REQUIRED', message: 'Upgrade to a paid plan' }));

    await expect(
      client().ai.createSession({ agentId: 'a1', participant: { id: 'u1' } }),
    ).rejects.toMatchObject({ code: 'AI_PAID_PLAN_REQUIRED', status: 402, message: 'Upgrade to a paid plan' });
  });
});
