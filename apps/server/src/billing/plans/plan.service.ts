import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingInterval,
  Plan,
  PlanCtaAction,
  PlanStatus,
  PlanType,
  PlanVersion,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingAuditService } from '../billing-audit.service';
import {
  CORE_FEATURES,
  DEFAULT_FEATURES,
  FeatureKey,
} from './feature-registry';

/** Commercial terms — changing any of these creates a new PlanVersion. */
export interface PlanTermsInput {
  pricePaise?: number;
  currency?: string;
  billingInterval?: BillingInterval;
  intervalCount?: number;
  includedCredits?: number;
  includedAudioCredits?: number | null;
  includedVideoCredits?: number | null;
  includedScreenShareCredits?: number | null;
  features?: string[];
}

/** Display fields — edited in place (never affect existing purchases). */
export interface PlanDisplayInput {
  slug?: string;
  name?: string;
  description?: string | null;
  badge?: string | null;
  type?: PlanType;
  status?: PlanStatus;
  displayOrder?: number;
  isPopular?: boolean;
  isPublic?: boolean;
  ctaLabel?: string | null;
  ctaAction?: PlanCtaAction;
  assignedUserId?: string | null;
}

export type PlanInput = PlanDisplayInput & PlanTermsInput;

export type PlanWithVersion = Plan & { currentVersion: PlanVersion | null };

