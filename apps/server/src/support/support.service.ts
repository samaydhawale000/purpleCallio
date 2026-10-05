import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SupportSenderType, SupportTicketStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';

const TICKET_PREFIX = 'PC-';

type TicketRow = {
  id: string;
  ticketNumber: number;
  subject: string;
  documentationId: string | null;
  status: SupportTicketStatus;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService) {}

  // ── Customer ─────────────────────────────────────────
  async createTicket(userId: string, dto: CreateTicketDto) {
    // Ticket + first message in one nested write, so a ticket can never exist
    // without its opening message. ticketNumber comes from a DB sequence.
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        subject: dto.subject.trim(),
        documentationId: dto.documentationId || null,
        messages: {
          create: {
            senderId: userId,
            senderType: SupportSenderType.CUSTOMER,
            message: dto.message.trim(),
          },
        },
      },
    });
    return this.toSummary(ticket);
  }

  async listCustomerTickets(userId: string) {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return tickets.map((t) => this.toSummary(t));
  }

  async getCustomerTicket(userId: string, ticketId: string) {
    // Scoped by owner: another customer's ticket is indistinguishable from a
    // missing one (404, not 403) so ticket ids can't be probed.
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

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
      select: { id: true, status: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    // A customer reply means the ticket needs attention again, so it
    // returns to OPEN. This is the only way a customer affects status.
    return this.addMessage(
      ticket.id,
      userId,
      SupportSenderType.CUSTOMER,
      message,
      ticket.status === SupportTicketStatus.OPEN
        ? undefined
        : SupportTicketStatus.OPEN,
    );
  }

  // ── Admin ────────────────────────────────────────────
  async listAdminTickets(params: {
    page?: string;
    search?: string;
    status?: string;
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
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    return {
      ...this.toSummary(ticket),
      customer: ticket.user,
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
      select: { id: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    return this.addMessage(
      ticket.id,
      adminId,
      SupportSenderType.ADMIN,
      message,
    );
  }

  async updateStatus(ticketId: string, status: SupportTicketStatus) {
    const existing = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Ticket not found');

    const ticket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status },
    });
    return this.toSummary(ticket);
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
    const [created] = await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: { ticketId, senderId, senderType, message: message.trim() },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { updatedAt: new Date(), ...(status ? { status } : {}) },
      }),
    ]);
    return {
      id: created.id,
      senderType: created.senderType,
      message: created.message,
      createdAt: created.createdAt,
    };
  }

  private toSummary(t: TicketRow) {
    return {
      id: t.id,
      ticketNumber: `${TICKET_PREFIX}${t.ticketNumber}`,
      subject: t.subject,
      documentationId: t.documentationId,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}
