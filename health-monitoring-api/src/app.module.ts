import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { RATE_LIMITS } from './common/constants';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { FirebaseAuthGuard } from './common/guards/firebase-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import {
  IpThrottlerGuard,
  UserThrottlerGuard,
} from './common/throttler/scoped-throttler.guard';
import { MongoSupportModule } from './common/mongo/mongo.module';
import { AuditModule } from './audit/audit.module';
import { OutboxModule } from './outbox/outbox.module';
import { TimeModule } from './time/time.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { VitalTypesModule } from './vital-types/vital-types.module';
import { ThresholdsModule } from './thresholds/thresholds.module';
import { AlertsModule } from './alerts/alerts.module';
import { DailyLogsModule } from './daily-logs/daily-logs.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        // 120 requests per minute per user, narrowed to 30 on the save route.
        { name: RATE_LIMITS.USER.name, limit: RATE_LIMITS.USER.limit, ttl: RATE_LIMITS.USER.ttl },
        // 300 requests per minute per IP address, on any route.
        { name: RATE_LIMITS.IP.name, limit: RATE_LIMITS.IP.limit, ttl: RATE_LIMITS.IP.ttl },
      ],
    }),

    TimeModule,
    MongoSupportModule,
    AuditModule,
    OutboxModule,
    AuthModule,
    UsersModule,

    VitalTypesModule,
    ThresholdsModule,
    AlertsModule,
    DailyLogsModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters, and global guards run in the order registered here:
    //  1. the per-IP limit, before any token work, so a flood of bad tokens
    //     never reaches Firebase;
    //  2. authentication, which the next two both need;
    //  3. the role check;
    //  4. the per-user limits, keyed on the identity from step 2.
    { provide: APP_GUARD, useClass: IpThrottlerGuard },
    { provide: APP_GUARD, useClass: FirebaseAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
