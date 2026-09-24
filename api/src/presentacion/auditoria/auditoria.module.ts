import { Global, Module } from '@nestjs/common';
import { AuditoriaController } from './auditoria.controller';
import {
  AuditoriaService,
  AUDITORIA_CONSULTA_REPOSITORIO,
} from '../../aplicacion/auditoria/auditoria.service';
import { AuditoriaConsultaRepositorioDrizzle } from '../../infraestructura/auditoria/auditoria-consulta.repositorio.drizzle';
import { AuditoriaRegistrador } from '../../infraestructura/auditoria/auditoria.registrador';
import { AuthModule } from '../auth/auth.module';

/**
 * Global a propósito: AuditoriaRegistrador lo necesitan servicios de
 * varios módulos (autenticación, reclamos, ventas, generación de viajes)
 * y no vale la pena que cada uno importe este módulo.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [AuditoriaController],
  providers: [
    AuditoriaService,
    AuditoriaRegistrador,
    {
      provide: AUDITORIA_CONSULTA_REPOSITORIO,
      useClass: AuditoriaConsultaRepositorioDrizzle,
    },
  ],
  exports: [AuditoriaRegistrador],
})
export class AuditoriaModule {}
