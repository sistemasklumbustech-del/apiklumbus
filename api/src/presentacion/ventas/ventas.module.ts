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

@Module({
  imports: [AuthModule, WebhooksModule, WalletModule, ReferidosModule],
  controllers: [VentasController],
  providers: [
    CheckoutService,
    { provide: COMPRA_REPOSITORIO, useClass: CompraRepositorioDrizzle },
    { provide: PASARELA_PAGO, useClass: SimuladorPasarelaPago },
    { provide: PROVEEDOR_FACTURACION, useClass: SimuladorFacturacionElectronica },
  ],
  exports: [CheckoutService],
})
export class VentasModule {}
