import { Module } from '@nestjs/common';
import { ComercialController } from './comercial.controller';
import { PublicidadController } from './publicidad.controller';
import {
  ComercialService,
  COMERCIAL_REPOSITORIO,
} from '../../aplicacion/comercial/comercial.service';
import { ComercialRepositorioDrizzle } from '../../infraestructura/comercial/comercial.repositorio.drizzle';

@Module({
  controllers: [ComercialController, PublicidadController],
  providers: [
    ComercialService,
    { provide: COMERCIAL_REPOSITORIO, useClass: ComercialRepositorioDrizzle },
  ],
})
export class ComercialModule {}
