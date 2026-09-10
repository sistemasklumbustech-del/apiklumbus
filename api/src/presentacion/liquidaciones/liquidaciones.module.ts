import { Module } from '@nestjs/common';
import { LiquidacionesController } from './liquidaciones.controller';
import {
  LiquidacionesService,
  LIQUIDACIONES_REPOSITORIO,
} from '../../aplicacion/liquidaciones/liquidaciones.service';
import { LiquidacionesRepositorioDrizzle } from '../../infraestructura/liquidaciones/liquidaciones.repositorio.drizzle';

@Module({
  controllers: [LiquidacionesController],
  providers: [
    LiquidacionesService,
    { provide: LIQUIDACIONES_REPOSITORIO, useClass: LiquidacionesRepositorioDrizzle },
  ],
  // 30-jul-2026 -- se exporta para que PanelEmpresaModule pueda usar
  // LiquidacionesService directamente (misma cooperativa viendo su
  // propio historial), mismo patrón ya usado con VentasModule/CheckoutService.
  exports: [LiquidacionesService],
})
export class LiquidacionesModule {}
