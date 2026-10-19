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

  app.setGlobalPrefix('api/v1');
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
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Fit for Surgery - Exercise API')
        .setDescription('Exercise library, plans, daily checklist and completions. See docs/EXERCISE_API_REFERENCE.md.')
        .setVersion('0.1')
        .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Firebase ID token' })
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3002);
  await app.listen(port);
  logger.log(`Exercise API listening on :${port}${docsEnabled ? ' (docs at /api/docs)' : ''}`);
}

void bootstrap();
