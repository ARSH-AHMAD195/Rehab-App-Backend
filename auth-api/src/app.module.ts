import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { RATE_LIMITS } from './common/constants';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { FirebaseAuthGuard } from './common/guards/firebase-auth.guard';
import { EmailVerifiedGuard } from './common/guards/email-verified.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { IpThrottlerGuard, UserThrottlerGuard } from './common/throttler/scoped-throttler.guard';
import { MongoSupportModule } from './common/mongo/mongo.module';
import { AuditModule } from './audit/audit.module';
import { IdentityModule } from './identity/identity.module';
import { UsersModule } from './users/users.module';
import { RegistrationModule } from './registration/registration.module';
import { MeModule } from './me/me.module';
import { DoctorsModule } from './doctors/doctors.module';
import { MedicalProfilesModule } from './medical-profiles/medical-profiles.module';
import { PatientsModule } from './patients/patients.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ uri: config.getOrThrow<string>('MONGODB_URI') }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        // 120 requests per minute per user, narrowed to 20 on registration.
        { name: RATE_LIMITS.USER.name, limit: RATE_LIMITS.USER.limit, ttl: RATE_LIMITS.USER.ttl },
        // 300 requests per minute per IP address, on any route.
        { name: RATE_LIMITS.IP.name, limit: RATE_LIMITS.IP.limit, ttl: RATE_LIMITS.IP.ttl },
      ],
    }),

    MongoSupportModule,
    AuditModule,
    IdentityModule,
    UsersModule,
    RegistrationModule,

    MeModule,
    DoctorsModule,
    // Before PatientsModule, so /patients/me/medical-profile is matched first.
    MedicalProfilesModule,
    PatientsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Global guards run in the order registered here:
    //  1. the per-IP limit, before any token work, so a flood of bad tokens
    //     never reaches Firebase;
    //  2. authentication;
    //  3. email verified (skipped only on GET /auth/me);
    //  4. the role check;
    //  5. the per-user limits, keyed on the identity from step 2.
    { provide: APP_GUARD, useClass: IpThrottlerGuard },
    { provide: APP_GUARD, useClass: FirebaseAuthGuard },
    { provide: APP_GUARD, useClass: EmailVerifiedGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
