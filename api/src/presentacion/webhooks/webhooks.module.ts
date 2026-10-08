import { Module } from '@nestjs/common';
import {
  DespachadorWebhooksService,
  WEBHOOKS_CIFRADOR,
  WEBHOOKS_REPOSITORIO,
} from '../../aplicacion/webhooks/despachador-webhooks.service';
import { CifradorTotpAesGcm } from '../../infraestructura/auth/cifrador-totp.aes-gcm';
import { WebhooksRepositorioDrizzle } from '../../infraestructura/webhooks/webhooks.repositorio.drizzle';

@Module({
  providers: [
    DespachadorWebhooksService,
    { provide: WEBHOOKS_REPOSITORIO, useClass: WebhooksRepositorioDrizzle },
    { provide: WEBHOOKS_CIFRADOR, useClass: CifradorTotpAesGcm },
  ],
  exports: [DespachadorWebhooksService],
})
export class WebhooksModule {}
