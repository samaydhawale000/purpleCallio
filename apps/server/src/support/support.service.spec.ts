import { NotFoundException } from '@nestjs/common';
import { SupportService } from './support.service';

/**
 * Minimal in-memory fake for the two support models, in the same
 * lightweight hand-rolled style as customer-discount.service.spec.ts.
 * Supports just the query shapes SupportService uses.
 */
function createFakePrisma() {
  let idCounter = 0;
  let ticketSeq = 1000;
  const tickets: any[] = [];
  const messages: any[] = [];

  const matches = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => row[k] === v);

  const withIncludes = (t: any, include: any) => {
    if (!t) return null;
    const out = { ...t };
    if (include?.messages) {
      out.messages = messages
        .filter((m) => m.ticketId === t.id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((m) => ({ ...m, sender: null }));
    }
    // select/include of the owner is always satisfied in this fake
    out.user = { id: t.userId, name: 'Samay', email: 'samay@acme.com' };
    return out;
  };

  const store: any = {
    supportTicket: {
      create: jest.fn(async ({ data, include }: any) => {
        const now = new Date();
        const { messages: nested, ...fields } = data;
        const row = {
          id: `ticket_${++idCounter}`,
          ticketNumber: ++ticketSeq,
          status: 'OPEN',
          createdAt: now,
          updatedAt: now,
          ...fields,
        };
        tickets.push(row);
        if (nested?.create) {
          messages.push({
            id: `msg_${++idCounter}`,
            ticketId: row.id,
            createdAt: now,
            ...nested.create,
          });
        }
        return include?.user
          ? { ...row, user: { name: 'Samay', email: 'samay@acme.com' } }
          : row;
      }),
      findFirst: jest.fn(async ({ where, include }: any) =>
        withIncludes(
          tickets.find((t) => matches(t, where)),
          include,
        ),
      ),
      findUnique: jest.fn(async ({ where, include }: any) =>
        withIncludes(
          tickets.find((t) => matches(t, where)),
          include,
        ),
      ),
      findMany: jest.fn(async ({ where }: any) =>
        tickets
          .filter((t) => matches(t, where))
          .map((t) => withIncludes(t, {})),
      ),
      count: jest.fn(
        async ({ where }: any) =>
          tickets.filter((t) => matches(t, where)).length,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = tickets.find((t) => t.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    supportMessage: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `msg_${++idCounter}`,
          createdAt: new Date(Date.now() + idCounter),
          ...data,
        };
        messages.push(row);
        return row;
      }),
    },
    // Array form: the operations above were already invoked (they're plain
    // promises in this fake), so just await them in order.
    $transaction: jest.fn(async (ops: Promise<any>[]) => Promise.all(ops)),
  };

  return { store, tickets, messages };
}

