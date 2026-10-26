import { CreditPricingStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export type CreditValueSource = 'published' | 'env' | 'none';

/**
 * Rupee value of one credit for estimates and margin reports: the published
 * INR credit price (what checkout charges), else AI_CREDIT_VALUE_PAISE.
 * Legacy top-up packages are no longer sold and are never used here.
 */
export async function creditValuePaise(
  prisma: PrismaService,
  now = new Date(),
): Promise<{ paise: number | null; source: CreditValueSource }> {
  const published = await prisma.creditPricingVersion.findFirst({
    where: {
      currency: 'INR',
      status: { in: [CreditPricingStatus.PUBLISHED, CreditPricingStatus.SCHEDULED] },
      effectiveAt: { lte: now },
    },
    orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }],
    select: { creditPricePaise: true },
  });
  if (published && published.creditPricePaise > 0)
    return { paise: published.creditPricePaise, source: 'published' };
  const raw = process.env.AI_CREDIT_VALUE_PAISE;
  const fromEnv = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return { paise: fromEnv, source: 'env' };
  return { paise: null, source: 'none' };
}
