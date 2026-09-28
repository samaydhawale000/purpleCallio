import {
  Controller,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtGuard } from './guards/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PROFILE_SELECT, toUserProfile } from './user-profile';

@Controller('auth')
export class AuthMeController {
  constructor(private prisma: PrismaService) {}

  @UseGuards(JwtGuard)
  @Get('me')
  async me(@Req() req: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: PROFILE_SELECT,
    });

    if (!user) {
      return { userId: req.user.userId };
    }

    const { id, ...profile } = toUserProfile(user);
    return {
      userId: id,
      ...profile,
      onboardingRequired: !profile.profileCompleted,
    };
  }
}
