import { ExecutionContext } from '@nestjs/common';

import { OptionalJwtGuard } from './optional-jwt.guard';
import { ApiKeyOrCallSessionGuard } from './api-key-or-session.guard';
import { BillingTabGuard } from './billing-tab.guard';
import { TranslationController, termsOf } from './translation.controller';
import { TranslationDashboardController } from './translation-dashboard.controller';
import { TranslationAdminController } from './translation-admin.controller';

const ctx = (request: Record<string, unknown>) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('OptionalJwtGuard', () => {
  beforeAll(() => (process.env.JWT_ACCESS_SECRET = 'secret'));

  it('sets req.user for a valid token and never rejects', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1' }) };
    const req: any = { headers: { authorization: 'Bearer t' } };
    expect(await new OptionalJwtGuard(jwt as never).canActivate(ctx(req))).toBe(true);
    expect(req.user).toEqual({ userId: 'u1' });

    jwt.verifyAsync.mockRejectedValue(new Error('expired'));
    const anon: any = { headers: { authorization: 'Bearer bad' } };
    expect(await new OptionalJwtGuard(jwt as never).canActivate(ctx(anon))).toBe(true);
    expect(anon.user).toBeUndefined();
    expect(await new OptionalJwtGuard(jwt as never).canActivate(ctx({ headers: {} }))).toBe(true);
  });
});

