import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Never rejects. When a valid dashboard JWT is present, sets
 * `request.user = { userId }` (same shape as JwtGuard); otherwise leaves it
 * unset. Used by public endpoints that personalise for signed-in users.
 */
@Injectable()
export class OptionalJwtGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers?.['authorization'] as string | undefined;
    if (!header?.startsWith('Bearer ')) return true;
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) return true;
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string }>(
        header.slice(7).trim(),
        { secret },
      );
      if (payload?.sub) request.user = { userId: payload.sub };
    } catch {
      // Invalid/expired token on a public endpoint: treat as anonymous.
    }
    return true;
  }
}