describe('SupportService', () => {
  let fake: ReturnType<typeof createFakePrisma>;
  let service: SupportService;
  let realtime: { emitToUser: jest.Mock; emitToAdmins: jest.Mock };
  let notifications: { createNotification: jest.Mock; notifyAdmins: jest.Mock };

  beforeEach(() => {
    fake = createFakePrisma();
    notifications = { createNotification: jest.fn(), notifyAdmins: jest.fn() };
    realtime = { emitToUser: jest.fn(), emitToAdmins: jest.fn() };
    service = new SupportService(
      fake.store,
      notifications as never,
      realtime as never,
    );
  });

  it('creates a ticket with a human-friendly number and an opening customer message', async () => {
    const first = await service.createTicket('user_a', {
      subject: '  Webhook not firing  ',
      message: 'call.ended never arrives',
      documentationId: 'webhooks',
    });
    const second = await service.createTicket('user_a', {
      subject: 'Second',
      message: 'Another issue',
    });

    expect(first.ticketNumber).toBe('PC-1001');
    expect(second.ticketNumber).toBe('PC-1002');
    expect(first.subject).toBe('Webhook not firing');
    expect(first.status).toBe('OPEN');
    expect(first.documentationId).toBe('webhooks');
    expect(second.documentationId).toBeNull();

    const detail = await service.getCustomerTicket('user_a', first.id);
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]).toMatchObject({
      senderType: 'CUSTOMER',
      message: 'call.ended never arrives',
    });
  });

  it("does not let a customer read or reply to another customer's ticket", async () => {
    const ticket = await service.createTicket('user_a', {
      subject: 'Private',
      message: 'Only mine',
    });

    await expect(
      service.getCustomerTicket('user_b', ticket.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.addCustomerMessage('user_b', ticket.id, 'sneaky'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fake.messages).toHaveLength(1);
  });

  it('only lists the requesting customer’s tickets', async () => {
    await service.createTicket('user_a', { subject: 'A', message: 'a' });
    await service.createTicket('user_b', { subject: 'B', message: 'b' });

    const list = await service.listCustomerTickets('user_a');
    expect(list.map((t) => t.subject)).toEqual(['A']);
  });

  it('returns 404 for unknown ticket ids', async () => {
    await expect(
      service.getCustomerTicket('user_a', 'does-not-exist'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getAdminTicket('does-not-exist'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateStatus('does-not-exist', 'RESOLVED'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records admin replies as ADMIN and lets admins change status', async () => {
    const ticket = await service.createTicket('user_a', {
      subject: 'Help',
      message: 'Broken',
    });

    const reply = await service.addAdminMessage('admin_1', ticket.id, 'Fixed!');
    expect(reply.senderType).toBe('ADMIN');

    const updated = await service.updateStatus(ticket.id, 'RESOLVED');
    expect(updated.status).toBe('RESOLVED');

    const detail = await service.getCustomerTicket('user_a', ticket.id);
    expect(detail.messages.map((m) => m.senderType)).toEqual([
      'CUSTOMER',
      'ADMIN',
    ]);
  });

  it('reopens a resolved ticket when the customer replies', async () => {
    const ticket = await service.createTicket('user_a', {
      subject: 'Help',
      message: 'Broken',
    });
    await service.updateStatus(ticket.id, 'RESOLVED');

    await service.addCustomerMessage('user_a', ticket.id, 'Still broken');

    expect(fake.tickets[0].status).toBe('OPEN');
  });

  describe('notifications', () => {
    it('confirms a new ticket to the customer and alerts admins', async () => {
      const t = await service.createTicket('user_a', {
        subject: 'Recurring payment API returning 400',
        message: 'details',
      });

      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user_a',
          type: 'SUPPORT_TICKET_CREATED',
          message: `Your support ticket ${t.ticketNumber} has been created.`,
          metadata: { ticketId: t.id },
        }),
      );
      expect(notifications.notifyAdmins).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SUPPORT_TICKET_CREATED',
          title: 'New support ticket',
          message:
            'Samay created a new support ticket: "Recurring payment API returning 400"',
          metadata: { ticketId: t.id },
        }),
      );
    });

    it('notifies the ticket owner of admin replies', async () => {
      const t = await service.createTicket('user_a', {
        subject: 's',
        message: 'm',
      });
      notifications.createNotification.mockClear();

      await service.addAdminMessage('admin_1', t.id, 'Try this');

      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user_a',
          type: 'SUPPORT_TICKET_REPLY',
          message: `Our support team replied to ticket ${t.ticketNumber}.`,
        }),
      );
    });

    it('notifies on a real status change only', async () => {
      const t = await service.createTicket('user_a', {
        subject: 's',
        message: 'm',
      });
      notifications.createNotification.mockClear();

      await service.updateStatus(t.id, 'OPEN'); // unchanged
      expect(notifications.createNotification).not.toHaveBeenCalled();

      await service.updateStatus(t.id, 'RESOLVED');
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SUPPORT_TICKET_STATUS_CHANGED',
          message: `Ticket ${t.ticketNumber} has been marked as resolved.`,
        }),
      );
    });

    it('alerts admins (not the customer) when the customer replies', async () => {
      const t = await service.createTicket('user_a', {
        subject: 's',
        message: 'm',
      });
      notifications.notifyAdmins.mockClear();
      notifications.createNotification.mockClear();

      await service.addCustomerMessage('user_a', t.id, 'more info');

      expect(notifications.createNotification).not.toHaveBeenCalled();
      expect(notifications.notifyAdmins).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SUPPORT_TICKET_REPLY',
          title: 'New customer reply',
          message: `Samay replied to ticket ${t.ticketNumber}.`,
          metadata: { ticketId: t.id },
        }),
      );
    });

    it('pushes a realtime update to the owner and admins on every change', async () => {
      const t = await service.createTicket('user_a', {
        subject: 's',
        message: 'm',
      });
      await service.addAdminMessage('admin_1', t.id, 'hi');
      await service.updateStatus(t.id, 'PENDING');

      expect(realtime.emitToUser).toHaveBeenCalledTimes(3);
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        'user_a',
        'support:ticket-updated',
        { ticketId: t.id },
      );
      expect(realtime.emitToAdmins).toHaveBeenCalledTimes(3);
    });
  });

  describe('unread indicators', () => {
    it('flags a ticket for the side that has not seen the latest message', async () => {
      const t = await service.createTicket('user_a', {
        subject: 's',
        message: 'm',
      });
      // New ticket: unread for admins, not for its author.
      expect((await service.listCustomerTickets('user_a'))[0].hasUnread).toBe(
        false,
      );
      expect((await service.listAdminTickets({})).data[0].hasUnread).toBe(true);

      await service.getAdminTicket(t.id); // admin opens it
      expect((await service.listAdminTickets({})).data[0].hasUnread).toBe(
        false,
      );

      // Unread compares timestamps; make sure the reply is strictly newer
      // than the customer's last read (same-millisecond writes are "seen").
      await new Promise((r) => setTimeout(r, 2));
      await service.addAdminMessage('admin_1', t.id, 'reply');
      expect((await service.listCustomerTickets('user_a'))[0].hasUnread).toBe(
        true,
      );
      expect((await service.listAdminTickets({})).data[0].hasUnread).toBe(
        false,
      );

      await service.getCustomerTicket('user_a', t.id); // customer opens it
      expect((await service.listCustomerTickets('user_a'))[0].hasUnread).toBe(
        false,
      );
    });

    it('opening a ticket does not change its last-updated time', async () => {
      const t = await service.createTicket('user_a', {
        subject: 's',
        message: 'm',
      });
      const before = fake.tickets[0].updatedAt;
      await service.getAdminTicket(t.id);
      expect(fake.tickets[0].updatedAt).toBe(before);
    });
  });
});
