import { CallService } from './call.service';

const LEX = '0b6c6a0e-3f0e-4a59-9a8e-0d1f2e3a4b5c';

function setup(opts: { access?: { ok: boolean; code?: string }; lexicon?: unknown; call?: Record<string, unknown> } = {}) {
  const prisma: any = {
    call: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'c1', ...data })),
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        projectId: 'p1',
        status: 'ACCEPTED',
        translationMode: 'OFF',
        project: { ownerId: 'u1' },
        ...opts.call,
      }),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ translationMode: 'OFF', callerLanguage: null, receiverLanguage: null, ...data }),
      ),
    },
    project: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'u1' }) },
    callEvent: { create: jest.fn().mockResolvedValue({}) },
    translationLexicon: { findFirst: jest.fn().mockResolvedValue(opts.lexicon ?? null) },
  };
  const sessions = {
    createSession: jest.fn(),
    getByCallId: jest.fn().mockResolvedValue({ callerToken: 'a', receiverToken: 'b', expiresAt: null }),
  };
  const access = { canStart: jest.fn().mockResolvedValue(opts.access ?? { ok: true, trial: false }) };
  const relay = { applyCallUpdate: jest.fn().mockResolvedValue(true), endForCall: jest.fn().mockResolvedValue(undefined) };
  const service = new CallService(
    prisma,
    sessions as never,
    {} as never,
    { fireForCall: jest.fn() } as never,
    { canStartCall: jest.fn().mockResolvedValue({ allowed: true }) } as never,
    {} as never,
    {} as never,
    {} as never,
    access as never,
    relay as never,
  );
  return { service, prisma, access, relay };
}

const base = { projectId: 'p1', callerId: 'a', receiverId: 'b', type: 'AUDIO' as const };

describe('CallService Live Translate', () => {
  const env = process.env.TRANSLATION_ENABLED;
  beforeEach(() => (process.env.TRANSLATION_ENABLED = 'true'));
  afterAll(() => (process.env.TRANSLATION_ENABLED = env));

  it('persists languages + translation and returns them', async () => {
    const t = setup({ lexicon: { id: LEX } });
    const out = await t.service.createCall({
      ...base,
      callerLanguage: 'en',
      receiverLanguage: 'mr',
      translation: { mode: 'voice', lexiconId: LEX, maxMinutes: 30 },
    });
    const data = t.prisma.call.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      callerLanguage: 'en',
      receiverLanguage: 'mr',
      translationMode: 'VOICE',
      translationConfig: { lexiconId: LEX, maxMinutes: 30 },
    });
    expect(t.access.canStart).toHaveBeenCalledWith('u1', 'voice');
    expect(out.participants.map((p) => p.language)).toEqual(['en', 'mr']);
    expect(out.translation).toEqual({ mode: 'voice', config: { lexiconId: LEX, maxMinutes: 30 } });
  });

  it('never refuses a call because of translation when mode is off', async () => {
    const t = setup({ access: { ok: false, code: 'TRANSLATION_NOT_IN_PLAN' } });
    process.env.TRANSLATION_ENABLED = 'false';
    const out = await t.service.createCall({ ...base, callerLanguage: 'hi' });
    expect(t.access.canStart).not.toHaveBeenCalled();
    expect(out.translation.mode).toBe('off');
  });

  it.each([
    [{ callerLanguage: 'english' }, 'TRANSLATION_INVALID_LANGUAGE'],
    [{ translation: { mode: 'voice' }, receiverLanguage: 'zz' }, 'TRANSLATION_INVALID_LANGUAGE'],
    [{ translation: { mode: 'loud' } }, 'TRANSLATION_INVALID_CONFIG'],
    [{ translation: { lexiconId: LEX } }, 'TRANSLATION_LEXICON_NOT_FOUND'],
  ])('rejects %j with %s before writing', async (extra, code) => {
    const t = setup();
    await expect(t.service.createCall({ ...base, ...(extra as object) })).rejects.toMatchObject({ status: 400, response: { code } });
    expect(t.prisma.call.create).not.toHaveBeenCalled();
  });

  it('403 TRANSLATION_NOT_IN_PLAN / 402 TRANSLATION_INSUFFICIENT_CREDITS', async () => {
    await expect(
      setup({ access: { ok: false, code: 'TRANSLATION_NOT_IN_PLAN' } }).service.createCall({ ...base, translation: { mode: 'captions' } }),
    ).rejects.toMatchObject({ status: 403, response: { code: 'TRANSLATION_NOT_IN_PLAN' } });
    await expect(
      setup({ access: { ok: false, code: 'TRANSLATION_INSUFFICIENT_CREDITS' } }).service.createCall({ ...base, translation: { mode: 'voice' } }),
    ).rejects.toMatchObject({ status: 402, response: { code: 'TRANSLATION_INSUFFICIENT_CREDITS' } });
  });

  it('403 TRANSLATION_DISABLED when the server flag is off', async () => {
    process.env.TRANSLATION_ENABLED = 'false';
    await expect(setup().service.createCall({ ...base, translation: { mode: 'voice' } })).rejects.toMatchObject({
      response: { code: 'TRANSLATION_DISABLED' },
    });
  });

  it('PATCH updates the call and the live relay', async () => {
    const t = setup();
    const out = await t.service.updateTranslation('c1', { projectId: 'p1' }, { mode: 'captions', receiverLanguage: 'ta' });
    expect(out).toEqual({ mode: 'captions', callerLanguage: null, receiverLanguage: 'ta' });
    expect(t.access.canStart).toHaveBeenCalledWith('u1', 'captions');
    expect(t.relay.applyCallUpdate).toHaveBeenCalledWith('c1', { mode: 'captions', receiverLanguage: 'ta' });
  });

  it('PATCH 404s for another project and 410s for an ended call', async () => {
    await expect(setup().service.updateTranslation('c1', { projectId: 'p2' }, {})).rejects.toMatchObject({ status: 404 });
    await expect(setup({ call: { status: 'ENDED' } }).service.updateTranslation('c1', { sessionCallId: 'c1' }, {})).rejects.toMatchObject({
      status: 410,
      response: { code: 'TRANSLATION_CALL_ENDED' },
    });
  });
});
