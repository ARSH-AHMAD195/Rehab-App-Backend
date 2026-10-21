import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IdempotencyKey, IdempotencyKeySchema } from './idempotency-key.schema';
import { IdempotencyService } from './idempotency.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: IdempotencyKey.name, schema: IdempotencyKeySchema }])],
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
