import { Global, Module } from '@nestjs/common';
import { NotificacionesPushController } from './notificaciones-push.controller';
import {
  DISPOSITIVOS_PUSH_REPOSITORIO,
  ENVIADOR_PUSH,
  NotificacionesPushService,
} from '../../aplicacion/notificaciones-push/notificaciones-push.service';
import { DispositivosPushRepositorioDrizzle } from '../../infraestructura/notificaciones-push/dispositivos-push.repositorio.drizzle';
import { ExpoEnviadorPush } from '../../infraestructura/notificaciones-push/expo.enviador-push';

/**
 * Global a propósito (mismo criterio que AuditoriaModule): avisan por push servicios de varios
 * módulos (compras, reclamos, notificaciones programadas) y ninguno debe importar este módulo.
 */
@Global()
@Module({
  controllers: [NotificacionesPushController],
  providers: [
    NotificacionesPushService,
    {
      provide: DISPOSITIVOS_PUSH_REPOSITORIO,
      useClass: DispositivosPushRepositorioDrizzle,
    },
    { provide: ENVIADOR_PUSH, useClass: ExpoEnviadorPush },
  ],
  exports: [NotificacionesPushService],
})
export class NotificacionesPushModule {}
