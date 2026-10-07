import { BadRequestException } from '@nestjs/common';
import { CustomerDiscountService } from './customer-discount.service';

/**
 * Minimal in-memory fake for the two Prisma models this service touches
 * (customerDiscount, auditLog), including a real `$transaction` that just
 * invokes the callback with itself (so writes inside the transaction are
 * visible to reads afterward, same as a real DB transaction would be from
 * the caller's perspective). No mocking framework needed — this is a tiny
 * hand-rolled store, matching this repo's existing lightweight-fake style
 * (see usage-segment.service.spec.ts).
 */
function createFakePrisma() {
  let idCounter = 0;
  const discounts: any[] = [];
  const auditLogs: any[] = [];

  const store = {
    customerDiscount: {
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        // Respect whichever field the real call actually ordered by
        // (getActiveDiscount uses effectiveFrom desc; getLatestDiscount uses
        // createdAt desc) rather than guessing — the two can genuinely
        // differ (a discount's effectiveFrom need not match its createdAt).
        const [orderField, direction] = orderBy
          ? (Object.entries(orderBy)[0] as [string, string])
          : ['createdAt', 'desc'];
        const sign = direction === 'desc' ? -1 : 1;
        return (
          discounts
            .filter((d) => matchesWhere(d, where))
            .sort(
              (a, b) =>
                sign * (a[orderField].getTime() - b[orderField].getTime()),
            )[0] ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `discount_${++idCounter}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        discounts.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = discounts.find((d) => d.id === where.id);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `audit_${auditLogs.length + 1}`,
          createdAt: new Date(),
          ...data,
        };
        auditLogs.push(row);
        return row;
      }),
    },
    $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => fn(store)),
  };

  function matchesWhere(row: any, where: any): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === 'effectiveFrom' && value && typeof value === 'object') {
        if ('lte' in (value as any))
          return row.effectiveFrom.getTime() <= (value as any).lte.getTime();
      }
      if (key === 'OR') {
        return (value as any[]).some((clause) => matchesWhere(row, clause));
      }
      if (key === 'effectiveUntil' && value && typeof value === 'object') {
        if ('gte' in (value as any)) {
          return (
            row.effectiveUntil != null &&
            row.effectiveUntil.getTime() >= (value as any).gte.getTime()
          );
        }
      }
      if (key === 'effectiveUntil' && value === null)
        return row.effectiveUntil === null;
      return row[key] === value;
    });
  }

  return { store, discounts, auditLogs };
}

describe('CustomerDiscountService', () => {
  const ADMIN_ID = 'admin-1';
  const COMPANY_ID = 'company-peach';

  function makeService() {
    const fake = createFakePrisma();
    const service = new CustomerDiscountService(fake.store as never);
    return { service, ...fake };
  }

  describe('validation', () => {
    it.each([-1, 101, NaN, 12.5])(
      'rejects percentage %p',
      async (percentage) => {
        const { service } = makeService();
        await expect(
          service.setDiscount(COMPANY_ID, ADMIN_ID, {
            percentage: percentage as number,
            effectiveFrom: new Date('2026-10-01'),
          }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it.each([0, 10, 15, 25, 100])(
      'accepts percentage %i',
      async (percentage) => {
        const { service } = makeService();
        const created = await service.setDiscount(COMPANY_ID, ADMIN_ID, {
          percentage,
          effectiveFrom: new Date('2026-10-01'),
        });
        expect(created.percentage).toBe(percentage);
      },
    );

    it('rejects effectiveUntil before effectiveFrom', async () => {
      const { service } = makeService();
      await expect(
        service.setDiscount(COMPANY_ID, ADMIN_ID, {
          percentage: 15,
          effectiveFrom: new Date('2026-10-01'),
          effectiveUntil: new Date('2026-09-01'),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid date', async () => {
      const { service } = makeService();
      await expect(
        service.setDiscount(COMPANY_ID, ADMIN_ID, {
          percentage: 15,
          effectiveFrom: new Date('not-a-date'),
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('effective-date resolution', () => {
    it('returns no discount before effectiveFrom', async () => {
      const { service } = makeService();
      await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 15,
        effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      });
      const resolved = await service.getActiveDiscount(
        COMPANY_ID,
        new Date('2026-09-30T23:59:59Z'),
      );
      expect(resolved).toBeNull();
    });

    it('applies the discount on and after effectiveFrom', async () => {
      const { service } = makeService();
      await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 15,
        effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      });
      const resolved = await service.getActiveDiscount(
        COMPANY_ID,
        new Date('2026-10-01T00:00:00Z'),
      );
      expect(resolved?.percentage).toBe(15);
    });

    it('stops applying strictly after effectiveUntil', async () => {
      const { service } = makeService();
      await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 15,
        effectiveFrom: new Date('2026-10-01T00:00:00Z'),
        effectiveUntil: new Date('2026-10-31T23:59:59Z'),
      });

      const withinRange = await service.getActiveDiscount(
        COMPANY_ID,
        new Date('2026-10-31T12:00:00Z'),
      );
      expect(withinRange?.percentage).toBe(15);

      const afterEnd = await service.getActiveDiscount(
        COMPANY_ID,
        new Date('2026-11-01T00:00:01Z'),
      );
      expect(afterEnd).toBeNull();
    });

    it('with no effectiveUntil, continues indefinitely', async () => {
      const { service } = makeService();
      await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 15,
        effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      });
      const farFuture = await service.getActiveDiscount(
        COMPANY_ID,
        new Date('2030-01-01T00:00:00Z'),
      );
      expect(farFuture?.percentage).toBe(15);
    });
  });

  describe('recurring billing / replacing a discount', () => {
    it('a discount continues to resolve as active across later "cycle" dates with no admin action', async () => {
      const { service } = makeService();
      await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 15,
        effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      });

      for (const cycleStart of ['2026-10-01', '2026-11-01', '2026-12-01']) {
        const resolved = await service.getActiveDiscount(
          COMPANY_ID,
          new Date(cycleStart),
        );
        expect(resolved?.percentage).toBe(15);
      }
    });

    it('only one active discount exists at a time — replacing deactivates the old one but keeps it for history', async () => {
      const { service, discounts } = makeService();
      const first = await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 15,
        effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      });
      const second = await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 20,
        effectiveFrom: new Date('2026-11-01T00:00:00Z'),
      });

      const activeOnes = discounts.filter(
        (d) => d.companyId === COMPANY_ID && d.active,
      );
      expect(activeOnes).toHaveLength(1);
      expect(activeOnes[0].id).toBe(second.id);

      // The old (October) record still exists — preserved for audit/history.
      const stillPresent = discounts.find((d) => d.id === first.id);
      expect(stillPresent).toBeDefined();
      expect(stillPresent.active).toBe(false);
      expect(stillPresent.percentage).toBe(15);
    });

    it('a past cycle date still resolves the discount that was active back then is NOT retroactively recomputed by resolving "now"', async () => {
      // This models the invoice-generation call site, which always passes an
      // explicit cycleStart — never "now" — so a later discount change can't
      // affect an already-closed cycle's resolution.
      const { service } = makeService();
      await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 15,
        effectiveFrom: new Date('2026-10-01T00:00:00Z'),
        effectiveUntil: new Date('2026-10-31T23:59:59Z'),
      });
      await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 20,
        effectiveFrom: new Date('2026-11-01T00:00:00Z'),
      });

      const octoberCycle = await service.getActiveDiscount(
        COMPANY_ID,
        new Date('2026-10-15'),
      );
      const novemberCycle = await service.getActiveDiscount(
        COMPANY_ID,
        new Date('2026-11-15'),
      );
      expect(octoberCycle?.percentage).toBe(15);
      expect(novemberCycle?.percentage).toBe(20);
    });
  });

  describe('disable', () => {
    it('disabling clears the active discount', async () => {
      const { service } = makeService();
      await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 15,
        effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      });
      await service.disableDiscount(COMPANY_ID, ADMIN_ID);

      const resolved = await service.getActiveDiscount(
        COMPANY_ID,
        new Date('2026-10-15'),
      );
      expect(resolved).toBeNull();
    });

    it('disabling with no existing discount is a safe no-op', async () => {
      const { service } = makeService();
      const result = await service.disableDiscount(COMPANY_ID, ADMIN_ID);
      expect(result).toBeNull();
    });
  });

  describe('audit logging', () => {
    it('creates a DISCOUNT_CREATED audit entry on first creation', async () => {
      const { service, auditLogs } = makeService();
      await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 15,
        effectiveFrom: new Date('2026-10-01T00:00:00Z'),
        reason: 'Enterprise volume agreement',
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe('DISCOUNT_CREATED');
      expect(auditLogs[0].actorId).toBe(ADMIN_ID);
      expect(auditLogs[0].metadata).toMatchObject({
        companyId: COMPANY_ID,
        previousPercentage: null,
        newPercentage: 15,
        reason: 'Enterprise volume agreement',
      });
    });

    it('creates a DISCOUNT_UPDATED audit entry (with previousPercentage) when replacing', async () => {
      const { service, auditLogs } = makeService();
      await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 15,
        effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      });
      await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 20,
        effectiveFrom: new Date('2026-11-01T00:00:00Z'),
      });
      expect(auditLogs[1].action).toBe('DISCOUNT_UPDATED');
      expect(auditLogs[1].metadata).toMatchObject({
        previousPercentage: 15,
        newPercentage: 20,
      });
    });

    it('creates a DISCOUNT_DISABLED audit entry', async () => {
      const { service, auditLogs } = makeService();
      await service.setDiscount(COMPANY_ID, ADMIN_ID, {
        percentage: 15,
        effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      });
      await service.disableDiscount(COMPANY_ID, ADMIN_ID);
      expect(auditLogs[1].action).toBe('DISCOUNT_DISABLED');
      expect(auditLogs[1].metadata).toMatchObject({ previousPercentage: 15 });
    });
  });
});
