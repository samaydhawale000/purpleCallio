import { NotificationCleanupService } from './notification-cleanup.service';

const DAY = 86_400_000;
const now = new Date('2026-10-05T04:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);

function setup(rows: { read: boolean; createdAt: Date }[]) {
  let store = rows.map((r, i) => ({ id: `n${i}`, ...r }));
  const prisma: any = {
    notification: {
      deleteMany: jest.fn(async ({ where }: any) => {
        const hit = store.filter(
          (r) => r.read === where.read && r.createdAt < where.createdAt.lt,
        );
        store = store.filter((r) => !hit.includes(r));
        return { count: hit.length };
      }),
    },
  };
  return {
    service: new NotificationCleanupService(prisma),
    remaining: () => store.map((r) => r.id),
  };
}

describe('NotificationCleanupService', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('drops read after 90 days and unread after 180 days by default', async () => {
    const { service, remaining } = setup([
      { read: true, createdAt: daysAgo(91) }, //  n0: purged
      { read: true, createdAt: daysAgo(89) }, //  n1: kept
      { read: false, createdAt: daysAgo(120) }, // n2: kept (unread)
      { read: false, createdAt: daysAgo(181) }, // n3: purged
    ]);

    expect(await service.purgeExpired(now)).toEqual({ read: 1, unread: 1 });
    expect(remaining()).toEqual(['n1', 'n2']);
  });

  it('honors env overrides but never goes below the 30-day dedupe floor', async () => {
    process.env.NOTIFICATION_READ_RETENTION_DAYS = '7';
    process.env.NOTIFICATION_UNREAD_RETENTION_DAYS = '45';
    const { service, remaining } = setup([
      { read: true, createdAt: daysAgo(10) }, //  n0: kept (floor is 30)
      { read: true, createdAt: daysAgo(31) }, //  n1: purged
      { read: false, createdAt: daysAgo(46) }, // n2: purged
    ]);

    await service.purgeExpired(now);
    expect(remaining()).toEqual(['n0']);
  });

  it('falls back to defaults for invalid values and never throws', async () => {
    process.env.NOTIFICATION_READ_RETENTION_DAYS = 'abc';
    const { service, remaining } = setup([
      { read: true, createdAt: daysAgo(60) },
    ]);
    await service.purgeExpired(now);
    expect(remaining()).toEqual(['n0']);

    const failing = new NotificationCleanupService({
      notification: {
        deleteMany: jest.fn().mockRejectedValue(new Error('db down')),
      },
    } as never);
    await expect(failing.purgeExpired(now)).resolves.toEqual({
      read: 0,
      unread: 0,
    });
  });
});
