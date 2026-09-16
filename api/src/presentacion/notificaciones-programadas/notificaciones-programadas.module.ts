import { Module } from '@nestjs/common';
import {
  NotificacionesProgramadasService,
  NOTIFICACIONES_PROGRAMADAS_REPOSITORIO,
  NOTIFICADOR_WHATSAPP,
} from '../../aplicacion/notificaciones-programadas/notificaciones-programadas.service';
import { NotificacionesProgramadasRepositorioDrizzle } from '../../infraestructura/notificaciones-programadas/notificaciones-programadas.repositorio.drizzle';
import { TwilioNotificadorWhatsApp } from '../../infraestructura/notificaciones/twilio.notificador.whatsapp';

@Module({
  providers: [
    NotificacionesProgramadasService,
    {
      provide: NOTIFICACIONES_PROGRAMADAS_REPOSITORIO,
      useClass: NotificacionesProgramadasRepositorioDrizzle,
    },
    { provide: NOTIFICADOR_WHATSAPP, useClass: TwilioNotificadorWhatsApp },
  ],
  exports: [NotificacionesProgramadasService],
})
export class NotificacionesProgramadasModule {}
