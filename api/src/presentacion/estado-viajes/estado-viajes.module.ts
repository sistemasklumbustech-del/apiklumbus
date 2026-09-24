import { Module } from '@nestjs/common';
import { EstadoViajesController } from './estado-viajes.controller';
import {
  EstadoViajesService,
  ESTADO_VIAJES_REPOSITORIO,
} from '../../aplicacion/estado-viajes/estado-viajes.service';
import { EstadoViajesRepositorioDrizzle } from '../../infraestructura/estado-viajes/estado-viajes.repositorio.drizzle';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [EstadoViajesController],
  providers: [
    EstadoViajesService,
    {
      provide: ESTADO_VIAJES_REPOSITORIO,
      useClass: EstadoViajesRepositorioDrizzle,
    },
  ],
})
export class EstadoViajesModule {}
