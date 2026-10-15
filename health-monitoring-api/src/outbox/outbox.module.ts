import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EVENT_PUBLISHER, LoggingEventPublisher } from './event-publisher';
import { OutboxEvent, OutboxEventSchema } from './outbox-event.schema';
import { OutboxPublisherService } from './outbox-publisher.service';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: OutboxEvent.name, schema: OutboxEventSchema }])],
  providers: [
    OutboxService,
    OutboxPublisherService,
    { provide: EVENT_PUBLISHER, useClass: LoggingEventPublisher },
  ],
  exports: [OutboxService, OutboxPublisherService, MongooseModule],
})
export class OutboxModule {}
