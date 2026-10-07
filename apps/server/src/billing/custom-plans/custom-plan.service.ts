import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingInterval,
  CustomPlanOfferStatus,
  CustomPlanRequestStatus,
  Prisma,
  SupportTicketType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SupportService } from '../../support/support.service';
import { BillingAuditService } from '../billing-audit.service';
import { BillingNotificationService } from '../billing-notification.service';
import { CreditService } from '../credits/credit.service';
import { PlanService, serializePlan } from '../plans/plan.service';
import { SubscriptionService } from '../subscriptions/subscription.service';

export const CUSTOM_PLAN_SUBJECT = 'Custom plan request';

export const CUSTOM_PLAN_INITIAL_MESSAGE = `Hi PurpleCallio Team,

I'm interested in a custom plan for my organization.

I'd like to discuss custom pricing, usage limits, infrastructure requirements, and the features available for our use case.

Please help me choose the right plan.`;

const OPEN_STATUSES: CustomPlanRequestStatus[] = [
  CustomPlanRequestStatus.NEW,
  CustomPlanRequestStatus.CONTACTED,
  CustomPlanRequestStatus.NEGOTIATING,
  CustomPlanRequestStatus.PROPOSAL_SENT,
];

export interface CustomOfferInput {
  name: string;
  description?: string | null;
  pricePaise: number;
  currency?: string;
  billingInterval?: BillingInterval;
  intervalCount?: number;
  includedCredits: number;
  includedAudioCredits?: number | null;
  includedVideoCredits?: number | null;
  includedScreenShareCredits?: number | null;
  features?: string[];
  message?: string | null;
  expiresAt?: string | null;
}

/**
 * Custom / enterprise plans. A request is a normal support conversation
 * (SupportTicket of type CUSTOM_PLAN) plus structured sales metadata. An
 * offer is a private Plan assigned to one customer; accepting it goes
 * through regular checkout and only activates after verified payment.
 */
@Injectable()
export class CustomPlanService {
  private readonly logger = new Logger(CustomPlanService.name);

  constructor(
    private prisma: PrismaService,
    private support: SupportService,
    private plans: PlanService,
    private subscriptions: SubscriptionService,
    private credits: CreditService,
    private audit: BillingAuditService,
    private notify: BillingNotificationService,
  ) {}

