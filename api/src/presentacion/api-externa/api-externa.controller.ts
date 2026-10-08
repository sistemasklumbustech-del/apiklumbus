import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { IsNumber, Max, Min } from 'class-validator';
import { ApiExternaService } from '../../aplicacion/api-externa/api-externa.service';
import { PostpagoService } from '../../aplicacion/postpago/postpago.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import {
  ActualizarPrecioViajeDto,
  ConfirmarVentaDto,
  GuardarViajeDto,
  LiberarAsientosDto,
  OcuparAsientosDto,
} from './dto/api-externa.dto';

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
  constructor(
    private readonly service: ApiExternaService,
    private readonly postpago: PostpagoService,
  ) {}

  /**
   * CONFIRMACIÓN DE VENTA (07-oct-2026) -- el sistema de la cooperativa, que
   * es quien factura y registra la tasa en el SIAT 3000, reporta el resultado
   * de una compra que le avisamos por webhook (`venta_creada`). Se espera
   * dentro de 30 minutos; después la venta pasa a revisión manual, aunque el
   * reporte tardío igual se acepta. Es idempotente: repetirlo no duplica nada.
   */
  @Post('compras/:compraId/confirmacion')
  async confirmarVenta(
    @Param('compraId', ParseUUIDPipe) compraId: string,
    @Body() dto: ConfirmarVentaDto,
    @Request() req: PeticionConCooperativa,
  ) {
    const resultado = await this.postpago.confirmarDesdeCooperativa(compraId, req.cooperativaId, dto);
    if (resultado === 'sin_tarea') {
      throw new NotFoundException('No hay una venta de tu cooperativa pendiente de confirmar con ese identificador.');
    }
    return { ok: true };
  }

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
   * CATÁLOGO -- los identificadores de Klumbus de las rutas y unidades de la
   * cooperativa, para que su sistema pueda relacionarlos con los suyos.
   */
  @Get('catalogo')
  async catalogo(@Request() req: PeticionConCooperativa) {
    return this.service.catalogo(req.cooperativaId);
  }

  /**
   * VIAJES (07-oct-2026) -- crea o actualiza un viaje usando como clave el
   * identificador que tiene en el sistema de la cooperativa. Enviar lo mismo
   * dos veces es inofensivo. Con asientos ya tomados solo se puede cambiar el
   * precio, no la ruta, la unidad ni la hora.
   */
  @Put('viajes/:referencia')
  async guardarViaje(
    @Param('referencia') referencia: string,
    @Body() dto: GuardarViajeDto,
    @Request() req: PeticionConCooperativa,
  ) {
    if (referencia.length < 1 || referencia.length > 100) {
      throw new BadRequestException('La referencia del viaje debe tener entre 1 y 100 caracteres.');
    }
    const resultado = await this.service.guardarViaje(req.cooperativaId, referencia, dto);
    if (!resultado.ok) {
      if (resultado.codigo === 'viaje_con_ventas' || resultado.codigo === 'viaje_no_programado') {
        throw new ConflictException({ codigo: resultado.codigo, message: resultado.motivo });
      }
      throw new BadRequestException({ codigo: resultado.codigo, message: resultado.motivo });
    }
    return { id: resultado.id, creado: resultado.creado };
  }

  /** ASIENTOS -- estado de los asientos no libres de un viaje, para reconciliar ambos sistemas. */
  @Get('viajes/:id/asientos')
  async asientosDeViaje(
    @Param('id', ParseUUIDPipe) viajeId: string,
    @Request() req: PeticionConCooperativa,
  ) {
    const resultado = await this.service.asientosDeViaje(req.cooperativaId, viajeId);
    if (!resultado) throw new NotFoundException('No existe un viaje con ese id para tu cooperativa.');
    return resultado;
  }

  /**
   * La cooperativa vendió asientos en su ventanilla: los reporta para que
   * Klumbus no los venda. Cada asiento se resuelve por separado (uno en
   * conflicto no impide los demás). Un asiento ya vendido por Klumbus, con un
   * pago en revisión o en plena compra NO se toca: se devuelve el conflicto
   * para que la cooperativa decida (por ejemplo, reubicar al pasajero).
   */
  @Post('viajes/:id/asientos/ocupados')
  @HttpCode(200)
  async ocuparAsientos(
    @Param('id', ParseUUIDPipe) viajeId: string,
    @Body() dto: OcuparAsientosDto,
    @Request() req: PeticionConCooperativa,
  ) {
    const resultado = await this.service.ocuparAsientos(req.cooperativaId, viajeId, dto.asientos);
    if (!resultado) throw new NotFoundException('No existe un viaje con ese id para tu cooperativa.');
    if (!resultado.ok) throw new ConflictException({ codigo: 'viaje_no_programado', message: resultado.motivo });
    return { resultados: resultado.resultados, conflictos: resultado.resultados.filter((r) => r.resultado === 'conflicto').length };
  }

  /** La cooperativa libera asientos que ella misma había ocupado (por ejemplo, una venta anulada). Nunca libera una venta de Klumbus. */
  @Post('viajes/:id/asientos/liberar')
  @HttpCode(200)
  async liberarAsientos(
    @Param('id', ParseUUIDPipe) viajeId: string,
    @Body() dto: LiberarAsientosDto,
    @Request() req: PeticionConCooperativa,
  ) {
    const resultado = await this.service.liberarAsientos(req.cooperativaId, viajeId, dto.asientos);
    if (!resultado) throw new NotFoundException('No existe un viaje con ese id para tu cooperativa.');
    return { resultados: resultado.resultados, conflictos: resultado.resultados.filter((r) => r.resultado === 'conflicto').length };
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
