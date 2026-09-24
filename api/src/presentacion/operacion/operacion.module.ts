import { Module } from '@nestjs/common';
import { OperacionController } from './operacion.controller';
import {
  OperacionService,
  OPERACION_REPOSITORIO,
} from '../../aplicacion/operacion/operacion.service';
import { OperacionRepositorioDrizzle } from '../../infraestructura/operacion/operacion.repositorio.drizzle';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OperacionController],
  providers: [
    OperacionService,
    { provide: OPERACION_REPOSITORIO, useClass: OperacionRepositorioDrizzle },
  ],
})
export class OperacionModule {}
