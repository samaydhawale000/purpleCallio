import {
  BadRequestException,
  ConflictException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { PasswordAuthService } from './password-auth.service';
import { EmailOtpService } from './email-otp.service';

/**
 * In-memory User + EmailOtp store supporting the filters these services use
 * (equality, null, gt/lt, insensitive equals, increment).
 */
function createFakePrisma(seed: any[] = []) {
  const users: any[] = seed.map((u) => ({ phone: null, passwordHash: null, refreshTokenHash: null, ...u }));
  const otps: any[] = [];
  let ids = 0;

  const matches = (row: any, where: any = {}) =>
    Object.entries(where).every(([k, cond]: [string, any]) => {
      const v = row[k];
      if (cond === null) return v === null || v === undefined;
      if (cond instanceof Date) return v?.getTime() === cond.getTime();
      if (typeof cond === 'object') {
        if ('equals' in cond) return cond.mode === 'insensitive' ? String(v).toLowerCase() === String(cond.equals).toLowerCase() : v === cond.equals;
        if ('gt' in cond) return v > cond.gt;
        if ('lt' in cond) return v < cond.lt;
      }
      return v === cond;
    });
  const apply = (row: any, data: any) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'increment' in (v as any)) row[k] += (v as any).increment;
      else if (v !== undefined) row[k] = v;
    }
  };
  const newest = (rows: any[]) => [...rows].sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq);

  return {
    users,
    otps,
    user: {
      findFirst: jest.fn(async ({ where }: any) => users.find((u) => matches(u, where)) ?? null),
      findMany: jest.fn(async ({ where, take }: any) => users.filter((u) => matches(u, where)).slice(0, take)),
      count: jest.fn(async ({ where }: any) => users.filter((u) => matches(u, where)).length),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `user_${++ids}`, phone: null, refreshTokenHash: null, profileCompleted: false, ...data };
        users.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = users.find((u) => matches(u, where));
        apply(row, data);
        return row;
      }),
    },
    emailOtp: {
      findMany: jest.fn(async ({ where }: any) => newest(otps.filter((o) => matches(o, where)))),
      findFirst: jest.fn(async ({ where }: any) => newest(otps.filter((o) => matches(o, where)))[0] ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `otp_${++ids}`, seq: ids, attempts: 0, consumedAt: null, createdAt: new Date(), ...data };
        if (row.payload && typeof row.payload !== 'object') row.payload = null;
        otps.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = otps.filter((o) => matches(o, where));
        rows.forEach((r) => apply(r, data));
        return { count: rows.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = otps.length;
        for (let i = otps.length - 1; i >= 0; i--) if (matches(otps[i], where)) otps.splice(i, 1);
        return { count: before - otps.length };
      }),
    },
  };
}

function setup(seed: any[] = []) {
  const prisma = createFakePrisma(seed);
  const sent: { to: string; subject: string; text: string }[] = [];
  const mail = { send: jest.fn(async (m: any) => void sent.push(m)) };
  const auth = {
    issueSession: jest.fn(async (user: any) => ({
      user: { id: user.id, email: user.email },
      accessToken: 'access',
      refreshToken: 'refresh',
      onboardingRequired: !user.profileCompleted,
    })),
  };
  const signupCredits = { grant: jest.fn(async () => undefined) };
  const otp = new EmailOtpService(prisma as any);
  const service = new PasswordAuthService(prisma as any, auth as any, otp, mail as any, signupCredits as any);
  const lastCode = () => /\b(\d{6})\b/.exec(sent[sent.length - 1].text)![1];
  /** Lets the next code be issued without waiting for the resend cooldown. */
  const expireCooldown = () => prisma.otps.forEach((o) => (o.createdAt = new Date(o.createdAt.getTime() - 61_000)));
  return { prisma, sent, mail, auth, signupCredits, service, lastCode, expireCooldown };
}

const SIGNUP = { name: ' Asha Rao ', email: 'Asha@Example.com', password: 'secret123' };

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'test-secret';
});

