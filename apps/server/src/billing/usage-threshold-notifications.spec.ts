import { UsageBillingService } from './usage-billing.service';

/**
 * recordCallUsage → free-allowance threshold notifications. Usage rows are
 * simulated by running totals; Prisma only needs the calls recordCallUsage
 * makes.
 */
function setup(freeVideoMins = 100) {
  const totals = { id: 'usage_1', audioMinutes: 0, videoMinutes: 0 };
  const prisma: any = {
    callUsage: { findFirst: jest.fn(async () => null), create: jest.fn() },
    usage: {
      update: jest.fn(({ data }: any) => {
        totals.audioMinutes += data.audioMinutes.increment;
        totals.videoMinutes += data.videoMinutes.increment;
        return { ...totals };
      }),
    },
    $transaction: jest.fn(async (ops: any[]) => ops),
  };
  const notifications = {
    createNotification: jest.fn(),
    notifyAdmins: jest.fn(),
  };
  const service = new UsageBillingService(
    prisma as never,
    {} as never,
    {} as never,
    notifications as never,
  );
  jest.spyOn(service, 'getOrCreateUsage').mockResolvedValue(totals as never);
  jest
    .spyOn(service, 'computeCost')
    .mockResolvedValue({ totalPaise: 0 } as never);
  jest.spyOn(service, 'getRates').mockResolvedValue({
    freeAudioMins: 500,
    freeVideoMins,
  } as never);

  let n = 0;
  const recordVideo = (videoMinutes: number) =>
    service.recordCallUsage('user_1', `call_${++n}`, {
      audioMinutes: 0,
      videoMinutes,
      screenShareMinutes: 0,
      participants: 2,
    });
  const types = () =>
    notifications.createNotification.mock.calls.map((c) => c[0].type);
  return { recordVideo, types, notifications };
}

describe('usage allowance threshold notifications', () => {
  it('notifies once at 80% and once at 100%, never on calls in between', async () => {
    const { recordVideo, types } = setup();

    await recordVideo(50); // 50%
    expect(types()).toEqual([]);
    await recordVideo(35); // 85% — crosses 80
    await recordVideo(5); //  90% — no new threshold
    await recordVideo(15); // 105% — crosses 100
    await recordVideo(20); // 125% — already reached

    expect(types()).toEqual(['USAGE_LIMIT_APPROACHING', 'USAGE_LIMIT_REACHED']);
  });

  it('sends only the 100% notice when one call jumps past both thresholds', async () => {
    const { recordVideo, types, notifications } = setup();

    await recordVideo(120);

    expect(types()).toEqual(['USAGE_LIMIT_REACHED']);
    expect(notifications.createNotification.mock.calls[0][0].dedupeKey).toBe(
      'usage:usage_1:video:100',
    );
  });

  it('does nothing when there is no free allowance', async () => {
    const { recordVideo, types } = setup(0);
    await recordVideo(1000);
    expect(types()).toEqual([]);
  });
});
