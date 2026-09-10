import { Module } from '@nestjs/common';
import { CalificacionesController } from './calificaciones.controller';
import {
  CalificacionesService,
  CALIFICACIONES_REPOSITORIO,
} from '../../aplicacion/calificaciones/calificaciones.service';
import { CalificacionesRepositorioDrizzle } from '../../infraestructura/calificaciones/calificaciones.repositorio.drizzle';
import { VentasModule } from '../ventas/ventas.module';

@Module({
  imports: [VentasModule],
  controllers: [CalificacionesController],
  providers: [
    CalificacionesService,
    {
      provide: CALIFICACIONES_REPOSITORIO,
      useClass: CalificacionesRepositorioDrizzle,
    },
  ],
})
export class CalificacionesModule {}
