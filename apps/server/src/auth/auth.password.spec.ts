import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordAuthService } from './password-auth.service';

/**
 * HTTP-level tests for the email + password endpoints: routing, status
 * codes and the global ValidationPipe, with PasswordAuthService mocked (its
 * behaviour is covered in password-auth.service.spec.ts).
 */
describe('email + password endpoints', () => {
  let app: INestApplication;
  const session = { user: { id: 'u1' }, accessToken: 'a', refreshToken: 'r', onboardingRequired: true };
  const passwordAuth = {
    register: jest.fn(async () => ({ email: 'asha@example.com', expiresInSeconds: 600, resendInSeconds: 60 })),
    verifyRegistration: jest.fn(async () => session),
    login: jest.fn(async () => session),
    forgotPassword: jest.fn(async () => ({ sent: true })),
    resetPassword: jest.fn(async () => session),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: PasswordAuthService, useValue: passwordAuth },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => Object.values(passwordAuth).forEach((m) => m.mockClear()));

  const post = (path: string, body: any) => request(app.getHttpServer()).post(path).send(body);
  const signup = { name: 'Asha', email: 'asha@example.com', password: 'secret123' };

  it('register: 202, any email domain, extra fields (role, phone) stripped', async () => {
    await post('/auth/register', { ...signup, role: 'ADMIN', profileCompleted: true, phone: '+919876543210' }).expect(202);
    expect(passwordAuth.register).toHaveBeenCalledWith(signup);
    await post('/auth/register', { ...signup, email: 'someone@gmail.com' }).expect(202);
  });

  it.each([
    ['a short password', { password: 'abc123' }],
    ['a password without a number', { password: 'onlyletters' }],
    ['a password without a letter', { password: '12345678' }],
    ['an over-long password', { password: `a1${'x'.repeat(71)}` }],
    ['an invalid email', { email: 'not-an-email' }],
    ['a blank name', { name: '   ' }],
  ])('register rejects %s', async (_label, patch) => {
    await post('/auth/register', { ...signup, ...patch }).expect(400);
    expect(passwordAuth.register).not.toHaveBeenCalled();
  });

  it('register/verify requires a 6-digit code', async () => {
    await post('/auth/register/verify', { email: 'asha@example.com', code: '12345' }).expect(400);
    await post('/auth/register/verify', { email: 'asha@example.com', code: '123456' }).expect(200);
    expect(passwordAuth.verifyRegistration).toHaveBeenCalledWith('asha@example.com', '123456');
  });

  it('login: 200 with an email and password; a mobile number is rejected', async () => {
    await post('/auth/login', { email: 'asha@example.com', password: 'x' }).expect(200);
    expect(passwordAuth.login).toHaveBeenCalledWith('asha@example.com', 'x');
    await post('/auth/login', { email: '+919876543210', password: 'x' }).expect(400);
    await post('/auth/login', { email: 'asha@example.com', password: '' }).expect(400);
  });

  it('password/forgot: 202; password/reset validates the code and new password', async () => {
    await post('/auth/password/forgot', { email: 'asha@example.com' }).expect(202);
    await post('/auth/password/reset', { email: 'asha@example.com', code: '123456', password: 'weak' }).expect(400);
    await post('/auth/password/reset', { email: 'asha@example.com', code: '123456', password: 'newpass99' }).expect(200);
    expect(passwordAuth.resetPassword).toHaveBeenCalledWith('asha@example.com', '123456', 'newpass99');
  });
});
