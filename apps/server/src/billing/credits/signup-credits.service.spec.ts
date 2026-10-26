import { CreditBucketSource } from '@prisma/client';

import { SignupCreditsService } from './signup-credits.service';

describe('SignupCreditsService', () => {
  let config: { signupFreeCredits: number; signupFreeCreditsValidityDays: number | null };
  let credits: { grant: jest.Mock };
  let service: SignupCreditsService;

  beforeEach(() => {
    config = { signupFreeCredits: 500, signupFreeCreditsValidityDays: 30 };
    credits = { grant: jest.fn(async () => ({ duplicate: false })) };
    service = new SignupCreditsService({ get: jest.fn(async () => config) } as any, credits as any);
  });

  it('grants the configured free credits once, as a SIGNUP bucket with expiry', async () => {
    expect(await service.grant('u1')).toBe(500);
    expect(credits.grant).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        amount: 500,
        source: CreditBucketSource.SIGNUP,
        idempotencyKey: 'signup:u1',
        expiresAt: expect.any(Date),
      }),
    );
  });

  it('no expiry when validity is empty', async () => {
    config.signupFreeCreditsValidityDays = null;
    await service.grant('u1');
    expect(credits.grant.mock.calls[0][0].expiresAt).toBeNull();
  });

  it('does nothing when set to 0', async () => {
    config.signupFreeCredits = 0;
    expect(await service.grant('u1')).toBe(0);
    expect(credits.grant).not.toHaveBeenCalled();
  });

  it('a repeat is a no-op', async () => {
    credits.grant.mockResolvedValueOnce({ duplicate: true });
    expect(await service.grant('u1')).toBe(0);
  });
});
