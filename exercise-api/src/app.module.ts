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
import { IpThrottlerGuard, UserThrottlerGuard } from './common/throttler/scoped-throttler.guard';
import { MongoSupportModule } from './common/mongo/mongo.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { ExercisesModule } from './exercises/exercises.module';

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
        { name: RATE_LIMITS.USER.name, limit: RATE_LIMITS.USER.limit, ttl: RATE_LIMITS.USER.ttl },
        { name: RATE_LIMITS.IP.name, limit: RATE_LIMITS.IP.limit, ttl: RATE_LIMITS.IP.ttl },
      ],
    }),

    MongoSupportModule,
    AuditModule,
    AuthModule,
    UsersModule,

    CategoriesModule,
    ExercisesModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Global guards run in the order registered here, same as Health Monitoring:
    //  1. the per-IP limit, before any token work;
    //  2. authentication, which the next two both need;
    //  3. the role check;
    //  4. the per-user limit, keyed on the identity from step 2.
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
