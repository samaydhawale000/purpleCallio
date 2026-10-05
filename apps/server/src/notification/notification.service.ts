import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationAudience, NotificationType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  /** Small ids for click-through (ticketId, invoiceId, ...) — never whole objects. */
  metadata?: Record<string, string | number | null>;
  audience?: NotificationAudience;
  /**
   * Stable id of the underlying event. A second create with the same key
   * for the same user is silently skipped (webhook retries, cron overlap,
   * repeated usage recalculation).
   */
  dedupeKey?: string;
}

/**
 * The single place notifications are created. Features call
 * createNotification/notifyAdmins *after* their own business write has
 * succeeded; a notification failure is logged and swallowed so it can
 * never break billing, support or any other flow.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  async createNotification(input: CreateNotificationInput) {
    try {
      const created = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          message: input.message,
          metadata: input.metadata ?? Prisma.JsonNull,
          audience: input.audience ?? NotificationAudience.CUSTOMER,
          dedupeKey: input.dedupeKey ?? null,
        },
      });
      this.realtime.emitToUser(input.userId, 'notification:new', {
        audience: created.audience,
      });
      return created;
    } catch (err: any) {
      if (err?.code === 'P2002') return null; // duplicate event — already notified
      this.logger.warn(
        `Failed to create ${input.type} notification for ${input.userId}: ${String(err)}`,
      );
      return null;
    }
  }

  /** Fan an admin-audience notification out to every ADMIN user. */
  async notifyAdmins(
    input: Omit<CreateNotificationInput, 'userId' | 'audience'>,
  ) {
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
      });
      await Promise.all(
        admins.map((a) =>
          this.createNotification({
            ...input,
            userId: a.id,
            audience: NotificationAudience.ADMIN,
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to notify admins (${input.type}): ${String(err)}`,
      );
    }
  }

  // ── Reads (always scoped to the requesting user) ─────────
  async list(
    userId: string,
    params: { audience?: string; filter?: string; page?: string },
  ) {
    const page = Math.max(1, parseInt(params.page ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );
    const audience = this.parseAudience(params.audience);
    const where: Prisma.NotificationWhereInput = {
      userId,
      audience,
      ...(params.filter === 'unread' ? { read: false } : {}),
    };

    const [total, unread, rows] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { userId, audience, read: false },
      }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          read: true,
          metadata: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      data: rows,
      unread,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async unreadCount(userId: string, audience?: string) {
    const count = await this.prisma.notification.count({
      where: { userId, audience: this.parseAudience(audience), read: false },
    });
    return { count };
  }

  async markRead(userId: string, id: string) {
    // Scoped by owner: someone else's notification behaves like a missing one.
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
    if (result.count === 0)
      throw new NotFoundException('Notification not found');
    return { success: true };
  }

  async markAllRead(userId: string, audience?: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, audience: this.parseAudience(audience), read: false },
      data: { read: true },
    });
    return { updated: result.count };
  }

  private parseAudience(value?: string): NotificationAudience {
    return value === NotificationAudience.ADMIN
      ? NotificationAudience.ADMIN
      : NotificationAudience.CUSTOMER;
  }
}
