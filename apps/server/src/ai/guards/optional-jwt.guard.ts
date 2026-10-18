import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Like JwtGuard, but lets anonymous requests through with req.user = null. */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_err: unknown, user: TUser): TUser | null {
    return user || null;
  }
}
