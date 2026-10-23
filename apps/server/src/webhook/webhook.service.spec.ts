import { WebhookService } from './webhook.service';

function setup(webhookUrl: string | null = 'https://example.test/hook') {
  const prisma: any = {
    call: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        projectId: 'p1',
        callerId: 'a',
        receiverId: 'b',
        type: 'AUDIO',
        status: 'ACCEPTED',
        project: { ownerId: 'u1', webhookUrl, webhookSecret: 's' },
      }),
    },
    project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', ownerId: 'u1', webhookUrl, webhookSecret: null }) },
    webhookDelivery: {
      create: jest.fn().mockResolvedValue({ id: 'd1' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const entitlements = { hasFeature: jest.fn().mockResolvedValue(true) };
  return { prisma, entitlements, service: new WebhookService(prisma, entitlements as never) };
}

describe('WebhookService', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as never;
  });
  afterAll(() => (global.fetch = realFetch));

  it('includes `data` for translation events', async () => {
    const t = setup();
    await t.service.fireForCall('c1', 'call.translation.started', { mode: 'voice', callerLanguage: 'en', receiverLanguage: 'hi' });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ event: 'call.translation.started', callId: 'c1', data: { mode: 'voice' } });
    expect(init.headers['X-PurpleCallio-Signature']).toMatch(/^sha256=/);
  });

  it('omits `data` for lifecycle events (unchanged payload)', async () => {
    const t = setup();
    await t.service.fireForCall('c1', 'call.ended');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('data');
  });

  it('fires project-level events with callId null', async () => {
    const t = setup();
    await t.service.fireForProject('p1', 'translation.budget.threshold', { period: 'day', threshold: 80 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ event: 'translation.budget.threshold', callId: null, projectId: 'p1', data: { threshold: 80 } });
    expect(t.prisma.webhookDelivery.create.mock.calls[0][0].data.callId).toBe('project:p1');
  });

  it('skips without a URL or the WEBHOOKS entitlement', async () => {
    await setup(null).service.fireForCall('c1', 'call.translation.ended');
    const t = setup();
    t.entitlements.hasFeature.mockResolvedValue(false);
    await t.service.fireForProject('p1', 'translation.budget.threshold');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
