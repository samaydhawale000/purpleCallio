import { ValidationPipe } from '@nestjs/common';

import { NestFactory } from '@nestjs/core';
import type { Express } from 'express';

import { AppModule } from './app.module';
import { corsOriginCallback } from './common/config/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // The API is behind the repository's Nginx reverse proxy in production.
  // Nginx overwrites X-Forwarded-For with the actual peer address.
  const httpServer = app.getHttpAdapter().getInstance() as Express;
  httpServer.set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
    }),
  );

  app.enableCors({
    origin: corsOriginCallback,
    // Browser SDKs authenticate with scoped bearer/API credentials. Do not
    // permit ambient cookies across arbitrary customer origins.
    credentials: false,
  });

  await app.listen(process.env.PORT || 3005);
}

void bootstrap();
