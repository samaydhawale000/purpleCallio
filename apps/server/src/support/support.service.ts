import { Injectable, NotFoundException } from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  SupportSenderType,
  SupportTicketStatus,
  SupportTicketType,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { NotificationService } from '../notification/notification.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const TICKET_PREFIX = 'PC-';

const STATUS_LABELS: Record<SupportTicketStatus, string> = {
  OPEN: 'open',
  PENDING: 'pending',
  RESOLVED: 'resolved',
};

type TicketRow = {
  id: string;
  userId: string;
  ticketNumber: number;
  subject: string;
  type?: SupportTicketType;
  documentationId: string | null;
  status: SupportTicketStatus;
  createdAt: Date;
  updatedAt: Date;
};

/** The other side posted after this side last opened the ticket. */
function isUnread(
  otherSideLastMessageAt: Date | null,
  lastReadAt: Date | null,
) {
  return (
    !!otherSideLastMessageAt &&
    (!lastReadAt || otherSideLastMessageAt > lastReadAt)
  );
}

@Injectable()
export class SupportService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationService,
    private realtime: RealtimeGateway,
  ) {}

  // ── Customer ─────────────────────────────────────────
  async createTicket(userId: string, dto: CreateTicketDto) {
    const ticket = await this.createTicketRecord(this.prisma, userId, dto);
    const summary = this.toSummary(ticket);

    await this.notifications.createNotification({
      userId,
      type: NotificationType.SUPPORT_TICKET_CREATED,
      title: 'Ticket created',
      message: `Your support ticket ${summary.ticketNumber} has been created.`,
      metadata: { ticketId: ticket.id },
      dedupeKey: `ticket-created:${ticket.id}`,
    });
    await this.notifications.notifyAdmins({
      type: NotificationType.SUPPORT_TICKET_CREATED,
      title: 'New support ticket',
      message: `${ticket.user.name || ticket.user.email} created a new support ticket: "${summary.subject}"`,
      metadata: { ticketId: ticket.id },
      dedupeKey: `admin:ticket-created:${ticket.id}`,
    });
    this.broadcast(ticket.id, userId);

    return summary;
  }

  /**
   * Ticket + first message in one nested write, so a ticket can never exist
   * without its opening message. ticketNumber comes from a DB sequence.
   * Accepts a transaction client so other flows (e.g. a custom-plan
   * request) can create a ticket atomically with their own records; those
   * callers send their own notifications and call broadcastTicket().
   */
  async createTicketRecord(
    client: Prisma.TransactionClient | PrismaService,
    userId: string,
    dto: CreateTicketDto,
    type: SupportTicketType = SupportTicketType.GENERAL,
  ) {
    return client.supportTicket.create({
      data: {
        userId,
        subject: dto.subject.trim(),
        type,
        documentationId: dto.documentationId || null,
        lastCustomerMessageAt: new Date(),
        customerLastReadAt: new Date(),
        messages: {
          create: {
            senderId: userId,
            senderType: SupportSenderType.CUSTOMER,
            message: dto.message.trim(),
          },
        },
      },
      include: { user: { select: { name: true, email: true } } },
    });
  }

  /** Tell the ticket owner's and admins' open dashboards to refetch. */
  broadcastTicket(ticketId: string, ownerId: string) {
    this.broadcast(ticketId, ownerId);
  }

  async listCustomerTickets(userId: string) {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return tickets.map((t) => ({
      ...this.toSummary(t),
      hasUnread: isUnread(t.lastAdminMessageAt, t.customerLastReadAt),
    }));
  }

  async getCustomerTicket(userId: string, ticketId: string) {
    // Scoped by owner: another customer's ticket is indistinguishable from a
    // missing one (404, not 403) so ticket ids can't be probed.
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (isUnread(ticket.lastAdminMessageAt, ticket.customerLastReadAt)) {
      await this.markRead(ticket.id, 'customerLastReadAt', ticket.updatedAt);
    }

    return {
      ...this.toSummary(ticket),
      messages: ticket.messages.map((m) => ({
        id: m.id,
        senderType: m.senderType,
        message: m.message,
        createdAt: m.createdAt,
      })),
    };
  }

  async addCustomerMessage(userId: string, ticketId: string, message: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
      select: {
        id: true,
        status: true,
        ticketNumber: true,
        user: { select: { name: true, email: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    // A customer reply means the ticket needs attention again, so it
    // returns to OPEN. This is the only way a customer affects status.
    const created = await this.addMessage(
      ticket.id,
      userId,
      SupportSenderType.CUSTOMER,
      message,
      ticket.status === SupportTicketStatus.OPEN
        ? undefined
        : SupportTicketStatus.OPEN,
    );
    await this.notifications.notifyAdmins({
      type: NotificationType.SUPPORT_TICKET_REPLY,
      title: 'New customer reply',
      message: `${ticket.user.name || ticket.user.email} replied to ticket ${TICKET_PREFIX}${ticket.ticketNumber}.`,
      metadata: { ticketId: ticket.id },
      dedupeKey: `admin:ticket-reply:${created.id}`,
    });
    this.broadcast(ticket.id, userId);
    return created;
  }

  // ── Admin ────────────────────────────────────────────
  async listAdminTickets(params: {
    page?: string;
    search?: string;
    status?: string;
    type?: string;
  }) {
    const page = Math.max(1, parseInt(params.page ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );

    const where: Prisma.SupportTicketWhereInput = {};
    if (
      params.status &&
      (Object.values(SupportTicketStatus) as string[]).includes(params.status)
    ) {
      where.status = params.status as SupportTicketStatus;
    }
    if (
      params.type &&
      (Object.values(SupportTicketType) as string[]).includes(params.type)
    ) {
      where.type = params.type as SupportTicketType;
    }

    const search = params.search?.trim();
    if (search) {
      const or: Prisma.SupportTicketWhereInput[] = [
        { subject: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { companyName: { contains: search, mode: 'insensitive' } } },
      ];
      // "PC-1001" or "1001" matches the ticket number exactly.
      const numberMatch = /^(?:pc-?)?(\d{1,9})$/i.exec(search);
      if (numberMatch) {
        or.push({ ticketNumber: Number(numberMatch[1]) });
      }
      where.OR = or;
    }

    const [total, tickets] = await Promise.all([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: { id: true, name: true, email: true, companyName: true },
          },
        },
      }),
    ]);

    return {
      data: tickets.map((t) => ({
        ...this.toSummary(t),
        customer: t.user,
        hasUnread: isUnread(t.lastCustomerMessageAt, t.adminLastReadAt),
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getAdminTicket(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            companyName: true,
            jobTitle: true,
            country: true,
            companyWebsite: true,
            status: true,
            createdAt: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { sender: { select: { name: true, email: true } } },
        },
        customPlanRequest: { select: { id: true, status: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (isUnread(ticket.lastCustomerMessageAt, ticket.adminLastReadAt)) {
      await this.markRead(ticket.id, 'adminLastReadAt', ticket.updatedAt);
    }

    return {
      ...this.toSummary(ticket),
      customer: ticket.user,
      customPlanRequest: ticket.customPlanRequest,
      messages: ticket.messages.map((m) => ({
        id: m.id,
        senderType: m.senderType,
        senderName: m.sender?.name || m.sender?.email || null,
        message: m.message,
        createdAt: m.createdAt,
      })),
    };
  }

  async addAdminMessage(adminId: string, ticketId: string, message: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, userId: true, ticketNumber: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const created = await this.addMessage(
      ticket.id,
      adminId,
      SupportSenderType.ADMIN,
      message,
    );
    // First team reply on a custom-plan conversation marks it contacted.
    await this.prisma.customPlanRequest
      ?.updateMany({
        where: { ticketId: ticket.id, status: 'NEW' },
        data: { status: 'CONTACTED' },
      })
      .catch(() => undefined);
    await this.notifications.createNotification({
      userId: ticket.userId,
      type: NotificationType.SUPPORT_TICKET_REPLY,
      title: 'Support ticket updated',
      message: `Our support team replied to ticket ${TICKET_PREFIX}${ticket.ticketNumber}.`,
      metadata: { ticketId: ticket.id },
      dedupeKey: `ticket-reply:${created.id}`,
    });
    this.broadcast(ticket.id, ticket.userId);
    return created;
  }

  async updateStatus(ticketId: string, status: SupportTicketStatus) {
    const existing = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('Ticket not found');

    const ticket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status },
    });
    const summary = this.toSummary(ticket);

    // Only a real change is worth telling the customer about.
    if (existing.status !== status) {
      await this.notifications.createNotification({
        userId: ticket.userId,
        type: NotificationType.SUPPORT_TICKET_STATUS_CHANGED,
        title: 'Support ticket updated',
        message: `Ticket ${summary.ticketNumber} has been marked as ${STATUS_LABELS[status]}.`,
        metadata: { ticketId: ticket.id },
      });
    }
    this.broadcast(ticket.id, ticket.userId);
    return summary;
  }

  // ── Helpers ──────────────────────────────────────────
  /**
   * Appends a message and bumps the ticket's updatedAt (and optionally its
   * status) atomically, so ticket lists sorted by "last updated" reflect
   * the newest reply.
   */
  private async addMessage(
    ticketId: string,
    senderId: string,
    senderType: SupportSenderType,
    message: string,
    status?: SupportTicketStatus,
  ) {
    const now = new Date();
    const [created] = await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: { ticketId, senderId, senderType, message: message.trim() },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          updatedAt: now,
          // Posting implies the sender has seen everything before it.
          ...(senderType === SupportSenderType.CUSTOMER
            ? { lastCustomerMessageAt: now, customerLastReadAt: now }
            : { lastAdminMessageAt: now, adminLastReadAt: now }),
          ...(status ? { status } : {}),
        },
      }),
    ]);
    return {
      id: created.id,
      senderType: created.senderType,
      message: created.message,
      createdAt: created.createdAt,
    };
  }

  /**
   * Record that one side opened the ticket. updatedAt is passed through
   * unchanged so merely viewing a ticket doesn't reorder "last updated".
   */
  private async markRead(
    ticketId: string,
    field: 'customerLastReadAt' | 'adminLastReadAt',
    updatedAt: Date,
  ) {
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { [field]: new Date(), updatedAt },
    });
  }

  /** Tell the ticket owner's and admins' open dashboards to refetch. */
  private broadcast(ticketId: string, ownerId: string) {
    this.realtime.emitToUser(ownerId, 'support:ticket-updated', { ticketId });
    this.realtime.emitToAdmins('support:ticket-updated', { ticketId });
  }

  private toSummary(t: TicketRow) {
    return {
      id: t.id,
      ticketNumber: `${TICKET_PREFIX}${t.ticketNumber}`,
      subject: t.subject,
      type: t.type ?? SupportTicketType.GENERAL,
      documentationId: t.documentationId,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}
