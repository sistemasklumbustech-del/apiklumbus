import { Module } from '@nestjs/common';
import {
  NotificacionesProgramadasService,
  NOTIFICACIONES_PROGRAMADAS_REPOSITORIO,
  NOTIFICADOR_WHATSAPP,
} from '../../aplicacion/notificaciones-programadas/notificaciones-programadas.service';
import { NotificacionesProgramadasRepositorioDrizzle } from '../../infraestructura/notificaciones-programadas/notificaciones-programadas.repositorio.drizzle';
import { SimuladorNotificadorWhatsApp } from '../../infraestructura/notificaciones/simulador.notificador.whatsapp';

@Module({
  providers: [
    NotificacionesProgramadasService,
    {
      provide: NOTIFICACIONES_PROGRAMADAS_REPOSITORIO,
      useClass: NotificacionesProgramadasRepositorioDrizzle,
    },
    { provide: NOTIFICADOR_WHATSAPP, useClass: SimuladorNotificadorWhatsApp },
  ],
  exports: [NotificacionesProgramadasService],
})
export class NotificacionesProgramadasModule {}
