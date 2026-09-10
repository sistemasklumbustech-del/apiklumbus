import { Module } from '@nestjs/common';
import {
  DespachadorWebhooksService,
  WEBHOOKS_REPOSITORIO,
} from '../../aplicacion/webhooks/despachador-webhooks.service';
import { WebhooksRepositorioDrizzle } from '../../infraestructura/webhooks/webhooks.repositorio.drizzle';

@Module({
  providers: [
    DespachadorWebhooksService,
    { provide: WEBHOOKS_REPOSITORIO, useClass: WebhooksRepositorioDrizzle },
  ],
  exports: [DespachadorWebhooksService],
})
export class WebhooksModule {}
