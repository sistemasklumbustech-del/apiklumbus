import { Module } from '@nestjs/common';
import {
  CuentaCobroCoopController,
  CuentasCobroAdminController,
} from './cuentas-cobro.controller';
import {
  CuentasCobroService,
  CUENTAS_COBRO_REPOSITORIO,
} from '../../aplicacion/cuentas-cobro/cuentas-cobro.service';
import { CuentasCobroRepositorioDrizzle } from '../../infraestructura/cuentas-cobro/cuentas-cobro.repositorio.drizzle';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CuentaCobroCoopController, CuentasCobroAdminController],
  providers: [
    CuentasCobroService,
    {
      provide: CUENTAS_COBRO_REPOSITORIO,
      useClass: CuentasCobroRepositorioDrizzle,
    },
  ],
})
export class CuentasCobroModule {}
