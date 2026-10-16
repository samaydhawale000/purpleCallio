import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';

import { PrismaService } from '../../prisma/prisma.service';
import { resolvePermissions, tabForPath } from '../admin-access';

/**
 * Verifies the JWT and additionally checks that the authenticated
 * user has an ADMIN role.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authHeader = request.headers['authorization'] as string | undefined;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Admin token required');
    }

    const token = authHeader.slice('Bearer '.length).trim();

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid admin token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }

    // Per-tab access: reads need READ or WRITE, anything else needs WRITE.
    const tab = tabForPath(request.originalUrl ?? request.url ?? '');
    if (tab) {
      const level = resolvePermissions(user.adminPermissions)[tab];
      const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);
      if (!level || (!isRead && level !== 'WRITE')) {
        throw new ForbiddenException(isRead ? 'No access to this section' : 'Read-only access to this section');
      }
    }

    request.user = { userId: user.id, role: user.role };
    return true;
  }
}
