import {
  Controller,
  ForbiddenException,
  Param,
  ParseUUIDPipe,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import { EstadoViajesService } from '../../aplicacion/estado-viajes/estado-viajes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PayloadToken } from '../../dominio/auth/auth.ports';

/** La cooperativa confirma que el bus de uno de sus viajes en curso llegó a su destino. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_cooperativa')
@Controller('coop/viajes')
export class EstadoViajesController {
  constructor(private readonly estados: EstadoViajesService) {}

  @Patch(':id/confirmar-llegada')
  async confirmarLlegada(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: PayloadToken },
  ) {
    // La cooperativa sale SIEMPRE del token firmado, nunca de un
    // parámetro del cliente.
    if (!req.user.cooperativaId) {
      throw new ForbiddenException(
        'Este usuario no pertenece a ninguna cooperativa.',
      );
    }
    return this.estados.confirmarLlegada(
      req.user.cooperativaId,
      id,
      req.user.sub,
    );
  }
}
