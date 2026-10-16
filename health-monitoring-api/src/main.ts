import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import { AppModule } from './app.module';
import { MAX_BODY_SIZE } from './common/constants';
import { validationExceptionFactory } from './common/validation-exception.factory';
import { FirebaseTokenVerifier } from './auth/firebase-token-verifier';

async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  // v1.1 Conventions: Base URL /api/v1.
  app.setGlobalPrefix('api/v1');

  // Rate limits, v1.1: "Size of one PUT - 13 readings at most, request body up
  // to 16 KB." The reading count is checked by the validator.
  app.use(json({ limit: MAX_BODY_SIZE }));

  // Needed for the per-IP rate limit behind a load balancer.
  app.set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // Fail the boot, not the first request, when Firebase is misconfigured.
  app.get(FirebaseTokenVerifier).assertConfigured();

  // Off unless asked for: the docs page is plain Express middleware, outside
  // the auth guard, so leaving it on would publish the API to anyone.
  const docsEnabled = config.get<string>('SWAGGER_ENABLED', 'false') === 'true';
  if (docsEnabled) {
    // v1.1 Conventions: "Docs - Swagger UI at /api/docs".
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Fit for Surgery - Health Monitoring API')
        .setDescription(
          'Implements Health Monitoring API reference v1.1 (13 Oct 2026): one editable health ' +
            'log per patient per day, with a status for each reading and for the day.',
        )
        .setVersion('1.1')
        .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Firebase ID token' })
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`Health Monitoring API listening on :${port}${docsEnabled ? ' (docs at /api/docs)' : ''}`);
}

void bootstrap();
