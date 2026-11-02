import { Module } from '@nestjs/common';

import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller';

import { AuthService } from './auth.service';

import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthMeController } from './auth.me.controller';
import { BillingModule } from '../billing/billing.module';
import { MailModule } from '../mail/mail.module';
import { PasswordAuthService } from './password-auth.service';
import { EmailOtpService } from './email-otp.service';

@Module({
  imports: [
    JwtModule.register({}),
    BillingModule,
    MailModule,
  ],

  controllers: [
    AuthController,
      AuthMeController,
  ],

  providers: [
    AuthService,
    PasswordAuthService,
    EmailOtpService,
    JwtStrategy,
  ],

  exports: [
    AuthService,
  ],
})
export class AuthModule {}