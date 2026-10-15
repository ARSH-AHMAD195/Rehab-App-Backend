import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import { AppModule } from './app.module';
import { validationExceptionFactory } from './common/validation-exception.factory';
import { FirebaseIdentityProvider } from './identity/firebase-identity.provider';

async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api/v1');
  app.use(json({ limit: '16kb' }));
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
  app.get(FirebaseIdentityProvider).assertConfigured();

  if (config.get<string>('SWAGGER_ENABLED', 'true') === 'true') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Fit for Surgery - Auth & User Management API')
        .setDescription(
          'Implements Auth & User Management API reference v1.0 (15 Oct 2026): registration, ' +
            'profiles, medical profile and role-based access. Login itself happens in the app with Firebase.',
        )
        .setVersion('1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Firebase ID token' })
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3001);
  await app.listen(port);
  logger.log(`Auth API listening on :${port} (docs at /api/docs)`);
}

void bootstrap();
