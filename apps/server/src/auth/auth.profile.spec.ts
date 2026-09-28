import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * HTTP-level tests for PATCH /auth/profile: real JwtGuard/JwtStrategy and
 * the same global ValidationPipe config as main.ts, with AuthService mocked
 * so only the auth + validation boundary is under test.
 */
describe('PATCH /auth/profile', () => {
  let app: INestApplication;
  let authService: { updateProfile: jest.Mock };
  let token: string;

  const valid = {
    name: 'Samay Dhawale',
    phone: '+919876543210',
    companyName: 'Acme Inc',
    jobTitle: 'Engineering Lead',
    country: 'IN',
  };

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access';
    authService = {
      updateProfile: jest.fn(async (userId: string) => ({
        user: { id: userId, profileCompleted: true },
        onboardingRequired: false,
      })),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [JwtStrategy, { provide: AuthService, useValue: authService }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    token = await new JwtService({}).signAsync(
      { sub: 'user-1' },
      { secret: 'test-access', expiresIn: '15m' },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => authService.updateProfile.mockClear());

  const patch = (body: any, auth = true) => {
    const req = request(app.getHttpServer()).patch('/auth/profile');
    if (auth) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };

  it('requires authentication', async () => {
    await patch(valid, false).expect(401);
    expect(authService.updateProfile).not.toHaveBeenCalled();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = await new JwtService({}).signAsync(
      { sub: 'user-1' },
      { secret: 'not-the-secret' },
    );
    await request(app.getHttpServer())
      .patch('/auth/profile')
      .set('Authorization', `Bearer ${forged}`)
      .send(valid)
      .expect(401);
  });

  it('accepts a valid profile and updates the JWT subject', async () => {
    const res = await patch({
      ...valid,
      companyWebsite: 'https://acme.com',
      expectedUsageRange: 'OVER_100K',
      primaryUseCase: 'CUSTOMER_SUPPORT',
    }).expect(200);

    expect(res.body.onboardingRequired).toBe(false);
    expect(authService.updateProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ companyName: 'Acme Inc' }),
    );
  });

  it('ignores a userId in the body — the user always comes from the JWT', async () => {
    await patch({
      ...valid,
      userId: 'someone-else',
      id: 'someone-else',
    }).expect(200);

    const [userId, body] = authService.updateProfile.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(body).not.toHaveProperty('userId');
    expect(body).not.toHaveProperty('id');
  });

  it('strips non-profile fields such as profileCompleted or role', async () => {
    await patch({ ...valid, profileCompleted: true, role: 'ADMIN' }).expect(
      200,
    );

    const [, body] = authService.updateProfile.mock.calls[0];
    expect(body).not.toHaveProperty('profileCompleted');
    expect(body).not.toHaveProperty('role');
  });

  it.each(['name', 'phone', 'companyName', 'jobTitle', 'country'])(
    'requires %s',
    async (field) => {
      const body: any = { ...valid };
      delete body[field];
      await patch(body).expect(400);
      expect(authService.updateProfile).not.toHaveBeenCalled();
    },
  );

  it.each(['name', 'companyName', 'jobTitle'])(
    'rejects a whitespace-only %s',
    async (field) => {
      await patch({ ...valid, [field]: '   ' }).expect(400);
    },
  );

  it('rejects over-long text fields', async () => {
    await patch({ ...valid, companyName: 'x'.repeat(151) }).expect(400);
    await patch({ ...valid, name: 'x'.repeat(101) }).expect(400);
  });

  it.each([
    '9876543210',
    '+0123456789',
    '+91 98765 43210',
    '+91-98765',
    'phone',
    '+1234567',
  ])('rejects invalid phone %p', async (phone) => {
    await patch({ ...valid, phone }).expect(400);
  });

  it.each(['India', 'XX', 'IND', ''])(
    'rejects invalid country %p',
    async (country) => {
      await patch({ ...valid, country }).expect(400);
    },
  );

  it('rejects an unsupported usage range', async () => {
    await patch({ ...valid, expectedUsageRange: 'A_LOT' }).expect(400);
  });

  it('rejects an unsupported use case', async () => {
    await patch({ ...valid, primaryUseCase: 'GAMING' }).expect(400);
  });

  it.each([
    'not a url',
    'javascript:alert(1)',
    'ftp://acme.com',
    'https://localhost',
  ])('rejects invalid website %p', async (companyWebsite) => {
    await patch({ ...valid, companyWebsite }).expect(400);
  });

  it.each(['https://acme.com', 'http://www.acme.co.in/about', 'acme.io'])(
    'accepts website %p',
    async (companyWebsite) => {
      await patch({ ...valid, companyWebsite }).expect(200);
    },
  );

  it('accepts null for optional fields (clears them)', async () => {
    await patch({
      ...valid,
      companyWebsite: null,
      expectedUsageRange: null,
      primaryUseCase: null,
    }).expect(200);
  });
});
