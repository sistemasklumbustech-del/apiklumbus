import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Request,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { AsientosService } from '../../aplicacion/asientos/asientos.service';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { PayloadToken } from '../../dominio/auth/auth.ports';

/**
 * Item 31, Fase 7 (11-ago-2026) -- compra como invitado. Solo se usa
 * cuando la peticion no trae token -- el UUID lo genera el navegador
 * (mismo patron que idempotencyKey), no el servidor.
 */
class BloquearAsientoDto {
  @IsOptional()
  @IsString()
  sesionInvitadoId?: string;
}

@Controller('viajes/:viajeId/asientos')
export class AsientosController {
  constructor(private readonly asientos: AsientosService) {}

  /** RF-SEAT-001 -- no requiere login: cualquiera puede ver el mapa antes de registrarse. */
  @Get()
  async obtenerMapa(@Param('viajeId') viajeId: string) {
    return this.asientos.obtenerMapa(viajeId);
  }

  /**
   * RF-SEAT-004. Item 31, Fase 7 (11-ago-2026) -- compra como invitado:
   * OptionalJwtAuthGuard nunca bloquea la peticion -- con token, el
   * hold pertenece al usuario (comportamiento identico a siempre); sin
   * token, pertenece a la sesionInvitadoId enviada en el cuerpo.
   */
  @UseGuards(OptionalJwtAuthGuard)
  @Post(':numeroAsiento/bloquear')
  async bloquear(
    @Param('viajeId') viajeId: string,
    @Param('numeroAsiento') numeroAsiento: string,
    @Body() dto: BloquearAsientoDto,
    @Request() req: { user: PayloadToken | null },
  ) {
    return this.asientos.bloquearAsiento(
      viajeId,
      numeroAsiento,
      req.user?.sub ?? null,
      dto?.sesionInvitadoId ?? null,
    );
  }
}
