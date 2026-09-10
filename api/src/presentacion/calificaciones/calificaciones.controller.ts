import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CalificacionesService } from '../../aplicacion/calificaciones/calificaciones.service';
import { CheckoutService } from '../../aplicacion/ventas/checkout.service';
import { CalificarViajeDto, ListarResenasQueryDto } from './dto/calificaciones.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PayloadToken } from '../../dominio/auth/auth.ports';

@Controller('calificaciones')
export class CalificacionesController {
  constructor(
    private readonly calificaciones: CalificacionesService,
    private readonly checkout: CheckoutService,
  ) {}

  /**
   * Reseñas de texto reales (13-ago-2026) -- pública, sin autenticación,
   * mismo criterio que el promedio numérico que ya se muestra en
   * búsqueda: es contenido que ayuda a decidir ANTES de comprar, no
   * algo que solo un usuario logueado debería ver.
   */
  @Get('cooperativa/:cooperativaId/resenas')
  async resenasPorCooperativa(
    @Param('cooperativaId') cooperativaId: string,
    @Query() query: ListarResenasQueryDto,
  ) {
    return this.calificaciones.listarResenas(
      cooperativaId,
      query.pagina ?? 1,
      query.porPagina ?? 10,
    );
  }

  /** "Mis boletos" — historial de compras del pasajero (22-jul-2026). */
  @UseGuards(JwtAuthGuard)
  @Get('mis-boletos')
  async misBoletos(@Request() req: { user: PayloadToken }) {
    return this.calificaciones.listarMisBoletos(req.user.sub);
  }

  /**
   * Ítem 13, Fase 2 (05-ago-2026) -- descarga de boleto en PDF, con
   * logo/marca, datos organizados por secciones, y QR grande generado
   * del lado del servidor (mismo valor que el vendedor ya escanea).
   *
   * Reubicado 13-ago-2026 (auditoría, hallazgo de organización): la
   * lógica real (servicio + repositorio) ahora vive en CheckoutService
   * (módulo de ventas/boletos, donde pertenece de verdad), pero la
   * RUTA HTTP se deja exactamente aquí a propósito -- el frontend real
   * (`lib/api.ts`) ya llama a `/calificaciones/mis-boletos/:id/pdf`, y
   * mover la ruta habría sido un cambio de comportamiento real (rompe
   * el contrato con el frontend), no la reorganización pura que se
   * pidió. Decisión explícita, reportada.
   */
  @UseGuards(JwtAuthGuard)
  @Get('mis-boletos/:boletoId/pdf')
  async descargarBoletoPdf(
    @Param('boletoId') boletoId: string,
    @Request() req: { user: PayloadToken },
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.checkout.generarPdfBoleto(
      boletoId,
      req.user.sub,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="boleto-${boletoId.slice(0, 8)}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  }

  /** Solo requiere estar logueado — la pertenencia real del boleto se valida en el servicio. */
  @UseGuards(JwtAuthGuard)
  @Post()
  async calificar(
    @Body() dto: CalificarViajeDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.calificaciones.calificarViaje(
      dto.boletoId,
      req.user.sub,
      dto.puntuacion,
      dto.comentario,
    );
  }
}
