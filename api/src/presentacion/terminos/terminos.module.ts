import { Module } from '@nestjs/common';
import { TerminosController } from './terminos.controller';
import { TerminosService, TERMINOS_REPOSITORIO } from '../../aplicacion/terminos/terminos.service';
import { TerminosRepositorioDrizzle } from '../../infraestructura/terminos/terminos.repositorio.drizzle';

@Module({
  controllers: [TerminosController],
  providers: [
    TerminosService,
    { provide: TERMINOS_REPOSITORIO, useClass: TerminosRepositorioDrizzle },
  ],
  exports: [TerminosService],
})
export class TerminosModule {}
