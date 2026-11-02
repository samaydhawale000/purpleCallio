import {
  Body,
  Controller,
  HttpCode,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuthService } from './auth.service';
import { PasswordAuthService } from './password-auth.service';

import { GoogleDto } from './dto/google.dto';
import { RefreshDto } from './dto/refresh.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyRegistrationDto,
} from './dto/password-auth.dto';

import { JwtGuard } from './guards/jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordAuth: PasswordAuthService,
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

  // ── Email + password ──────────────────────────────────
  // Sign-up: emails a code; the account is created by register/verify.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.passwordAuth.register(body);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('register/verify')
  verifyRegistration(@Body() body: VerifyRegistrationDto) {
    return this.passwordAuth.verifyRegistration(body.email, body.code);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() body: LoginDto) {
    return this.passwordAuth.login(body.email, body.password);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  @Post('password/forgot')
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.passwordAuth.forgotPassword(body.email);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('password/reset')
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.passwordAuth.resetPassword(body.email, body.code, body.password);
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
