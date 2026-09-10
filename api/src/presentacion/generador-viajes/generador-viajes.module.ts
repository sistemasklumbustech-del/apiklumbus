import { Module } from '@nestjs/common';
import {
  GeneradorViajesService,
  GENERADOR_VIAJES_REPOSITORIO,
} from '../../aplicacion/generador-viajes/generador-viajes.service';
import { GeneradorViajesRepositorioDrizzle } from '../../infraestructura/generador-viajes/generador-viajes.repositorio.drizzle';

@Module({
  providers: [
    GeneradorViajesService,
    { provide: GENERADOR_VIAJES_REPOSITORIO, useClass: GeneradorViajesRepositorioDrizzle },
  ],
  // 04-ago-2026 -- ítem 8: PanelEmpresaModule lo necesita para que la
  // carga masiva reutilice el mismo generador que el cron.
  exports: [GeneradorViajesService],
})
export class GeneradorViajesModule {}
