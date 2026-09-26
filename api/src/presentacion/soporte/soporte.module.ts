import { Module } from '@nestjs/common';
import { SoporteController } from './soporte.controller';
import { SoporteService } from '../../aplicacion/soporte/soporte.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SoporteController],
  providers: [SoporteService],
})
export class SoporteModule {}
