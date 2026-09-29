import {
  Body,
  Controller,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuthService } from './auth.service';

import { GoogleDto } from './dto/google.dto';
import { RefreshDto } from './dto/refresh.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

import { JwtGuard } from './guards/jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  // Stricter than the global default — this is the credential-stuffing /
  // token-guessing surface.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('google')
  google(
    @Body() body: GoogleDto,
  ) {
    return this.authService.loginWithGoogle(
      body.idToken,
    );
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  refresh(
    @Body() body: RefreshDto,
  ) {
    return this.authService.refreshToken(
      body.refreshToken,
    );
  }

  @UseGuards(JwtGuard)
  @Post('logout')
  logout(
    @Req() req: any,
  ) {
    return this.authService.logout(
      req.user.userId,
    );
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtGuard)
  @Post('phone')
  setPhone(
    @Req() req: any,
    @Body() body: { phone: string },
  ) {
    return this.authService.setPhone(
      req.user.userId,
      body.phone,
    );
  }

  // Onboarding / profile completion. The user is always the JWT subject —
  // never an id from the request body.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtGuard)
  @Patch('profile')
  updateProfile(
    @Req() req: any,
    @Body() body: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(
      req.user.userId,
      body,
    );
  }
}
