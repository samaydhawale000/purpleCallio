import { AutoTopUpMandateStatus } from '@prisma/client';

import { AutoTopUpService } from './auto-topup.service';

describe('AutoTopUpService.syncMandate', () => {
  let row: any;
  let provider: { getMandateStatus: jest.Mock };
  let service: AutoTopUpService;

  beforeEach(() => {
    row = {
      id: 's1',
      userId: 'u1',
      enabled: false,
      mandateStatus: AutoTopUpMandateStatus.PENDING,
      mandateOrderId: 'order_1',
      providerCustomerId: 'cust_1',
      providerTokenId: null,
    };
    const prisma: any = {
      autoTopUpSetting: {
        findUnique: jest.fn(async () => ({ ...row })),
        update: jest.fn(async ({ data }: any) => Object.assign(row, data)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (row.mandateStatus !== where.mandateStatus) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
    };
    provider = { getMandateStatus: jest.fn() };
    service = new AutoTopUpService(prisma, provider as any, {} as any, {} as any, {} as any, {} as any);
  });

  it('activates a mandate Razorpay has confirmed, without waiting for the webhook', async () => {
    provider.getMandateStatus.mockResolvedValue({ status: 'confirmed', tokenId: 'token_1' });
    const s = await service.syncMandate('u1');
    expect(provider.getMandateStatus).toHaveBeenCalledWith('order_1', 'cust_1');
    expect(s).toMatchObject({ mandateStatus: 'ACTIVE', providerTokenId: 'token_1', enabled: false });
  });

  it('stays pending while the bank has not confirmed', async () => {
    provider.getMandateStatus.mockResolvedValue({ status: 'pending', tokenId: 'token_1' });
    expect(await service.syncMandate('u1')).toMatchObject({ mandateStatus: 'PENDING', providerTokenId: 'token_1' });
  });

  it('a rejected or tokenless authorization needs attention', async () => {
    provider.getMandateStatus.mockResolvedValue({ status: 'rejected', tokenId: null });
    expect(await service.syncMandate('u1')).toMatchObject({ mandateStatus: 'FAILED', attentionReason: 'mandate_inactive' });
  });

  it('provider errors leave the setting untouched', async () => {
    provider.getMandateStatus.mockRejectedValue(new Error('down'));
    expect(await service.syncMandate('u1')).toMatchObject({ mandateStatus: 'PENDING' });
  });

  it('only pending mandates are checked', async () => {
    row.mandateStatus = AutoTopUpMandateStatus.ACTIVE;
    await service.syncMandate('u1');
    expect(provider.getMandateStatus).not.toHaveBeenCalled();
  });
});
