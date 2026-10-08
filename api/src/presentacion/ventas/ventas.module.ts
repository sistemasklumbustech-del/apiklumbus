import { Module } from '@nestjs/common';
import { VentasController } from './ventas.controller';
import {
  CheckoutService,
  COMPRA_REPOSITORIO,
  PASARELA_PAGO,
  PROVEEDOR_FACTURACION,
} from '../../aplicacion/ventas/checkout.service';
import { CompraRepositorioDrizzle } from '../../infraestructura/ventas/compra.repositorio.drizzle';
import { SimuladorPasarelaPago } from '../../infraestructura/pagos/simulador.pasarela';
import { SimuladorFacturacionElectronica } from '../../infraestructura/facturacion/simulador.facturacion';
import { AuthModule } from '../auth/auth.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { WalletModule } from '../wallet/wallet.module';
import { ReferidosModule } from '../referidos/referidos.module';
import { TerminosModule } from '../terminos/terminos.module';
import { PostpagoController } from './postpago.controller';
import { PostpagoService } from '../../aplicacion/postpago/postpago.service';
import { TareasPostpagoRepositorioDrizzle } from '../../infraestructura/postpago/tareas-postpago.repositorio.drizzle';
import {
  PROVEEDOR_FACTURACION_POSTPAGO,
  TAREAS_POSTPAGO_REPOSITORIO,
} from '../../dominio/postpago/postpago.ports';
import { PROVEEDOR_INTEGRACION_TERMINAL } from '../../dominio/integraciones-terminal/integracion-terminal.ports';
import { SimuladorIntegracionTerminal } from '../../infraestructura/integraciones-terminal/simulador.integracion-terminal';

@Module({
  imports: [AuthModule, WebhooksModule, WalletModule, ReferidosModule, TerminosModule],
  controllers: [VentasController, PostpagoController],
  providers: [
    CheckoutService,
    PostpagoService,
    { provide: COMPRA_REPOSITORIO, useClass: CompraRepositorioDrizzle },
    { provide: PASARELA_PAGO, useClass: SimuladorPasarelaPago },
    { provide: PROVEEDOR_FACTURACION, useClass: SimuladorFacturacionElectronica },
    { provide: PROVEEDOR_FACTURACION_POSTPAGO, useExisting: PROVEEDOR_FACTURACION },
    { provide: TAREAS_POSTPAGO_REPOSITORIO, useClass: TareasPostpagoRepositorioDrizzle },
    // Mientras el SIAT 3000 no esté conectado (fase 3), el terminal es el simulador.
    { provide: PROVEEDOR_INTEGRACION_TERMINAL, useClass: SimuladorIntegracionTerminal },
  ],
  exports: [CheckoutService, PostpagoService],
})
export class VentasModule {}
