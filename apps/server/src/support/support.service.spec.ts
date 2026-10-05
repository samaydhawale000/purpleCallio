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
    if (include?.user) out.user = { id: t.userId };
    return out;
  };

  const store: any = {
    supportTicket: {
      create: jest.fn(async ({ data }: any) => {
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
        return row;
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
        tickets.filter((t) => matches(t, where)),
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

  beforeEach(() => {
    fake = createFakePrisma();
    service = new SupportService(fake.store);
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
});
