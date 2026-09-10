import { Module } from '@nestjs/common';
import { ReferidosController } from './referidos.controller';
import { ReferidosService, REFERIDOS_REPOSITORIO } from '../../aplicacion/referidos/referidos.service';
import { ReferidosRepositorioDrizzle } from '../../infraestructura/referidos/referidos.repositorio.drizzle';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [ReferidosController],
  providers: [
    ReferidosService,
    {
      provide: REFERIDOS_REPOSITORIO,
      useClass: ReferidosRepositorioDrizzle,
    },
  ],
  exports: [ReferidosService],
})
export class ReferidosModule {}
