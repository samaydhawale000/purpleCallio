import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { UsageBillingService } from '../../billing/usage-billing.service';

/**
 * Billing guard for call creation (prepaid credits).
 *
 * Runs after the ApiKeyGuard (which sets `request.project`). Verifies the
 * project owner's account is not suspended and — for call-creation
 * requests carrying a media `type` — that their plan and credit balance
 * allow a new call (EntitlementService.canStartCall via UsageBillingService).
 * Active calls are never interrupted, only new ones.
 *
 * CallService applies the same rule for calls created outside this guarded
 * HTTP path (e.g. the playground), so the two can never disagree.
 */
@Injectable()
export class BillingGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private usageBilling: UsageBillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const project = request.project;
    if (!project?.ownerId) {
      throw new ForbiddenException('No project context for billing check');
    }

    const ownerId = project.ownerId;

    // 1. Account suspended?
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { status: true },
    });
    if (!owner) {
      throw new ForbiddenException('Account not found');
    }
    if (owner.status === 'SUSPENDED') {
      throw new ForbiddenException(
        'Account is suspended. Please contact support to resume service.',
      );
    }

    // 2. Plan + credit eligibility, per media type.
    const type = request.body?.type;
    if (type === 'AUDIO' || type === 'VIDEO') {
      const eligibility = await this.usageBilling.canStartCall(ownerId, type);
      if (!eligibility.allowed) {
        throw new ForbiddenException(eligibility.reason);
      }
      request.billing = {
        ownerId,
        availableCredits: eligibility.availableCredits ?? null,
      };
    } else {
      request.billing = { ownerId };
    }
    return true;
  }
}