const TERM_FIELDS: (keyof PlanTermsInput)[] = [
  'pricePaise',
  'currency',
  'billingInterval',
  'intervalCount',
  'includedCredits',
  'includedAudioCredits',
  'includedVideoCredits',
  'includedScreenShareCredits',
  'features',
];

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** The shape every API returns for a plan (public pricing, dashboard, admin). */
export function serializePlan(plan: PlanWithVersion) {
  const v = plan.currentVersion;
  return {
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    badge: plan.badge,
    type: plan.type,
    status: plan.status,
    displayOrder: plan.displayOrder,
    isPopular: plan.isPopular,
    isPublic: plan.isPublic,
    ctaLabel: plan.ctaLabel,
    ctaAction: plan.ctaAction,
    // Public "talk to us" plans have no fixed price to show.
    customPricing:
      plan.type === PlanType.CUSTOM &&
      plan.ctaAction === PlanCtaAction.CONTACT_SALES,
    version: v
      ? {
          id: v.id,
          version: v.version,
          pricePaise: v.pricePaise,
          currency: v.currency,
          billingInterval: v.billingInterval,
          intervalCount: v.intervalCount,
          includedCredits: v.includedCredits,
          includedAudioCredits: v.includedAudioCredits,
          includedVideoCredits: v.includedVideoCredits,
          includedScreenShareCredits: v.includedScreenShareCredits,
          features: v.features,
        }
      : null,
  };
}

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(
    private prisma: PrismaService,
    private audit: BillingAuditService,
  ) {}

  // ── Defaults ──────────────────────────────────────────────
  /**
   * Seeds the feature registry, default plans, top-up packages and config
   * on a fresh database. Only inserts into empty tables, so it never
   * overwrites anything an admin has configured. Values are starting
   * points — all of them are editable from Admin → Billing.
   */
  async ensureDefaults() {
    await this.prisma.billingConfig.upsert({
      where: { key: 'default' },
      create: { key: 'default' },
      update: {},
    });

    if ((await this.prisma.feature.count()) === 0) {
      await this.prisma.feature.createMany({
        data: DEFAULT_FEATURES.map((f, i) => ({ ...f, displayOrder: i })),
        skipDuplicates: true,
      });
    }

    if ((await this.prisma.plan.count()) === 0) {
      const plans: PlanInput[] = [
        {
          slug: 'free',
          name: 'Free',
          type: 'FREE',
          displayOrder: 0,
          ctaAction: 'SIGNUP',
          ctaLabel: 'Start free',
          description: 'Build and test with a monthly credit allowance.',
          pricePaise: 0,
          includedCredits: 1500,
          features: CORE_FEATURES,
        },
        {
          slug: 'starter',
          name: 'Starter',
          type: 'PAID',
          displayOrder: 1,
          ctaLabel: 'Choose Starter',
          description: 'For apps going live with steady call volume.',
          pricePaise: 49900,
          includedCredits: 10000,
          features: CORE_FEATURES,
        },
        {
          slug: 'growth',
          name: 'Growth',
          type: 'PAID',
          displayOrder: 2,
          isPopular: true,
          badge: 'Most popular',
          ctaLabel: 'Choose Growth',
          description: 'For growing products that need more room.',
          pricePaise: 199900,
          includedCredits: 100000,
          features: CORE_FEATURES,
        },
        {
          slug: 'business',
          name: 'Business',
          type: 'PAID',
          displayOrder: 3,
          ctaLabel: 'Choose Business',
          description: 'For high-volume production workloads.',
          pricePaise: 499900,
          includedCredits: 300000,
          features: CORE_FEATURES,
        },
        {
          slug: 'enterprise',
          name: 'Custom',
          type: 'CUSTOM',
          displayOrder: 4,
          ctaAction: 'CONTACT_SALES',
          ctaLabel: 'Talk to our team',
          description:
            'Custom pricing and credits for high-volume teams, arranged with our team.',
          pricePaise: 0,
          includedCredits: 0,
          features: CORE_FEATURES,
        },
      ];
      for (const p of plans)
        await this.createPlan(p, null, { skipAudit: true });
      this.logger.log('Seeded default plans.');
    }

    if ((await this.prisma.topUpPackage.count()) === 0) {
      await this.prisma.topUpPackage.createMany({
        data: [
          {
            name: 'Small top-up',
            pricePaise: 49900,
            credits: 25000,
            displayOrder: 0,
          },
          {
            name: 'Medium top-up',
            pricePaise: 99900,
            credits: 60000,
            displayOrder: 1,
            isPopular: true,
          },
          {
            name: 'Large top-up',
            pricePaise: 249900,
            credits: 175000,
            displayOrder: 2,
          },
        ],
      });
    }
  }

  // ── Reads ─────────────────────────────────────────────────
  /** Active public plans for the pricing page, in display order. */
  async listPublicPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { status: PlanStatus.ACTIVE, isPublic: true },
      include: { currentVersion: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return plans.filter((p) => p.currentVersion).map(serializePlan);
  }

  /** Public plans plus any private (custom) plans assigned to this customer. */
  async listPlansForUser(userId: string) {
    const plans = await this.prisma.plan.findMany({
      where: {
        status: PlanStatus.ACTIVE,
        OR: [{ isPublic: true }, { assignedUserId: userId }],
      },
      include: { currentVersion: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return plans.filter((p) => p.currentVersion).map(serializePlan);
  }

  /** A plan by id or slug (public callers only see public active plans). */
  async getPlan(idOrSlug: string, opts: { publicOnly?: boolean } = {}) {
    const plan = await this.prisma.plan.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        ...(opts.publicOnly
          ? { status: PlanStatus.ACTIVE, isPublic: true }
          : {}),
      },
      include: { currentVersion: true },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  /** The plan every account falls back to when nothing paid is active. */
  async getDefaultFreePlan(
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const plan = await client.plan.findFirst({
      where: { type: PlanType.FREE, status: PlanStatus.ACTIVE },
      include: { currentVersion: true },
      orderBy: [{ isPublic: 'desc' }, { displayOrder: 'asc' }],
    });
    if (!plan?.currentVersion) {
      throw new NotFoundException('No active Free plan is configured.');
    }
    return plan as PlanWithVersion & { currentVersion: PlanVersion };
  }

  async listFeatures(opts: { publicOnly?: boolean } = {}) {
    return this.prisma.feature.findMany({
      where: opts.publicOnly ? { isActive: true, isPublic: true } : {},
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  // ── Admin ─────────────────────────────────────────────────
  async listPlansForAdmin() {
    const [plans, counts] = await Promise.all([
      this.prisma.plan.findMany({
        include: {
          currentVersion: true,
          assignedUser: { select: { id: true, email: true, name: true } },
        },
        orderBy: [
          { status: 'asc' },
          { displayOrder: 'asc' },
          { createdAt: 'asc' },
        ],
      }),
      this.prisma.subscription.groupBy({
        by: ['planId'],
        where: { status: 'ACTIVE', planId: { not: null } },
        _count: true,
      }),
    ]);
    const subscribers = new Map(counts.map((c) => [c.planId, c._count]));
    return plans.map((p) => ({
      ...serializePlan(p),
      assignedUser: p.assignedUser,
      archivedAt: p.archivedAt,
      updatedAt: p.updatedAt,
      activeSubscribers: subscribers.get(p.id) ?? 0,
    }));
  }

  async getPlanForAdmin(id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        currentVersion: true,
        versions: { orderBy: { version: 'desc' } },
        assignedUser: { select: { id: true, email: true, name: true } },
      },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    const activeSubscribers = await this.prisma.subscription.count({
      where: { planId: id, status: 'ACTIVE' },
    });
    return {
      ...serializePlan(plan),
      assignedUser: plan.assignedUser,
      archivedAt: plan.archivedAt,
      updatedAt: plan.updatedAt,
      activeSubscribers,
      versions: plan.versions,
    };
  }

  async listSubscribers(planId: string, pageValue?: string) {
    const page = Math.max(1, parseInt(pageValue ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );
    const where: Prisma.SubscriptionWhereInput = {
      planId,
      status: { in: ['ACTIVE', 'PENDING_PAYMENT'] },
    };
    const [total, data] = await Promise.all([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          company: {
            select: { id: true, email: true, name: true, companyName: true },
          },
        },
      }),
    ]);
    return {
      data,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async createPlan(
    input: PlanInput,
    actorId: string | null,
    opts: { skipAudit?: boolean } = {},
  ) {
    const display = await this.validateDisplay(input, null);
    const terms = await this.validateTerms(input, null, display.type ?? null);
    if (!display.slug || !display.name || !display.type) {
      throw new BadRequestException('slug, name and type are required.');
    }

    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.plan.create({
        data: {
          slug: display.slug!,
          name: display.name!,
          type: display.type!,
          description: display.description ?? null,
          badge: display.badge ?? null,
          status: display.status ?? PlanStatus.ACTIVE,
          displayOrder: display.displayOrder ?? 0,
          isPopular: display.isPopular ?? false,
          isPublic: display.isPublic ?? true,
          ctaLabel: display.ctaLabel ?? null,
          ctaAction:
            display.ctaAction ??
            (display.type === 'FREE' ? 'SIGNUP' : 'CHECKOUT'),
          assignedUserId: display.assignedUserId ?? null,
        },
      });
      const version = await tx.planVersion.create({
        data: {
          ...this.termsData(terms),
          planId: created.id,
          version: 1,
          createdById: actorId,
        },
      });
      return tx.plan.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
        include: { currentVersion: true },
      });
    });

    if (!opts.skipAudit) {
      await this.audit.log({
        action: 'PLAN_CREATED',
        actorId,
        entity: 'Plan',
        entityId: plan.id,
        newValue: serializePlan(plan),
      });
    }
    return serializePlan(plan);
  }

  /**
   * Display fields update in place. If any commercial term differs from
   * the current version, a new immutable PlanVersion is created and becomes
   * current — existing subscriptions keep pointing at (and snapshotting)
   * the version they bought.
   */
  async updatePlan(id: string, input: PlanInput, actorId: string) {
    const existing = await this.prisma.plan.findUnique({
      where: { id },
      include: { currentVersion: true },
    });
    if (!existing) throw new NotFoundException('Plan not found');
    // Archived plans can be restored explicitly, but not silently edited.
    if (
      existing.status === PlanStatus.ARCHIVED &&
      (!input.status || input.status === PlanStatus.ARCHIVED)
    ) {
      throw new BadRequestException(
        'Archived plans cannot be edited. Restore it first.',
      );
    }

    const display = await this.validateDisplay(input, existing);
    const terms = await this.validateTerms(
      input,
      existing.currentVersion,
      display.type ?? existing.type,
    );
    if (display.status && display.status !== existing.status) {
      await this.assertNotLastFreePlan(existing, display.status);
    }

    const termsChanged = this.termsDiffer(terms, existing.currentVersion);
    const updated = await this.prisma.$transaction(async (tx) => {
      let currentVersionId = existing.currentVersionId;
      if (termsChanged) {
        const last = await tx.planVersion.findFirst({
          where: { planId: id },
          orderBy: { version: 'desc' },
        });
        const version = await tx.planVersion.create({
          data: {
            ...this.termsData({
              ...this.versionToTerms(existing.currentVersion),
              ...terms,
            }),
            planId: id,
            version: (last?.version ?? 0) + 1,
            createdById: actorId,
          },
        });
        currentVersionId = version.id;
      }
      return tx.plan.update({
        where: { id },
        data: {
          ...display,
          currentVersionId,
          ...(display.status === PlanStatus.ARCHIVED
            ? { archivedAt: new Date() }
            : {}),
          ...(display.status && display.status !== PlanStatus.ARCHIVED
            ? { archivedAt: null }
            : {}),
        },
        include: { currentVersion: true },
      });
    });

    await this.audit.log({
      action:
        display.status === PlanStatus.ARCHIVED
          ? 'PLAN_ARCHIVED'
          : 'PLAN_UPDATED',
      actorId,
      entity: 'Plan',
      entityId: id,
      oldValue: serializePlan(existing),
      newValue: serializePlan(updated),
      extra: { newVersionCreated: termsChanged },
    });
    return serializePlan(updated);
  }

  async archivePlan(id: string, actorId: string) {
    return this.updatePlan(
      id,
      { status: PlanStatus.ARCHIVED, isPopular: false },
      actorId,
    );
  }

  async duplicatePlan(id: string, actorId: string) {
    const source = await this.prisma.plan.findUnique({
      where: { id },
      include: { currentVersion: true },
    });
    if (!source) throw new NotFoundException('Plan not found');
    let slug = `${source.slug}-copy`.slice(0, 60);
    for (
      let n = 2;
      await this.prisma.plan.findUnique({ where: { slug } });
      n++
    ) {
      slug = `${source.slug}-copy-${n}`.slice(0, 64);
    }
    return this.createPlan(
      {
        ...this.versionToTerms(source.currentVersion),
        slug,
        name: `${source.name} (copy)`,
        description: source.description,
        badge: source.badge,
        type: source.type,
        status: PlanStatus.INACTIVE,
        displayOrder: source.displayOrder,
        isPopular: false,
        isPublic: source.isPublic,
        ctaLabel: source.ctaLabel,
        ctaAction: source.ctaAction,
        assignedUserId: null,
      },
      actorId,
    );
  }

  async upsertFeature(
    input: {
      key: string;
      name: string;
      description?: string | null;
      category?: string | null;
      displayOrder?: number;
      isActive?: boolean;
      isPublic?: boolean;
    },
    actorId: string,
  ) {
    const key = (input.key ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,62}$/.test(key)) {
      throw new BadRequestException('Feature key must be UPPER_SNAKE_CASE.');
    }
    if (!input.name?.trim())
      throw new BadRequestException('Feature name is required.');
    const before = await this.prisma.feature.findUnique({ where: { key } });
    const data = {
      name: input.name.trim(),
      description: input.description ?? null,
      category: input.category ?? null,
      displayOrder: input.displayOrder ?? before?.displayOrder ?? 0,
      isActive: input.isActive ?? before?.isActive ?? true,
      isPublic: input.isPublic ?? before?.isPublic ?? true,
    };
    const feature = await this.prisma.feature.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });
    await this.audit.log({
      action: 'FEATURE_UPDATED',
      actorId,
      entity: 'Feature',
      entityId: feature.id,
      oldValue: before,
      newValue: feature,
    });
    return feature;
  }

  // ── Helpers ───────────────────────────────────────────────
  private async validateDisplay(
    input: PlanDisplayInput,
    existing: Plan | null,
  ): Promise<PlanDisplayInput> {
    const out: PlanDisplayInput = {};
    if (input.slug !== undefined) {
      const slug = input.slug.trim().toLowerCase();
      if (!SLUG_RE.test(slug))
        throw new BadRequestException(
          'Slug may only contain lowercase letters, numbers and dashes.',
        );
      const clash = await this.prisma.plan.findUnique({ where: { slug } });
      if (clash && clash.id !== existing?.id)
        throw new ConflictException('A plan with this slug already exists.');
      out.slug = slug;
    }
    if (input.name !== undefined) {
      if (!input.name.trim())
        throw new BadRequestException('Name is required.');
      out.name = input.name.trim().slice(0, 80);
    }
    if (input.type !== undefined) {
      if (!Object.values(PlanType).includes(input.type))
        throw new BadRequestException('Invalid plan type.');
      if (existing && existing.type !== input.type) {
        const used = await this.prisma.subscription.count({
          where: { planId: existing.id },
        });
        if (used)
          throw new BadRequestException(
            'The type of a plan with subscriptions cannot change.',
          );
      }
      out.type = input.type;
    }
    if (input.status !== undefined) {
      if (!Object.values(PlanStatus).includes(input.status))
        throw new BadRequestException('Invalid status.');
      out.status = input.status;
    }
    if (input.ctaAction !== undefined) {
      if (!Object.values(PlanCtaAction).includes(input.ctaAction))
        throw new BadRequestException('Invalid CTA action.');
      out.ctaAction = input.ctaAction;
    }
    if (input.displayOrder !== undefined) {
      if (!Number.isInteger(input.displayOrder))
        throw new BadRequestException('displayOrder must be a whole number.');
      out.displayOrder = input.displayOrder;
    }
    for (const key of ['description', 'badge', 'ctaLabel'] as const) {
      if (input[key] !== undefined)
        out[key] = input[key]
          ? String(input[key])
              .trim()
              .slice(0, key === 'description' ? 500 : 60)
          : null;
    }
    for (const key of ['isPopular', 'isPublic'] as const) {
      if (input[key] !== undefined) out[key] = Boolean(input[key]);
    }
    if (input.assignedUserId !== undefined) {
      if (input.assignedUserId) {
        const user = await this.prisma.user.findUnique({
          where: { id: input.assignedUserId },
          select: { id: true },
        });
        if (!user)
          throw new BadRequestException('Assigned customer not found.');
      }
      out.assignedUserId = input.assignedUserId || null;
    }
    return out;
  }

  private async validateTerms(
    input: PlanTermsInput,
    current: PlanVersion | null,
    type: PlanType | null,
  ): Promise<PlanTermsInput> {
    const out: PlanTermsInput = {};
    const nonNegInt = (name: string, v: unknown) => {
      if (!Number.isInteger(v) || (v as number) < 0)
        throw new BadRequestException(
          `${name} must be a non-negative whole number.`,
        );
      return v as number;
    };
    if (input.pricePaise !== undefined)
      out.pricePaise = nonNegInt('pricePaise', input.pricePaise);
    if (input.includedCredits !== undefined)
      out.includedCredits = nonNegInt('includedCredits', input.includedCredits);
    if (input.intervalCount !== undefined) {
      out.intervalCount = nonNegInt('intervalCount', input.intervalCount);
      if (out.intervalCount < 1)
        throw new BadRequestException('intervalCount must be at least 1.');
    }
    if (input.currency !== undefined) {
      if (!/^[A-Z]{3}$/.test(input.currency))
        throw new BadRequestException('currency must be a 3-letter ISO code.');
      out.currency = input.currency;
    }
    if (input.billingInterval !== undefined) {
      if (!Object.values(BillingInterval).includes(input.billingInterval))
        throw new BadRequestException('Invalid billing interval.');
      out.billingInterval = input.billingInterval;
    }
    for (const key of [
      'includedAudioCredits',
      'includedVideoCredits',
      'includedScreenShareCredits',
    ] as const) {
      if (input[key] !== undefined)
        out[key] = input[key] === null ? null : nonNegInt(key, input[key]);
    }
    if (input.features !== undefined) {
      if (!Array.isArray(input.features))
        throw new BadRequestException(
          'features must be a list of feature keys.',
        );
      const keys = Array.from(
        new Set(input.features.map((f) => String(f).trim().toUpperCase())),
      );
      const known = await this.prisma.feature.findMany({
        where: { key: { in: keys } },
        select: { key: true },
      });
      const unknown = keys.filter((k) => !known.some((f) => f.key === k));
      // Allow seeding before the registry exists (fresh DB), otherwise strict.
      if (unknown.length && (await this.prisma.feature.count()) > 0) {
        throw new BadRequestException(
          `Unknown feature(s): ${unknown.join(', ')}`,
        );
      }
      out.features = keys;
    }

    const price = out.pricePaise ?? current?.pricePaise ?? 0;
    if (type === PlanType.FREE && price !== 0)
      throw new BadRequestException('A Free plan must cost ₹0.');
    if (type === PlanType.PAID && price <= 0)
      throw new BadRequestException('A paid plan needs a price above zero.');
    const interval =
      out.billingInterval ?? current?.billingInterval ?? BillingInterval.MONTH;
    if (type === PlanType.FREE && interval !== BillingInterval.MONTH) {
      throw new BadRequestException(
        'Free plan credits refresh monthly; use a MONTH interval.',
      );
    }
    return out;
  }

  private async assertNotLastFreePlan(plan: Plan, nextStatus: PlanStatus) {
    if (plan.type !== PlanType.FREE || nextStatus === PlanStatus.ACTIVE) return;
    const others = await this.prisma.plan.count({
      where: {
        type: PlanType.FREE,
        status: PlanStatus.ACTIVE,
        id: { not: plan.id },
      },
    });
    if (others === 0) {
      throw new BadRequestException(
        'This is the only active Free plan — every account falls back to it. Activate another Free plan first.',
      );
    }
  }

  private termsDiffer(
    terms: PlanTermsInput,
    current: PlanVersion | null,
  ): boolean {
    if (!current) return true;
    return TERM_FIELDS.some((key) => {
      if (terms[key] === undefined) return false;
      const a = terms[key];
      const b = (current as Record<string, unknown>)[key];
      if (key === 'features') {
        const x = [...((a as string[]) ?? [])].sort();
        const y = [...((b as string[]) ?? [])].sort();
        return JSON.stringify(x) !== JSON.stringify(y);
      }
      return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
    });
  }

  private versionToTerms(v: PlanVersion | null): PlanTermsInput {
    if (!v) return {};
    return {
      pricePaise: v.pricePaise,
      currency: v.currency,
      billingInterval: v.billingInterval,
      intervalCount: v.intervalCount,
      includedCredits: v.includedCredits,
      includedAudioCredits: v.includedAudioCredits,
      includedVideoCredits: v.includedVideoCredits,
      includedScreenShareCredits: v.includedScreenShareCredits,
      features: v.features,
    };
  }

  private termsData(t: PlanTermsInput) {
    return {
      pricePaise: t.pricePaise ?? 0,
      currency: t.currency ?? 'INR',
      billingInterval: t.billingInterval ?? BillingInterval.MONTH,
      intervalCount: t.intervalCount ?? 1,
      includedCredits: t.includedCredits ?? 0,
      includedAudioCredits: t.includedAudioCredits ?? null,
      includedVideoCredits: t.includedVideoCredits ?? null,
      includedScreenShareCredits: t.includedScreenShareCredits ?? null,
      features: t.features ?? [],
    };
  }
}
