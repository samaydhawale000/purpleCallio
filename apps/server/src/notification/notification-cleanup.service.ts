import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;

/**
 * Never retain for less than this: deleting a notification also deletes its
 * dedupeKey, so an event re-processed after deletion (Razorpay webhook
 * retry, dunning retry, a usage threshold in the same cycle) would notify
 * again. All of those settle within days; 30 is a comfortable floor.
 */
export const MIN_RETENTION_DAYS = 30;

function retentionDays(value: string | undefined, fallback: number) {
  const days = Number(value);
  return Math.max(
    MIN_RETENTION_DAYS,
    Number.isFinite(days) && days > 0 ? days : fallback,
  );
}

/**
 * Daily retention for in-app notifications. Read ones are dropped after
 * NOTIFICATION_READ_RETENTION_DAYS (default 90); unread ones are kept longer,
 * NOTIFICATION_UNREAD_RETENTION_DAYS (default 180), since the user may not
 * have seen them yet. Two bulk deletes by age; this table stays small
 * (notifications are deduped and only sent for important events), so a
 * once-a-day scan is cheap. Idempotent — safe to re-run or overlap.
 */
@Injectable()
export class NotificationCleanupService {
  private readonly logger = new Logger(NotificationCleanupService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpired(now = new Date()) {
    const readDays = retentionDays(
      process.env.NOTIFICATION_READ_RETENTION_DAYS,
      90,
    );
    const unreadDays = retentionDays(
      process.env.NOTIFICATION_UNREAD_RETENTION_DAYS,
      180,
    );

    try {
      const [read, unread] = await Promise.all([
        this.prisma.notification.deleteMany({
          where: {
            read: true,
            createdAt: { lt: new Date(now.getTime() - readDays * DAY_MS) },
          },
        }),
        this.prisma.notification.deleteMany({
          where: {
            read: false,
            createdAt: { lt: new Date(now.getTime() - unreadDays * DAY_MS) },
          },
        }),
      ]);
      if (read.count || unread.count) {
        this.logger.log(
          `Purged ${read.count} read (>${readDays}d) and ${unread.count} unread (>${unreadDays}d) notifications`,
        );
      }
      return { read: read.count, unread: unread.count };
    } catch (err) {
      this.logger.error(`Notification cleanup failed: ${String(err)}`);
      return { read: 0, unread: 0 };
    }
  }
}
