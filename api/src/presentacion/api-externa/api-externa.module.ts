import { Module } from '@nestjs/common';
import { ApiExternaController } from './api-externa.controller';
import {
  ApiExternaService,
  API_EXTERNA_REPOSITORIO,
} from '../../aplicacion/api-externa/api-externa.service';
import { ApiExternaRepositorioDrizzle } from '../../infraestructura/api-externa/api-externa.repositorio.drizzle';
import { ApiKeyGuard } from './guards/api-key.guard';
import { BcryptHasher } from '../../infraestructura/auth/bcrypt.hasher';

@Module({
  controllers: [ApiExternaController],
  providers: [
    ApiExternaService,
    ApiKeyGuard,
    BcryptHasher,
    { provide: API_EXTERNA_REPOSITORIO, useClass: ApiExternaRepositorioDrizzle },
  ],
})
export class ApiExternaModule {}
