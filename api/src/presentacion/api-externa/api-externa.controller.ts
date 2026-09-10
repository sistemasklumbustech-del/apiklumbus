import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { IsNumber, Max, Min } from 'class-validator';
import { ApiExternaService } from '../../aplicacion/api-externa/api-externa.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ActualizarPrecioViajeDto } from './dto/api-externa.dto';

/** Ítem 16 (05-ago-2026) -- rangos válidos reales de latitud/longitud. */
class ActualizarUbicacionViajeDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud!: number;
}

interface PeticionConCooperativa {
  cooperativaId: string;
}

/**
 * Modelo B -- RF-API-002 (recepción) y RF-API-004 (reconciliación),
 * cierre del ítem 4 de la hoja de ruta Fase 2 (03-ago-2026). Autenticado
 * con ApiKeyGuard, NO con sesión JWT de admin_cooperativa -- pensado
 * para que el sistema propio de la cooperativa llame directo, sin un
 * usuario logueado en el navegador de por medio.
 */
@UseGuards(ApiKeyGuard)
@Controller('api-externa')
export class ApiExternaController {
  constructor(private readonly service: ApiExternaService) {}

  /**
   * RECEPCIÓN -- la cooperativa reporta un cambio de precio en uno de
   * sus propios viajes. Alcance de esta entrega: solo precio (ver nota
   * de diseño completa en api-externa.ports.ts sobre por qué la
   * disponibilidad de asientos no se abre todavía a esta vía).
   */
  @Patch('viajes/:id/precio')
  async actualizarPrecioViaje(
    @Param('id') viajeId: string,
    @Body() dto: ActualizarPrecioViajeDto,
    @Request() req: PeticionConCooperativa,
  ) {
    const resultado = await this.service.actualizarPrecioViaje(
      req.cooperativaId,
      viajeId,
      dto.precioBase,
    );
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return { ok: true };
  }

  /**
   * Ítem 16, Fase 2 (05-ago-2026) -- seguimiento GPS en vivo, "cableado"
   * genérico (mismo criterio que el ítem 4, Modelo B): el sistema propio
   * de la cooperativa (o el hardware GPS conectado a él) reporta la
   * última posición conocida de la unidad en este viaje. Sobrescribe la
   * anterior -- no se guarda un historial de todo el trayecto, el
   * requerimiento siempre fue "dónde está el bus ahora".
   */
  @Patch('viajes/:id/ubicacion')
  async actualizarUbicacionViaje(
    @Param('id') viajeId: string,
    @Body() dto: ActualizarUbicacionViajeDto,
    @Request() req: PeticionConCooperativa,
  ) {
    const resultado = await this.service.actualizarUbicacionViaje(
      req.cooperativaId,
      viajeId,
      dto.latitud,
      dto.longitud,
    );
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return { ok: true };
  }

  /**
   * RECONCILIACIÓN -- la cooperativa consulta el estado de entrega de
   * sus webhooks recientes, para verificar manualmente si algo se
   * perdió sin depender al 100% del reintento automático.
   */
  @Get('webhooks')
  async listarEventosWebhook(
    @Query('desde') desde: string | undefined,
    @Query('hasta') hasta: string | undefined,
    @Request() req: PeticionConCooperativa,
  ) {
    return this.service.listarEventosWebhook(req.cooperativaId, desde, hasta);
  }
}