  // ── Customer ─────────────────────────────────────────────
  /**
   * Opens a custom-plan conversation with a predefined first message, or
   * returns the customer's existing open one. Enforced server-side: the
   * user row is locked so two concurrent clicks can't both create one.
   */
  async requestCustomPlan(userId: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const open = await tx.customPlanRequest.findFirst({
        where: { userId, status: { in: OPEN_STATUSES } },
        orderBy: { requestedAt: 'desc' },
      });
      if (open) return { request: open, created: false };

      const ticket = await this.support.createTicketRecord(
        tx,
        userId,
        { subject: CUSTOM_PLAN_SUBJECT, message: CUSTOM_PLAN_INITIAL_MESSAGE },
        SupportTicketType.CUSTOM_PLAN,
      );
      const request = await tx.customPlanRequest.create({
        data: { userId, ticketId: ticket.id },
      });
      return { request, created: true };
    });

    if (outcome.created) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true, companyName: true },
      });
      await this.notify.customPlanRequested(
        userId,
        outcome.request.ticketId,
        outcome.request.id,
        user?.name || user?.email || 'A customer',
        user?.companyName ?? null,
      );
      await this.audit.log({
        action: 'CUSTOM_PLAN_REQUESTED',
        actorId: userId,
        entity: 'CustomPlanRequest',
        entityId: outcome.request.id,
        newValue: { ticketId: outcome.request.ticketId },
      });
      this.support.broadcastTicket(outcome.request.ticketId, userId);
    }
    return {
      ...(await this.getCustomerRequest(userId, outcome.request.id)),
      created: outcome.created,
    };
  }

  /** The customer's most recent request (open or not) and its offers. */
  async getCustomerRequest(userId: string, requestId?: string) {
    const request = await this.prisma.customPlanRequest.findFirst({
      where: { userId, ...(requestId ? { id: requestId } : {}) },
      orderBy: { requestedAt: 'desc' },
      include: {
        ticket: { select: { id: true, ticketNumber: true, status: true } },
      },
    });
    if (!request)
      return { request: null, offers: await this.listCustomerOffers(userId) };
    return {
      request: {
        id: request.id,
        status: request.status,
        requestedAt: request.requestedAt,
        ticketId: request.ticketId,
        ticketNumber: `PC-${request.ticket.ticketNumber}`,
        open: OPEN_STATUSES.includes(request.status),
      },
      offers: await this.listCustomerOffers(userId),
    };
  }

  async listCustomerOffers(userId: string) {
    const offers = await this.prisma.customPlanOffer.findMany({
      where: {
        userId,
        status: {
          in: [CustomPlanOfferStatus.SENT, CustomPlanOfferStatus.ACCEPTED],
        },
      },
      include: { plan: true, planVersion: true },
      orderBy: { createdAt: 'desc' },
    });
    return offers.map((o) => this.serializeOffer(o));
  }

  async getCustomerOffer(userId: string, offerId: string) {
    const offer = await this.prisma.customPlanOffer.findFirst({
      where: { id: offerId, userId },
      include: { plan: true, planVersion: true },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    return this.serializeOffer(offer);
  }

  private serializeOffer(
    o: Prisma.CustomPlanOfferGetPayload<{
      include: { plan: true; planVersion: true };
    }>,
  ) {
    const expired =
      o.status === CustomPlanOfferStatus.SENT &&
      !!o.expiresAt &&
      o.expiresAt < new Date();
    return {
      id: o.id,
      status: expired ? CustomPlanOfferStatus.EXPIRED : o.status,
      message: o.message,
      expiresAt: o.expiresAt,
      acceptedAt: o.acceptedAt,
      createdAt: o.createdAt,
      requestId: o.requestId,
      plan: serializePlan({ ...o.plan, currentVersion: o.planVersion }),
    };
  }

  // ── Admin ─────────────────────────────────────────────────
  async listForAdmin(params: {
    page?: string;
    status?: string;
    search?: string;
  }) {
    const page = Math.max(1, parseInt(params.page ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );
    const where: Prisma.CustomPlanRequestWhereInput = {};
    if (params.status === 'OPEN') where.status = { in: OPEN_STATUSES };
    else if (
      params.status &&
      (Object.values(CustomPlanRequestStatus) as string[]).includes(
        params.status,
      )
    ) {
      where.status = params.status as CustomPlanRequestStatus;
    }
    const search = params.search?.trim();
    if (search) {
      where.user = {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { companyName: { contains: search, mode: 'insensitive' } },
        ],
      };
    }
    const [total, data] = await Promise.all([
      this.prisma.customPlanRequest.count({ where }),
      this.prisma.customPlanRequest.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: { id: true, name: true, email: true, companyName: true },
          },
          assignedAdmin: { select: { id: true, name: true, email: true } },
          ticket: {
            select: {
              id: true,
              ticketNumber: true,
              status: true,
              lastCustomerMessageAt: true,
              adminLastReadAt: true,
            },
          },
          _count: { select: { offers: true } },
        },
      }),
    ]);
    return {
      data: data.map((r) => ({
        id: r.id,
        status: r.status,
        requestedAt: r.requestedAt,
        updatedAt: r.updatedAt,
        customer: r.user,
        assignedAdmin: r.assignedAdmin,
        ticketId: r.ticketId,
        ticketNumber: `PC-${r.ticket.ticketNumber}`,
        ticketStatus: r.ticket.status,
        hasUnread:
          !!r.ticket.lastCustomerMessageAt &&
          (!r.ticket.adminLastReadAt ||
            r.ticket.lastCustomerMessageAt > r.ticket.adminLastReadAt),
        offers: r._count.offers,
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Everything sales needs on one screen: customer, plan, credits, usage, payments, offers. */
  async getForAdmin(id: string) {
    const request = await this.prisma.customPlanRequest.findUnique({
      where: { id },
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
            expectedUsageRange: true,
            primaryUseCase: true,
            createdAt: true,
          },
        },
        assignedAdmin: { select: { id: true, name: true, email: true } },
        ticket: { select: { id: true, ticketNumber: true, status: true } },
        offers: {
          include: { plan: true, planVersion: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!request) throw new NotFoundException('Custom plan request not found');

    const userId = request.userId;
    const sub = await this.subscriptions.getActiveSubscription(userId);
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const [wallet, usage30, payments] = await Promise.all([
      this.credits.getSummary(userId, sub.currentPeriodStart),
      this.prisma.callUsage.aggregate({
        where: { usage: { companyId: userId }, createdAt: { gte: since30 } },
        _sum: {
          audioMinutes: true,
          videoMinutes: true,
          screenShareMinutes: true,
          creditsCharged: true,
        },
        _count: true,
      }),
      this.prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          purpose: true,
          paymentStatus: true,
          amount: true,
          description: true,
          paidAt: true,
          createdAt: true,
          receiptNumber: true,
        },
      }),
    ]);

    return {
      id: request.id,
      status: request.status,
      notes: request.notes,
      estimatedMonthlyCredits: request.estimatedMonthlyCredits,
      requestedAt: request.requestedAt,
      closedAt: request.closedAt,
      customer: request.user,
      assignedAdmin: request.assignedAdmin,
      ticket: {
        id: request.ticket.id,
        ticketNumber: `PC-${request.ticket.ticketNumber}`,
        status: request.ticket.status,
      },
      subscription: this.subscriptions.serialize(sub),
      wallet,
      usageLast30Days: {
        calls: usage30._count,
        audioMinutes: usage30._sum.audioMinutes ?? 0,
        videoMinutes: usage30._sum.videoMinutes ?? 0,
        screenShareMinutes: usage30._sum.screenShareMinutes ?? 0,
        credits: usage30._sum.creditsCharged ?? 0,
      },
      payments,
      offers: request.offers.map((o) => this.serializeOffer(o)),
    };
  }

  async updateRequest(
    id: string,
    input: {
      status?: CustomPlanRequestStatus;
      assignedAdminId?: string | null;
      notes?: string | null;
      estimatedMonthlyCredits?: number | null;
    },
    actorId: string,
  ) {
    const before = await this.prisma.customPlanRequest.findUnique({
      where: { id },
    });
    if (!before) throw new NotFoundException('Custom plan request not found');
    const data: Prisma.CustomPlanRequestUncheckedUpdateInput = {};
    if (input.status !== undefined) {
      if (!Object.values(CustomPlanRequestStatus).includes(input.status))
        throw new BadRequestException('Invalid status.');
      data.status = input.status;
      data.closedAt = OPEN_STATUSES.includes(input.status) ? null : new Date();
    }
    if (input.assignedAdminId !== undefined) {
      if (input.assignedAdminId) {
        const admin = await this.prisma.user.findFirst({
          where: { id: input.assignedAdminId, role: 'ADMIN' },
          select: { id: true },
        });
        if (!admin) throw new BadRequestException('Assignee must be an admin.');
      }
      data.assignedAdminId = input.assignedAdminId || null;
    }
    if (input.notes !== undefined)
      data.notes = input.notes?.slice(0, 5000) || null;
    if (input.estimatedMonthlyCredits !== undefined) {
      if (
        input.estimatedMonthlyCredits !== null &&
        (!Number.isInteger(input.estimatedMonthlyCredits) ||
          input.estimatedMonthlyCredits < 0)
      ) {
        throw new BadRequestException(
          'estimatedMonthlyCredits must be a non-negative whole number.',
        );
      }
      data.estimatedMonthlyCredits = input.estimatedMonthlyCredits;
    }
    const updated = await this.prisma.customPlanRequest.update({
      where: { id },
      data,
    });
    await this.audit.log({
      action: 'CUSTOM_PLAN_REQUEST_UPDATED',
      actorId,
      entity: 'CustomPlanRequest',
      entityId: id,
      oldValue: {
        status: before.status,
        assignedAdminId: before.assignedAdminId,
      },
      newValue: {
        status: updated.status,
        assignedAdminId: updated.assignedAdminId,
      },
    });
    return this.getForAdmin(id);
  }

  /**
   * Creates a private custom plan for the customer and an offer for it,
   * posts a message into the conversation and notifies the customer.
   * Nothing is activated until the customer accepts and pays.
   */
  async createOffer(
    requestId: string,
    input: CustomOfferInput,
    actorId: string,
  ) {
    const request = await this.prisma.customPlanRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Custom plan request not found');
    if (!input?.name?.trim())
      throw new BadRequestException('Plan name is required.');
    if (!Number.isInteger(input.pricePaise) || input.pricePaise < 100) {
      throw new BadRequestException('Custom plan price must be at least ₹1.');
    }
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (
      expiresAt &&
      (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())
    ) {
      throw new BadRequestException('Offer expiry must be a future date.');
    }

    const slugBase = `custom-${
      input.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30) || 'plan'
    }`;
    const slug = `${slugBase}-${Date.now().toString(36)}`;
    const plan = await this.plans.createPlan(
      {
        slug,
        name: input.name.trim(),
        description: input.description ?? null,
        type: 'CUSTOM',
        status: 'ACTIVE',
        isPublic: false,
        assignedUserId: request.userId,
        ctaAction: 'CHECKOUT',
        ctaLabel: 'Accept & pay',
        displayOrder: 100,
        pricePaise: input.pricePaise,
        currency: input.currency ?? 'INR',
        billingInterval: input.billingInterval ?? 'MONTH',
        intervalCount: input.intervalCount ?? 1,
        includedCredits: input.includedCredits,
        includedAudioCredits: input.includedAudioCredits ?? null,
        includedVideoCredits: input.includedVideoCredits ?? null,
        includedScreenShareCredits: input.includedScreenShareCredits ?? null,
        features: input.features ?? [],
      },
      actorId,
    );

    const offer = await this.prisma.$transaction(async (tx) => {
      // A new proposal supersedes any still-open one for this request.
      await tx.customPlanOffer.updateMany({
        where: { requestId, status: CustomPlanOfferStatus.SENT },
        data: { status: CustomPlanOfferStatus.WITHDRAWN },
      });
      const created = await tx.customPlanOffer.create({
        data: {
          requestId,
          userId: request.userId,
          planId: plan.id,
          planVersionId: plan.version!.id,
          message: input.message?.trim().slice(0, 2000) || null,
          expiresAt,
          createdById: actorId,
        },
      });
      await tx.customPlanRequest.update({
        where: { id: requestId },
        data: { status: CustomPlanRequestStatus.PROPOSAL_SENT, closedAt: null },
      });
      return created;
    });

    const price = `₹${(input.pricePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    await this.support
      .addAdminMessage(
        actorId,
        request.ticketId,
        `We've prepared a custom plan for you: "${plan.name}" — ${price} per ${plan.version?.billingInterval === 'YEAR' ? 'year' : plan.version?.billingInterval === 'CUSTOM' ? `${plan.version?.intervalCount} days` : 'month'} with ${input.includedCredits.toLocaleString('en-IN')} credits.${input.message ? `\n\n${input.message.trim()}` : ''}\n\nReview it and accept it from Billing → Custom plan offer (/dashboard/billing/offers/${offer.id}). Your plan activates as soon as payment is confirmed.`,
      )
      .catch((err) =>
        this.logger.warn(`Could not post offer message: ${String(err)}`),
      );
    await this.notify.customPlanOffer(request.userId, offer.id, plan.name);
    await this.audit.log({
      action: 'CUSTOM_PLAN_OFFER_CREATED',
      actorId,
      entity: 'CustomPlanOffer',
      entityId: offer.id,
      newValue: {
        planId: plan.id,
        planVersionId: plan.version?.id,
        pricePaise: input.pricePaise,
        includedCredits: input.includedCredits,
        expiresAt,
      },
      extra: { requestId, customerId: request.userId },
    });
    return this.getForAdmin(requestId);
  }

  async withdrawOffer(offerId: string, actorId: string) {
    const offer = await this.prisma.customPlanOffer.findUnique({
      where: { id: offerId },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.status !== CustomPlanOfferStatus.SENT)
      throw new BadRequestException('Only open offers can be withdrawn.');
    await this.prisma.customPlanOffer.update({
      where: { id: offerId },
      data: { status: CustomPlanOfferStatus.WITHDRAWN },
    });
    await this.audit.log({
      action: 'CUSTOM_PLAN_OFFER_WITHDRAWN',
      actorId,
      entity: 'CustomPlanOffer',
      entityId: offerId,
    });
    return offer.requestId
      ? this.getForAdmin(offer.requestId)
      : { withdrawn: true };
  }
}