describe('ApiKeyOrCallSessionGuard', () => {
  it('uses the API key when x-api-key is sent', async () => {
    const prisma = { apiKey: { findFirst: jest.fn().mockResolvedValue({ project: { id: 'p1' } }) } };
    const sessions = { getByToken: jest.fn() };
    const req: any = { headers: { 'x-api-key': 'k' } };
    await new ApiKeyOrCallSessionGuard(prisma as never, sessions as never).canActivate(ctx(req));
    expect(req.project).toEqual({ id: 'p1' });
    expect(sessions.getByToken).not.toHaveBeenCalled();
  });

  it('falls back to the call session token', async () => {
    const prisma = { apiKey: { findFirst: jest.fn() } };
    const session = {
      callId: 'c1',
      callerToken: 'tok',
      receiverToken: 'r',
      expiresAt: new Date(Date.now() + 60_000),
      call: { source: 'CUSTOMER', status: 'ACCEPTED' },
    };
    const sessions = { getByToken: jest.fn().mockResolvedValue(session) };
    const req: any = { headers: { authorization: 'Bearer tok' }, params: { id: 'c1' } };
    await new ApiKeyOrCallSessionGuard(prisma as never, sessions as never).canActivate(ctx(req));
    expect(req.callSession).toMatchObject({ callId: 'c1', role: 'CALLER' });
    expect(prisma.apiKey.findFirst).not.toHaveBeenCalled();
  });

  it('rejects without credentials', async () => {
    await expect(
      new ApiKeyOrCallSessionGuard({} as never, {} as never).canActivate(ctx({ headers: {} })),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('BillingTabGuard', () => {
  const guard = (perms: unknown) =>
    new BillingTabGuard({ user: { findUnique: jest.fn().mockResolvedValue({ adminPermissions: perms }) } } as never);

  it('applies the Billing tab permission', async () => {
    await expect(guard(null).canActivate(ctx({ user: { userId: 'a' }, method: 'PUT' }))).resolves.toBe(true);
    await expect(guard({ billing: 'READ' }).canActivate(ctx({ user: { userId: 'a' }, method: 'GET' }))).resolves.toBe(true);
    await expect(guard({ billing: 'READ' }).canActivate(ctx({ user: { userId: 'a' }, method: 'PUT' }))).rejects.toMatchObject({ status: 403 });
    await expect(guard({ support: 'WRITE' }).canActivate(ctx({ user: { userId: 'a' }, method: 'GET' }))).rejects.toMatchObject({ status: 403 });
  });
});

describe('TranslationController', () => {
  const services = () => ({
    settings: { getPublic: jest.fn(), update: jest.fn() },
    lexicons: { upsertTerms: jest.fn(), importCsv: jest.fn(), packs: jest.fn().mockReturnValue([]) },
    metrics: { metrics: jest.fn() },
    estimates: { estimate: jest.fn() },
  });

  it('serves the public language list', () => {
    const s = services();
    const c = new TranslationController(s.settings as never, s.lexicons as never, s.metrics as never, s.estimates as never);
    const out = c.languages();
    expect(out.pairs).toMatch(/all-to-all/);
    expect(out.languages.length).toBeGreaterThan(0);
    expect(out.languages[0]).toEqual(expect.objectContaining({ code: expect.any(String), voice: expect.any(Boolean), routes: expect.any(Array) }));
  });

  it('scopes everything to the API key project', async () => {
    const s = services();
    const c = new TranslationController(s.settings as never, s.lexicons as never, s.metrics as never, s.estimates as never);
    const req = { project: { id: 'p1' } };
    await c.putTerms(req, 'l1', [{ term: 'A' }]);
    expect(s.lexicons.upsertTerms).toHaveBeenCalledWith('p1', 'l1', [{ term: 'A' }]);
    await c.metrics(req, { pair: 'hi-en' });
    expect(s.metrics.metrics).toHaveBeenCalledWith('p1', { pair: 'hi-en' });
    await c.estimate({ user: { userId: 'u1' } }, { mode: 'voice' });
    expect(s.estimates.estimate).toHaveBeenCalledWith({ mode: 'voice' }, 'u1');
    await c.estimate({}, {});
    expect(s.estimates.estimate).toHaveBeenLastCalledWith({}, null);
  });

  it('termsOf accepts a plain array or { terms }', () => {
    expect(termsOf([1])).toEqual([1]);
    expect(termsOf({ terms: [2] })).toEqual([2]);
  });
});

describe('TranslationDashboardController', () => {
  it('checks project ownership before delegating', async () => {
    const settings = { assertOwner: jest.fn().mockRejectedValue(Object.assign(new Error('no'), { status: 403 })), getPublic: jest.fn() };
    const c = new TranslationDashboardController({} as never, settings as never, {} as never, {} as never, {} as never);
    await expect(c.getSettings({ user: { userId: 'u2' } }, 'p1')).rejects.toMatchObject({ status: 403 });
    expect(settings.getPublic).not.toHaveBeenCalled();
  });

  it('serves a report only to the call owner', async () => {
    const prisma = { call: { findUnique: jest.fn().mockResolvedValue({ projectId: 'p1', project: { ownerId: 'u1' } }) } };
    const reports = { getReport: jest.fn().mockResolvedValue({ status: 'ready' }) };
    const c = new TranslationDashboardController(prisma as never, {} as never, {} as never, {} as never, reports as never);
    await expect(c.report({ user: { userId: 'u1' } }, 'c1')).resolves.toEqual({ status: 'ready' });
    expect(reports.getReport).toHaveBeenCalledWith('c1', 'p1');
    await expect(c.report({ user: { userId: 'u2' } }, 'c1')).rejects.toMatchObject({ response: { code: 'TRANSLATION_FORBIDDEN' } });
    prisma.call.findUnique.mockResolvedValue(null);
    await expect(c.report({ user: { userId: 'u1' } }, 'c1')).rejects.toMatchObject({ response: { code: 'TRANSLATION_REPORT_NOT_FOUND' } });
  });
});

describe('TranslationAdminController', () => {
  it('parses the margin range and passes the actor', async () => {
    const admin = { margin: jest.fn(), putOverride: jest.fn() };
    const c = new TranslationAdminController(admin as never);
    await c.margin('2026-10-01', '2026-10-31');
    const [from, to] = admin.margin.mock.calls[0];
    expect(from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    await c.put({ user: { userId: 'admin' } }, 'u1', { voiceCreditsPerMinute: 1 });
    expect(admin.putOverride).toHaveBeenCalledWith('u1', { voiceCreditsPerMinute: 1 }, 'admin');
  });
});