describe('PasswordAuthService', () => {
  describe('sign-up', () => {
    it('emails a code and creates the account only after it is verified', async () => {
      const { service, prisma, sent, lastCode, auth, signupCredits } = setup();

      await expect(service.register(SIGNUP)).resolves.toMatchObject({ email: 'asha@example.com', resendInSeconds: 60 });
      expect(prisma.users).toHaveLength(0);
      expect(sent[0]).toMatchObject({ to: 'asha@example.com', subject: 'Your PurpleCallio verification code' });
      // Only a hash of the code is stored.
      expect(JSON.stringify(prisma.otps)).not.toContain(lastCode());
      expect(JSON.stringify(prisma.otps)).not.toContain('secret123');

      const session = await service.verifyRegistration('asha@example.com', lastCode());
      expect(session).toMatchObject({ accessToken: 'access', onboardingRequired: true });
      expect(prisma.users[0]).toMatchObject({ email: 'asha@example.com', name: 'Asha Rao' });
      expect(await bcrypt.compare('secret123', prisma.users[0].passwordHash)).toBe(true);
      expect(signupCredits.grant).toHaveBeenCalledWith(prisma.users[0].id);
      expect(auth.issueSession).toHaveBeenCalledTimes(1);

      // A code works once.
      await expect(service.verifyRegistration('asha@example.com', lastCode())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an email that already has an account (any case)', async () => {
      const { service, sent } = setup([{ id: 'u1', email: 'asha@example.com' }]);
      await expect(service.register(SIGNUP)).rejects.toBeInstanceOf(ConflictException);
      expect(sent).toHaveLength(0);
    });

    it('accepts any email domain', async () => {
      const { service } = setup();
      await expect(service.register({ ...SIGNUP, email: 'asha.rao@gmail.com' })).resolves.toMatchObject({ email: 'asha.rao@gmail.com' });
    });

    it('enforces the resend cooldown and lets a new code replace the old one', async () => {
      const { service, sent, expireCooldown } = setup();
      await service.register(SIGNUP);
      const first = /\b(\d{6})\b/.exec(sent[0].text)![1];

      const err = await service.register(SIGNUP).catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse().retryAfterSeconds).toBeGreaterThan(0);

      expireCooldown();
      await service.register(SIGNUP);
      const second = /\b(\d{6})\b/.exec(sent[1].text)![1];
      if (first !== second) {
        await expect(service.verifyRegistration(SIGNUP.email, first)).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(service.verifyRegistration(SIGNUP.email, second)).resolves.toMatchObject({ accessToken: 'access' });
    });

    it('locks a code after 5 wrong guesses', async () => {
      const { service, lastCode } = setup();
      await service.register(SIGNUP);
      const wrong = lastCode() === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await expect(service.verifyRegistration(SIGNUP.email, wrong)).rejects.toThrow(/incorrect or has expired/);
      }
      await expect(service.verifyRegistration(SIGNUP.email, lastCode())).rejects.toThrow(/Too many incorrect attempts/);
    });

    it('frees the cooldown when the email cannot be sent', async () => {
      const { service, mail, prisma } = setup();
      mail.send.mockRejectedValueOnce(new Error('resend down'));
      await expect(service.register(SIGNUP)).rejects.toThrow('resend down');
      expect(prisma.otps).toHaveLength(0);
      await expect(service.register(SIGNUP)).resolves.toBeDefined();
    });
  });

  describe('sign-in', () => {
    const hash = bcrypt.hashSync('secret123', 4);
    const seed = [
      { id: 'u1', email: 'asha@example.com', phone: '+919876543210', passwordHash: hash },
      { id: 'g1', email: 'google@example.com', passwordHash: null },
    ];

    it('accepts the email (any case) with the right password, not the mobile number', async () => {
      const { service, auth } = setup(seed);
      await expect(service.login(' ASHA@example.com ', 'secret123')).resolves.toMatchObject({ accessToken: 'access' });
      expect(auth.issueSession).toHaveBeenCalledTimes(1);
      await expect(service.login('+919876543210', 'secret123')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('gives the same error for a wrong password, an unknown account or a Google-only account', async () => {
      const { service } = setup(seed);
      for (const [id, pw] of [
        ['asha@example.com', 'wrong123'],
        ['nobody@example.com', 'secret123'],
        ['google@example.com', 'secret123'],
      ]) {
        await expect(service.login(id, pw)).rejects.toThrow(new UnauthorizedException('Incorrect email or password.'));
      }
    });
  });

  describe('password reset', () => {
    it('emails a code, sets the new password, signs out other sessions and signs in', async () => {
      const { service, prisma, sent, lastCode } = setup([
        { id: 'g1', email: 'asha@example.com', phone: '+919876543210', passwordHash: null, refreshTokenHash: 'old' },
      ]);
      // A Google-only account can set a password this way too.
      await expect(service.forgotPassword('Asha@Example.com')).resolves.toMatchObject({ sent: true });
      expect(sent[0]).toMatchObject({ to: 'asha@example.com', subject: 'Your PurpleCallio password reset code' });

      await expect(service.resetPassword('asha@example.com', lastCode(), 'newpass99')).resolves.toMatchObject({ accessToken: 'access' });
      expect(prisma.users[0].refreshTokenHash).toBeNull();
      expect(await bcrypt.compare('newpass99', prisma.users[0].passwordHash)).toBe(true);
      await expect(service.login('asha@example.com', 'newpass99')).resolves.toBeDefined();
    });

    it('answers the same for an unknown account, without sending email', async () => {
      const { service, sent } = setup();
      await expect(service.forgotPassword('nobody@example.com')).resolves.toMatchObject({ sent: true });
      expect(sent).toHaveLength(0);
      await expect(service.resetPassword('nobody@example.com', '123456', 'newpass99')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not reveal the account through cooldowns or mail failures', async () => {
      const { service, mail } = setup([{ id: 'u1', email: 'asha@example.com' }]);
      await service.forgotPassword('asha@example.com');
      await expect(service.forgotPassword('asha@example.com')).resolves.toMatchObject({ sent: true });
      mail.send.mockRejectedValueOnce(new Error('resend down'));
      await expect(service.forgotPassword('asha@example.com')).resolves.toMatchObject({ sent: true });
    });

    it('a sign-up code cannot reset a password', async () => {
      const { service, lastCode } = setup([{ id: 'u1', email: 'asha@example.com', passwordHash: null }]);
      await service.register({ ...SIGNUP, email: 'other@example.com' });
      await expect(service.resetPassword('asha@example.com', lastCode(), 'newpass99')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
