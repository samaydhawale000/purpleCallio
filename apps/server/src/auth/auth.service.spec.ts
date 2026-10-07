import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AuthService } from './auth.service';
import { BillingService } from '../billing/billing.service';

/**
 * Minimal in-memory User store — same lightweight hand-rolled fake style as
 * the billing specs. `select` is ignored (full rows are returned), which is
 * fine because the service passes results through toUserProfile.
 */
function createFakePrisma(seed: any[] = []) {
  const users: any[] = seed.map((u) => ({ ...u }));
  let idCounter = 0;
  const find = (where: any) =>
    users.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) ??
    null;

  return {
    users,
    user: {
      findUnique: jest.fn(async ({ where }: any) => find(where)),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `user_${++idCounter}`,
          phone: null,
          companyName: null,
          jobTitle: null,
          country: null,
          companyWebsite: null,
          expectedUsageRange: null,
          primaryUseCase: null,
          profileCompleted: false,
          razorpayCustomerId: null,
          refreshTokenHash: null,
          passwordHash: null,
          ...data,
        };
        users.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = find(where);
        if (!row) throw new Error('Record not found');
        for (const [k, v] of Object.entries(data)) {
          if (v !== undefined) row[k] = v;
        }
        return row;
      }),
    },
  };
}

function createFakePayments(configured = true) {
  return {
    isConfigured: jest.fn(() => configured),
    customerExists: jest.fn(async () => true),
    updateCustomerContact: jest.fn(async () => undefined),
  };
}

const COMPLETE_PROFILE = {
  name: 'Samay Dhawale',
  phone: '+919876543210',
  companyName: 'Acme Inc',
  jobTitle: 'Engineering Lead',
  country: 'IN',
};

function setup(seed: any[] = [], googlePayload?: any) {
  process.env.JWT_ACCESS_SECRET = 'test-access';
  process.env.JWT_REFRESH_SECRET = 'test-refresh';

  const prisma = createFakePrisma(seed);
  const payments = createFakePayments();
  const billing = new BillingService(prisma as any, payments as any);
  const subscriptions = {
    getActiveSubscription: jest.fn(async () => undefined),
  };

  const service = new AuthService(
    prisma as any,
    new JwtService({}),
    billing,
    subscriptions as any,
  );
  (service as any).googleClient = {
    verifyIdToken: jest.fn(async () => ({
      getPayload: () =>
        googlePayload ?? {
          sub: 'google-1',
          email: 'samay@acme.com',
          name: 'Samay Dhawale',
          picture: 'https://example.com/a.png',
        },
    })),
  };
  return { service, prisma, payments, billing };
}

