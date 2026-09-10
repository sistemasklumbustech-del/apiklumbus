import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService, WALLET_REPOSITORIO } from '../../aplicacion/wallet/wallet.service';
import { WalletRepositorioDrizzle } from '../../infraestructura/wallet/wallet.repositorio.drizzle';

@Module({
  controllers: [WalletController],
  providers: [
    WalletService,
    {
      provide: WALLET_REPOSITORIO,
      useClass: WalletRepositorioDrizzle,
    },
  ],
  exports: [WalletService],
})
export class WalletModule {}
