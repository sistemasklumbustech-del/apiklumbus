import { Module } from '@nestjs/common';
import { PanelEmpresaController } from './panel-empresa.controller';
import {
  PanelEmpresaService,
  PANEL_EMPRESA_REPOSITORIO,
} from '../../aplicacion/panelempresa/panel-empresa.service';
import { PanelEmpresaRepositorioDrizzle } from '../../infraestructura/panelempresa/panel-empresa.repositorio.drizzle';
import { BcryptHasher } from '../../infraestructura/auth/bcrypt.hasher';
import { AuthModule } from '../auth/auth.module';
import { VentasModule } from '../ventas/ventas.module';
import { LiquidacionesModule } from '../liquidaciones/liquidaciones.module';
import { NotificacionesProgramadasModule } from '../notificaciones-programadas/notificaciones-programadas.module';
import { GeneradorViajesModule } from '../generador-viajes/generador-viajes.module';
import { WalletModule } from '../wallet/wallet.module';
import { ReferidosModule } from '../referidos/referidos.module';

@Module({
  imports: [
    AuthModule,
    VentasModule,
    LiquidacionesModule,
    NotificacionesProgramadasModule,
    GeneradorViajesModule,
    WalletModule,
    ReferidosModule,
  ],
  controllers: [PanelEmpresaController],
  providers: [
    PanelEmpresaService,
    BcryptHasher,
    {
      provide: PANEL_EMPRESA_REPOSITORIO,
      useClass: PanelEmpresaRepositorioDrizzle,
    },
  ],
})
export class PanelEmpresaModule {}