describe('AuthService.loginWithGoogle — onboarding state', () => {
  it('returns onboardingRequired=true for a brand-new user', async () => {
    const { service, prisma } = setup();

    const res = await service.loginWithGoogle('id-token');

    expect(res.onboardingRequired).toBe(true);
    expect(res.user.profileCompleted).toBe(false);
    expect(res.user.email).toBe('samay@acme.com');
    expect(res.user.name).toBe('Samay Dhawale');
    expect(res.accessToken).toEqual(expect.any(String));
    expect(res.refreshToken).toEqual(expect.any(String));
    expect(prisma.users).toHaveLength(1);
  });

  it('returns onboardingRequired=false for a user who completed their profile', async () => {
    const { service } = setup([
      {
        id: 'u1',
        googleId: 'google-1',
        email: 'samay@acme.com',
        ...COMPLETE_PROFILE,
        profileCompleted: true,
      },
    ]);

    const res = await service.loginWithGoogle('id-token');

    expect(res.onboardingRequired).toBe(false);
    expect(res.user.companyName).toBe('Acme Inc');
  });

  it('keeps an existing user with a phone but no company info in onboarding, with the phone returned for pre-fill', async () => {
    const { service } = setup([
      {
        id: 'u1',
        googleId: 'google-1',
        email: 'samay@acme.com',
        name: 'Samay',
        phone: '+919876543210',
        profileCompleted: false,
      },
    ]);

    const res = await service.loginWithGoogle('id-token');

    expect(res.onboardingRequired).toBe(true);
    expect(res.user.phone).toBe('+919876543210');
  });

  it('never returns secrets (refresh-token hash, password hash, card token) in the login user', async () => {
    const { service } = setup([
      {
        id: 'u1',
        googleId: 'google-1',
        email: 'samay@acme.com',
        passwordHash: 'pw-hash',
        razorpayTokenId: 'token_abc',
        razorpayCustomerId: 'cust_abc',
      },
    ]);

    const res = await service.loginWithGoogle('id-token');

    expect(res.user).not.toHaveProperty('refreshTokenHash');
    expect(res.user).not.toHaveProperty('passwordHash');
    expect(res.user).not.toHaveProperty('razorpayTokenId');
    expect(res.user).not.toHaveProperty('razorpayCustomerId');
  });

  it('rejects an invalid Google ID token', async () => {
    const { service } = setup();
    (service as any).googleClient.verifyIdToken = jest.fn(async () => {
      throw new Error('bad token');
    });

    await expect(service.loginWithGoogle('bad')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('AuthService.updateProfile', () => {
  const seedUser = (overrides: any = {}) => ({
    id: 'u1',
    googleId: 'google-1',
    email: 'samay@acme.com',
    name: 'Samay',
    phone: null,
    razorpayCustomerId: null,
    profileCompleted: false,
    ...overrides,
  });

  it('saves the profile, marks it completed, and reports onboarding done', async () => {
    const { service, prisma } = setup([seedUser()]);

    const res = await service.updateProfile('u1', {
      ...COMPLETE_PROFILE,
      name: '  Samay D  ',
      country: 'in',
      companyWebsite: 'acme.com',
      expectedUsageRange: 'FROM_1K_TO_10K',
      primaryUseCase: 'TELEHEALTH',
    } as any);

    expect(res.onboardingRequired).toBe(false);
    expect(res.user.profileCompleted).toBe(true);
    const row = prisma.users[0];
    expect(row).toMatchObject({
      name: 'Samay D',
      phone: '+919876543210',
      companyName: 'Acme Inc',
      jobTitle: 'Engineering Lead',
      country: 'IN',
      companyWebsite: 'https://acme.com',
      expectedUsageRange: 'FROM_1K_TO_10K',
      primaryUseCase: 'TELEHEALTH',
      profileCompleted: true,
    });
  });

  it('only updates the user identified by the JWT subject', async () => {
    const { service, prisma } = setup([
      seedUser(),
      seedUser({
        id: 'u2',
        googleId: 'google-2',
        email: 'other@acme.com',
        name: 'Other',
      }),
    ]);

    // Even if a client smuggles a userId into the body, the service only
    // ever uses the id it was given by the controller (the JWT subject).
    await service.updateProfile('u1', {
      ...COMPLETE_PROFILE,
      userId: 'u2',
    } as any);

    const other = prisma.users.find((u) => u.id === 'u2');
    expect(other.companyName).toBeUndefined();
    expect(other.profileCompleted).toBe(false);
    expect(prisma.users.find((u) => u.id === 'u1').profileCompleted).toBe(true);
    for (const call of prisma.user.update.mock.calls) {
      expect(call[0].where).toEqual({ id: 'u1' });
    }
  });

  it('syncs a new phone to the existing Razorpay customer via BillingService.setContactPhone', async () => {
    const { service, billing, payments } = setup([
      seedUser({ razorpayCustomerId: 'cust_123' }),
    ]);
    const setContactPhone = jest.spyOn(billing, 'setContactPhone');

    await service.updateProfile('u1', COMPLETE_PROFILE as any);

    expect(setContactPhone).toHaveBeenCalledWith('u1', '+919876543210');
    expect(payments.updateCustomerContact).toHaveBeenCalledWith(
      'cust_123',
      '+919876543210',
    );
  });

  it('does not re-sync Razorpay when the phone on file is unchanged', async () => {
    const { service, billing, payments } = setup([
      seedUser({ phone: '+919876543210', razorpayCustomerId: 'cust_123' }),
    ]);
    const setContactPhone = jest.spyOn(billing, 'setContactPhone');

    await service.updateProfile('u1', COMPLETE_PROFILE as any);

    expect(setContactPhone).not.toHaveBeenCalled();
    expect(payments.updateCustomerContact).not.toHaveBeenCalled();
  });

  it('leaves profileCompleted false when the phone is rejected', async () => {
    const { service, prisma } = setup([seedUser()]);

    await expect(
      service.updateProfile('u1', {
        ...COMPLETE_PROFILE,
        phone: '12345',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.users[0].profileCompleted).toBe(false);
    expect(prisma.users[0].phone).toBeNull();
  });

  it('keeps profileCompleted false when the Razorpay sync fails, so the user can retry', async () => {
    const { service, prisma, payments } = setup([
      seedUser({ razorpayCustomerId: 'cust_123' }),
    ]);
    payments.updateCustomerContact.mockRejectedValueOnce(
      new Error('razorpay down'),
    );

    await expect(
      service.updateProfile('u1', COMPLETE_PROFILE as any),
    ).rejects.toThrow('razorpay down');

    expect(prisma.users[0].profileCompleted).toBe(false);
  });

  it('rejects an unknown user', async () => {
    const { service } = setup();

    await expect(
      service.updateProfile('missing', COMPLETE_PROFILE as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
