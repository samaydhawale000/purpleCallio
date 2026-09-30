import {
  GoneException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallSource, CallStatus } from '@prisma/client';
import { CallSessionGuard } from '../common/guards/call-session.guard';
import { TurnController } from './turn.controller';
import { TurnService } from './turn.service';

/**
 * GET /turn/credentials end to end at the unit level: the real
 * CallSessionGuard in front of the real controller and service, with the
 * session store and database mocked.
 */
describe('GET /turn/credentials', () => {
  const config = (values: Record<string, string | undefined>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigService;

  const prodConfig = config({
    TURN_SECRET: 'test-secret',
    TURN_HOST: 'calls.example.com',
  });

  function session(opts: {
    source?: CallSource;
    status?: CallStatus;
    tokenExpiresInMs?: number;
    callExpiresInMs?: number | null;
  }) {
    const now = Date.now();
    return {
      id: 'session-1',
      callId: 'call-1',
      callerToken: 'token-caller',
      receiverToken: 'token-receiver',
      expiresAt: new Date(now + (opts.tokenExpiresInMs ?? 60_000)),
      call: {
        id: 'call-1',
        source: opts.source ?? CallSource.CUSTOMER,
        status: opts.status ?? CallStatus.ACCEPTED,
        expiresAt:
          opts.callExpiresInMs === null
            ? null
            : new Date(now + (opts.callExpiresInMs ?? 60_000)),
      },
    };
  }

  /** Runs the guard, then (if it passes) the controller, like Nest does. */
  async function request(opts: {
    authorization?: string;
    found?: ReturnType<typeof session> | null;
    prisma?: unknown;
    turnConfig?: ConfigService;
  }) {
    const sessions = {
      getByToken: jest.fn().mockResolvedValue(opts.found ?? null),
    };
    const guard = new CallSessionGuard(sessions as any);
    const req: any = {
      headers:
        opts.authorization === undefined
          ? {}
          : { authorization: opts.authorization },
      params: {},
      ip: '203.0.113.7',
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as any;
    await guard.canActivate(context);
    const service = new TurnService(
      opts.turnConfig ?? prodConfig,
      (opts.prisma ?? {}) as any,
    );
    return new TurnController(service).getCredentials(req);
  }

  /** Prisma mock for the Playground TURN rate limiter. */
  function rateLimiter(alreadyIssuedThisMinute: number) {
    const tx = {
      $queryRaw: jest.fn(),
      playgroundAttempt: {
        count: jest.fn().mockResolvedValue(alreadyIssuedThisMinute),
        create: jest.fn(),
      },
    };
    return {
      tx,
      prisma: { $transaction: jest.fn((cb: any) => cb(tx)) },
    };
  }

  const turnUrls = (result: { iceServers: RTCIceServer[] }) =>
    result.iceServers.map((s) => String(s.urls));

  describe('authentication', () => {
    it('rejects anonymous requests (no bearer token)', async () => {
      await expect(request({})).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unknown participant token', async () => {
      await expect(
        request({ authorization: 'Bearer nope', found: null }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired participant token', async () => {
      await expect(
        request({
          authorization: 'Bearer token-caller',
          found: session({ tokenExpiresInMs: -1_000 }),
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('call state', () => {
    it.each([
      CallStatus.ENDED,
      CallStatus.MISSED,
      CallStatus.REJECTED,
      CallStatus.CANCELLED,
      CallStatus.BUSY,
    ])('rejects a customer call that is %s', async (status) => {
      await expect(
        request({
          authorization: 'Bearer token-caller',
          found: session({ status }),
        }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('rejects an expired Playground call even with a valid token', async () => {
      await expect(
        request({
          authorization: 'Bearer token-caller',
          found: session({
            source: CallSource.PLAYGROUND,
            status: CallStatus.ACCEPTED,
            callExpiresInMs: -1_000,
          }),
        }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('rejects a terminal Playground call', async () => {
      await expect(
        request({
          authorization: 'Bearer token-caller',
          found: session({
            source: CallSource.PLAYGROUND,
            status: CallStatus.ENDED,
          }),
        }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('rejects Playground calls while the kill switch is off', async () => {
      process.env.PLAYGROUND_ENABLED = 'false';
      try {
        await expect(
          request({
            authorization: 'Bearer token-caller',
            found: session({ source: CallSource.PLAYGROUND }),
          }),
        ).rejects.toBeInstanceOf(GoneException);
      } finally {
        delete process.env.PLAYGROUND_ENABLED;
      }
    });
  });

  describe('Playground limits', () => {
    it('rate-limits repeated credential requests (429) and records nothing', async () => {
      const { tx, prisma } = rateLimiter(3);
      const error = await request({
        authorization: 'Bearer token-caller',
        found: session({ source: CallSource.PLAYGROUND }),
        prisma,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(tx.playgroundAttempt.create).not.toHaveBeenCalled();
    });

    it('issues credentials that expire no later than the demo window', async () => {
      const { tx, prisma } = rateLimiter(0);
      const found = session({
        source: CallSource.PLAYGROUND,
        callExpiresInMs: 20_000,
      });
      const result = await request({
        authorization: 'Bearer token-caller',
        found,
        prisma,
      });
      const turn = result.iceServers.find((s) =>
        String(s.urls).startsWith('turn:'),
      )!;
      const expires = Number(turn.username!.split(':')[0]);
      expect(expires).toBeLessThanOrEqual(
        Math.floor(found.call.expiresAt!.getTime() / 1000),
      );
      expect(tx.playgroundAttempt.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('customer calls', () => {
    it('are never subject to Playground TURN limits', async () => {
      // Even if the Playground limiter would refuse, a customer call must not
      // touch it at all.
      const { prisma } = rateLimiter(999);
      const result = await request({
        authorization: 'Bearer token-caller',
        found: session({ source: CallSource.CUSTOMER }),
        prisma,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(turnUrls(result)).toContain('turn:calls.example.com:3478');
    });

    it('keep a TTL long enough for long calls (default 24h)', async () => {
      const result = await request({
        authorization: 'Bearer token-caller',
        found: session({}),
      });
      const turn = result.iceServers.find((s) =>
        String(s.urls).startsWith('turn:'),
      )!;
      const ttl =
        Number(turn.username!.split(':')[0]) - Math.floor(Date.now() / 1000);
      expect(ttl).toBeGreaterThan(86_000);
      expect(ttl).toBeLessThanOrEqual(86_400);
    });
  });
});

describe('TURN hostname configuration', () => {
  const service = (values: Record<string, string | undefined>) =>
    new TurnService(
      { get: (key: string) => values[key] } as unknown as ConfigService,
      {} as any,
    );
  const urls = (s: TurnService) =>
    s.getCredentials().iceServers.map((e) => String(e.urls));

  it('advertises turn: and turns: on the TLS certificate hostname', () => {
    expect(
      urls(
        service({
          TURN_SECRET: 's',
          TURN_HOST: 'calls.example.com',
        }),
      ),
    ).toEqual([
      'stun:stun.l.google.com:19302',
      'turn:calls.example.com:3478',
      'turns:calls.example.com:5349',
    ]);
  });

  it('prefers TURN_HOST over the legacy TURN_SERVER', () => {
    expect(
      urls(
        service({
          TURN_SECRET: 's',
          TURN_HOST: 'turn.example.test',
          TURN_SERVER: '198.51.100.10',
        }),
      ),
    ).toContain('turns:turn.example.test:5349');
  });

  it('never advertises turns: for an IP literal (the certificate is for a hostname)', () => {
    const list = urls(
      service({ TURN_SECRET: 's', TURN_SERVER: '130.210.24.136' }),
    );
    expect(list).toContain('turn:130.210.24.136:3478');
    expect(list.some((u) => u.startsWith('turns:'))).toBe(false);
    expect(
      urls(service({ TURN_SECRET: 's', TURN_HOST: '2001:db8::1' })).some((u) =>
        u.startsWith('turns:'),
      ),
    ).toBe(false);
  });

  it('only offers public STUN when no TURN secret is configured', () => {
    expect(urls(service({ TURN_HOST: 'calls.example.com' }))).toEqual([
      'stun:stun.l.google.com:19302',
    ]);
  });

  it('never returns the TURN shared secret', () => {
    const creds = service({
      TURN_SECRET: 'super-secret-value',
      TURN_HOST: 'calls.example.com',
    }).getCredentials();
    expect(JSON.stringify(creds)).not.toContain('super-secret-value');
  });
});
