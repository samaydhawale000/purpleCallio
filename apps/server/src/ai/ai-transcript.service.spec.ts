import { Logger } from '@nestjs/common';

import { AiTranscriptService, redactTranscript } from './ai-transcript.service';

const NOW = new Date('2026-10-17T04:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

describe('redactTranscript', () => {
  it.each([
    ['4111111111111111', '[redacted number]'],
    ['card 4111 1111 1111 1111 thanks', 'card [redacted number] thanks'],
    ['5500-0000-0000-0004', '[redacted number]'],
    ['amex 3782 822463 10005', 'amex [redacted number]'],
    ['19 digits 6011000990139424123', '19 digits [redacted number]'],
  ])('redacts card-like numbers: %s', (input, expected) => {
    expect(redactTranscript(input)).toBe(expected);
  });

  it.each([
    ['order 123456789012', 'order 123456789012'], // 12 digits
    ['call +1 555 123 4567', 'call +1 555 123 4567'],
    ['total 1,299.00', 'total 1,299.00'],
    ['20 digits 12345678901234567890', '20 digits 12345678901234567890'],
  ])('keeps shorter or longer numbers: %s', (input, expected) => {
    expect(redactTranscript(input)).toBe(expected);
  });

  it.each([
    ['key bj_live_abc123DEF456', 'key [redacted key]'],
    ['token bj_ai_0f9e8d7c6b5a', 'token [redacted key]'],
    ['use sk-proj-AbCdEf123456789', 'use [redacted key]'],
    ['sk-ant-api03-xyzXYZ0123', '[redacted key]'],
  ])('redacts keys: %s', (input, expected) => {
    expect(redactTranscript(input)).toBe(expected);
  });

  it('leaves words that merely contain the prefixes alone', () => {
    expect(redactTranscript('a task-list and a desk-lamp')).toBe(
      'a task-list and a desk-lamp',
    );
  });

  it('redacts email addresses', () => {
    expect(redactTranscript('mail Jane.Doe+vip@mail.example.co.uk now')).toBe(
      'mail [redacted email] now',
    );
  });

  it('redacts several kinds in one segment', () => {
    expect(
      redactTranscript('sam@acme.io paid with 4242424242424242 via bj_live_secretkey1'),
    ).toBe('[redacted email] paid with [redacted number] via [redacted key]');
  });
});

/** Fake with the relation filter the purge uses (session → agent retention). */
function createFakePrisma() {
  const agents = [
    { id: 'agent_7', storeTranscript: true, transcriptRetentionDays: 7 },
    { id: 'agent_30', storeTranscript: true, transcriptRetentionDays: 30 },
    // Toggle turned off after storing: kept until the 90-day fallback.
    { id: 'agent_off', storeTranscript: false, transcriptRetentionDays: null },
  ];
  const sessions = [
    { id: 's7', agentId: 'agent_7' },
    { id: 's30', agentId: 'agent_30' },
    { id: 'soff', agentId: 'agent_off' },
  ];
  let messages: any[] = [];

  const matchesMessage = (m: any, where: any) => {
    if (where.createdAt?.lt && !(m.createdAt < where.createdAt.lt)) return false;
    const days = where.session?.agent?.transcriptRetentionDays;
    if (days !== undefined) {
      const session = sessions.find((s) => s.id === m.sessionId);
      const agent = agents.find((a) => a.id === session?.agentId);
      if (agent?.transcriptRetentionDays !== days) return false;
    }
    return true;
  };

  const store: any = {
    aiAgent: {
      findUnique: jest.fn(async ({ where }: any) =>
        agents.find((a) => a.id === where.id) ?? null,
      ),
    },
    aiConversationMessage: {
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = messages.length;
        messages = messages.filter((m) => !matchesMessage(m, where));
        return { count: before - messages.length };
      }),
    },
  };
  return {
    store,
    seed: (sessionId: string, createdAt: Date) =>
      messages.push({ id: `${sessionId}@${createdAt.toISOString()}`, sessionId, createdAt }),
    remaining: () => messages.map((m) => m.id).sort(),
  };
}

describe('AiTranscriptService', () => {
  beforeAll(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  it('opens no writer when the agent does not store transcripts', async () => {
    const fake = createFakePrisma();
    const service = new AiTranscriptService(fake.store);
    expect(await service.openWriter('s', 'agent_off')).toBeNull();
    expect(await service.openWriter('s', 'missing')).toBeNull();
    expect(await service.openWriter('s', 'agent_7')).not.toBeNull();
  });

  it('purges messages older than each agent’s retention', async () => {
    const fake = createFakePrisma();
    fake.seed('s7', daysAgo(6));
    fake.seed('s7', daysAgo(8));
    fake.seed('s30', daysAgo(8));
    fake.seed('s30', daysAgo(31));
    fake.seed('soff', daysAgo(31));
    fake.seed('soff', daysAgo(91));

    const result = await new AiTranscriptService(fake.store).purgeExpired(NOW);

    expect(result).toEqual({ deleted: 3 });
    expect(fake.remaining()).toEqual(
      [
        `s7@${daysAgo(6).toISOString()}`,
        `s30@${daysAgo(8).toISOString()}`,
        `soff@${daysAgo(31).toISOString()}`,
      ].sort(),
    );
  });

  it('is idempotent and never throws', async () => {
    const fake = createFakePrisma();
    fake.seed('s7', daysAgo(8));
    const service = new AiTranscriptService(fake.store);
    await service.purgeExpired(NOW);
    expect(await service.purgeExpired(NOW)).toEqual({ deleted: 0 });

    fake.store.aiConversationMessage.deleteMany.mockRejectedValueOnce(new Error('db'));
    expect(await service.purgeExpired(NOW)).toEqual({ deleted: 0 });
  });
});
