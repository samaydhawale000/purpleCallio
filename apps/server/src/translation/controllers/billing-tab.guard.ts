import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { resolvePermissions } from '../../admin/admin-access';

/**
 * Runs after AdminGuard. /admin/translation/* is pricing, so it follows the
 * Billing tab's permission (reads need READ or WRITE, changes need WRITE),
 * like /admin/billing/*. AdminGuard alone would let any admin through
 * because the path has no tab mapping.
 */
@Injectable()
export class BillingTabGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId as string | undefined;
    if (!userId) throw new ForbiddenException('Admin access required');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { adminPermissions: true },
    });
    const level = resolvePermissions(user?.adminPermissions ?? null).billing;
    const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (!level || (!isRead && level !== 'WRITE')) {
      throw new ForbiddenException(
        isRead ? 'No access to this section' : 'Read-only access to this section',
      );
    }
    return true;
  }
}
