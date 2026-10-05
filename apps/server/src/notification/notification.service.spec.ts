import { NotFoundException } from '@nestjs/common';
import { NotificationService } from './notification.service';

/** Tiny in-memory notification store honoring the (userId, dedupeKey) unique. */
function createFakePrisma() {
  const rows: any[] = [];
  let id = 0;
  const matches = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => r[k] === v);

  const store: any = {
    notification: {
      create: jest.fn(async ({ data }: any) => {
        if (
          data.dedupeKey &&
          rows.some(
            (r) => r.userId === data.userId && r.dedupeKey === data.dedupeKey,
          )
        ) {
          throw Object.assign(new Error('Unique constraint'), {
            code: 'P2002',
          });
        }
        const row = {
          id: `n${++id}`,
          read: false,
          createdAt: new Date(),
          ...data,
        };
        rows.push(row);
        return row;
      }),
      count: jest.fn(
        async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter((r) => matches(r, where)),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
    },
    user: {
      findMany: jest.fn(async () => [{ id: 'admin_1' }, { id: 'admin_2' }]),
    },
  };
  return { store, rows };
}

describe('NotificationService', () => {
  let fake: ReturnType<typeof createFakePrisma>;
  let service: NotificationService;
  let realtime: { emitToUser: jest.Mock; emitToAdmins: jest.Mock };

  beforeEach(() => {
    fake = createFakePrisma();
    realtime = { emitToUser: jest.fn(), emitToAdmins: jest.fn() };
    service = new NotificationService(fake.store, realtime as never);
  });

  const base = {
    type: 'INVOICE_GENERATED' as const,
    title: 'Invoice generated',
    message: 'Your usage invoice is now available.',
  };

  it('skips a second notification for the same event', async () => {
    await service.createNotification({
      ...base,
      userId: 'u1',
      dedupeKey: 'invoice-generated:i1',
    });
    const dup = await service.createNotification({
      ...base,
      userId: 'u1',
      dedupeKey: 'invoice-generated:i1',
    });

    expect(dup).toBeNull();
    expect(fake.rows).toHaveLength(1);
  });

  it('pushes a realtime event to the recipient, but not for a duplicate', async () => {
    const input = { ...base, userId: 'u1', dedupeKey: 'k' };
    await service.createNotification(input);
    await service.createNotification(input);
    expect(realtime.emitToUser).toHaveBeenCalledTimes(1);
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'notification:new', {
      audience: 'CUSTOMER',
    });
  });

  it('never throws when the write fails', async () => {
    fake.store.notification.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.createNotification({ ...base, userId: 'u1' }),
    ).resolves.toBeNull();
  });

  it('fans admin notifications out to every admin with the ADMIN audience', async () => {
    await service.notifyAdmins({ ...base, dedupeKey: 'admin:x' });

    expect(fake.rows.map((r) => [r.userId, r.audience])).toEqual([
      ['admin_1', 'ADMIN'],
      ['admin_2', 'ADMIN'],
    ]);
  });

  it('keeps customer and admin feeds separate', async () => {
    await service.createNotification({ ...base, userId: 'admin_1' });
    await service.notifyAdmins(base);

    expect(await service.unreadCount('admin_1')).toEqual({ count: 1 });
    expect(await service.unreadCount('admin_1', 'ADMIN')).toEqual({ count: 1 });
    await service.markAllRead('admin_1', 'ADMIN');
    expect(await service.unreadCount('admin_1')).toEqual({ count: 1 });
    expect(await service.unreadCount('admin_1', 'ADMIN')).toEqual({ count: 0 });
  });

  it("cannot mark another user's notification as read", async () => {
    const n = await service.createNotification({ ...base, userId: 'u1' });

    await expect(service.markRead('u2', n!.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fake.rows[0].read).toBe(false);

    await service.markRead('u1', n!.id);
    expect(fake.rows[0].read).toBe(true);
  });
});
