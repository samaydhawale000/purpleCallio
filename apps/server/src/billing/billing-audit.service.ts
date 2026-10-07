import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface BillingAuditEntry {
  action: AuditAction;
  actorId?: string | null;
  entity: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  extra?: Record<string, unknown>;
}

/**
 * Audit trail for billing changes (pricing, plans, credits, payments).
 * Writes to the existing AuditLog table; metadata always carries
 * { entity, entityId, oldValue, newValue } so a pricing change like
 * "Growth ₹1,999 → ₹2,499 by admin X" can be reconstructed exactly.
 * Best-effort: an audit failure is logged, never thrown into the caller.
 */
@Injectable()
export class BillingAuditService {
  private readonly logger = new Logger(BillingAuditService.name);

  constructor(private prisma: PrismaService) {}

  async log(entry: BillingAuditEntry, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          action: entry.action,
          actorId: entry.actorId ?? null,
          metadata: JSON.parse(
            JSON.stringify({
              entity: entry.entity,
              entityId: entry.entityId ?? null,
              oldValue: entry.oldValue ?? null,
              newValue: entry.newValue ?? null,
              ...(entry.extra ?? {}),
            }),
          ),
        },
      });
    } catch (err) {
      if (tx) throw err;
      this.logger.warn(
        `Audit log ${entry.action} for ${entry.entity} failed: ${String(err)}`,
      );
    }
  }
}
