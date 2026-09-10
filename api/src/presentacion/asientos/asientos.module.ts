import { Module } from '@nestjs/common';
import { AsientosController } from './asientos.controller';
import {
  AsientosService,
  ASIENTO_REPOSITORIO,
} from '../../aplicacion/asientos/asientos.service';
import { AsientoRepositorioDrizzle } from '../../infraestructura/asientos/asiento.repositorio.drizzle';

@Module({
  controllers: [AsientosController],
  providers: [
    AsientosService,
    { provide: ASIENTO_REPOSITORIO, useClass: AsientoRepositorioDrizzle },
  ],
})
export class AsientosModule {}
