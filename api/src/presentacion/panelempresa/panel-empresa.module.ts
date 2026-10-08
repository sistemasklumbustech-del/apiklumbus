import { Module } from '@nestjs/common';
import { PanelEmpresaController } from './panel-empresa.controller';
import { CargaMasivaController } from './carga-masiva.controller';
import { PerfilPublicoController } from './perfil-publico.controller';
import { PerfilPublicoRepositorio } from '../../infraestructura/panelempresa/perfil-publico.repositorio';
import { CargaMasivaService } from '../../aplicacion/panelempresa/carga-masiva.service';
import { CargaMasivaCatalogo } from '../../infraestructura/panelempresa/carga-masiva.catalogo';
import {
  PanelEmpresaService,
  PANEL_EMPRESA_REPOSITORIO,
} from '../../aplicacion/panelempresa/panel-empresa.service';
import { PanelEmpresaRepositorioDrizzle } from '../../infraestructura/panelempresa/panel-empresa.repositorio.drizzle';
import { BcryptHasher } from '../../infraestructura/auth/bcrypt.hasher';
import { CifradorTotpAesGcm } from '../../infraestructura/auth/cifrador-totp.aes-gcm';
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
  controllers: [
    PanelEmpresaController,
    CargaMasivaController,
    PerfilPublicoController,
  ],
  providers: [
    PanelEmpresaService,
    CargaMasivaService,
    CargaMasivaCatalogo,
    PerfilPublicoRepositorio,
    BcryptHasher,
    CifradorTotpAesGcm,
    {
      provide: PANEL_EMPRESA_REPOSITORIO,
      useClass: PanelEmpresaRepositorioDrizzle,
    },
  ],
})
export class PanelEmpresaModule {}
