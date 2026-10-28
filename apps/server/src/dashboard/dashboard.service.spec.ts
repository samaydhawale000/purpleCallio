import { NotFoundException } from '@nestjs/common';

import { DashboardService } from './dashboard.service';

const NOW = new Date('2026-10-28T12:00:00Z');
const day = (d: string, t = '10:00:00') => new Date(`2026-10-${d}T${t}Z`);

function fakePrisma(overrides: Record<string, any> = {}) {
  return {
    project: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }) },
    call: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]) },
    callUsage: {
      findMany: jest.fn().mockResolvedValue([
        { createdAt: day('27'), creditsCharged: 40, audioMinutes: 0, videoMinutes: 20, screenShareMinutes: 0 },
        { createdAt: day('28', '01:00:00'), creditsCharged: 6, audioMinutes: 3, videoMinutes: 0, screenShareMinutes: 0 },
      ]),
    },
    translationSession: {
      findMany: jest.fn().mockResolvedValue([
        { startedAt: day('27'), creditsCharged: 300, voiceSeconds: 240, captionsSeconds: 60 },
      ]),
    },
    aiCallSession: {
      findMany: jest.fn().mockResolvedValue([
        { usageRecordedAt: day('28'), creditsCharged: 15, durationSeconds: 90 },
        { usageRecordedAt: day('28'), creditsCharged: null, durationSeconds: null },
      ]),
    },
    translationReport: {
      findMany: jest.fn().mockResolvedValue([{ createdAt: day('27'), creditsCharged: 25 }]),
    },
    ...overrides,
  };
}

describe('DashboardService.getDailyUsage', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('buckets credits and minutes per UTC day by product, oldest first', async () => {
    const prisma = fakePrisma();
    const rows = await new DashboardService(prisma as any).getDailyUsage('u1', 3);

    expect(rows.map((r) => r.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
    expect(rows[0]).toMatchObject({ totalCredits: 0, callMinutes: 0 });
    expect(rows[1]).toMatchObject({
      callCredits: 40,
      callMinutes: 20,
      translateCredits: 300,
      translateMinutes: 5,
      reportCredits: 25,
      totalCredits: 365,
    });
    expect(rows[2]).toMatchObject({ callCredits: 6, callMinutes: 3, aiCredits: 15, aiMinutes: 1.5, totalCredits: 21 });
    expect(prisma.callUsage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { usage: { companyId: 'u1' }, createdAt: { gte: new Date('2026-10-26T00:00:00Z') } } }),
    );
  });

  it('clamps the window to 90 days', async () => {
    const rows = await new DashboardService(fakePrisma() as any).getDailyUsage('u1', 500);
    expect(rows).toHaveLength(90);
  });

  it('filters every source by project and checks ownership', async () => {
    const prisma = fakePrisma();
    await new DashboardService(prisma as any).getDailyUsage('u1', 7, 'p1');

    expect(prisma.project.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', ownerId: 'u1' }, select: { id: true } });
    expect(prisma.callUsage.findMany.mock.calls[0][0].where.callId).toEqual({ in: ['c1'] });
    expect(prisma.translationSession.findMany.mock.calls[0][0].where.projectId).toBe('p1');
    expect(prisma.aiCallSession.findMany.mock.calls[0][0].where.projectId).toBe('p1');
    expect(prisma.translationReport.findMany.mock.calls[0][0].where.projectId).toBe('p1');
  });

  it("rejects someone else's project", async () => {
    const prisma = fakePrisma({ project: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(new DashboardService(prisma as any).getDailyUsage('u1', 7, 'p2')).rejects.toBeInstanceOf(NotFoundException);
  });
});
