import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import {
  AdminService,
  ADMIN_REPOSITORIO,
} from '../../aplicacion/admin/admin.service';
import { AdminRepositorioDrizzle } from '../../infraestructura/admin/admin.repositorio.drizzle';
import { BcryptHasher } from '../../infraestructura/auth/bcrypt.hasher';

@Module({
  controllers: [AdminController],
  providers: [
    AdminService,
    BcryptHasher,
    { provide: ADMIN_REPOSITORIO, useClass: AdminRepositorioDrizzle },
  ],
})
export class AdminModule {}
