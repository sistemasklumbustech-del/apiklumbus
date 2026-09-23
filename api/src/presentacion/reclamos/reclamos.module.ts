import { Module } from '@nestjs/common';
import {
  ReclamosController,
  ReclamosCoopController,
} from './reclamos.controller';
import {
  ReclamosService,
  RECLAMOS_REPOSITORIO,
} from '../../aplicacion/reclamos/reclamos.service';
import { ReclamosRepositorioDrizzle } from '../../infraestructura/reclamos/reclamos.repositorio.drizzle';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ReclamosController, ReclamosCoopController],
  providers: [
    ReclamosService,
    { provide: RECLAMOS_REPOSITORIO, useClass: ReclamosRepositorioDrizzle },
  ],
})
export class ReclamosModule {}
