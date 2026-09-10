import {
  Body,
  Controller,
  Post,
  Get,
  Param,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CheckoutService } from '../../aplicacion/ventas/checkout.service';
import { CrearCompraDto } from './dto/crear-compra.dto';
import { ReprogramarBoletoDto } from './dto/reprogramar-boleto.dto';
import { IniciarPagoManualDto } from './dto/pago-manual.dto';
import { SolicitarFacturaDto } from './dto/solicitar-factura.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { PayloadToken } from '../../dominio/auth/auth.ports';

@Controller('compras')
export class VentasController {
  constructor(private readonly checkout: CheckoutService) {}

  /**
   * RF-CHECK completo. Item 31, Fase 7 (11-ago-2026) -- compra como
   * invitado (sin cuenta): OptionalJwtAuthGuard nunca bloquea la
   * peticion -- si hay token valido, req.user queda poblado (compra
   * con cuenta, comportamiento identico a siempre); si no hay token,
   * req.user es null (compra como invitado). El servicio decide si
   * eso es valido segun tenga o no datos de contacto.
   */
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  async crearCompra(
    @Body() dto: CrearCompraDto,
    @Request() req: { user: PayloadToken | null },
  ) {
    return this.checkout.procesarCompra(
      dto.pasajeros,
      req.user?.sub ?? null,
      dto.idempotencyKey,
      dto.creditoIdAUsar,
      dto.telefonoContacto,
      dto.correoContacto,
      dto.sesionInvitadoId,
      dto.usarSaldoWallet,
    );
  }

  /**
   * Cancelar un boleto propio — hallazgo real, 22-jul-2026: antes no
   * existía ninguna forma de hacerlo. No procesa reembolso monetario
   * (pagos hoy son simulados); libera el asiento y marca el boleto
   * como cancelado.
   */
  @UseGuards(JwtAuthGuard)
  @Post('boletos/:boletoId/cancelar')
  async cancelarBoleto(
    @Param('boletoId') boletoId: string,
    @Request() req: { user: PayloadToken },
  ) {
    const resultado = await this.checkout.cancelarBoleto(
      boletoId,
      req.user.sub,
    );
    if (!resultado.ok) {
      throw new HttpException(resultado.motivo, HttpStatus.BAD_REQUEST);
    }
    return { ok: true };
  }

  /**
   * Saldo de créditos del pasajero (vacío real de diseño encontrado
   * 29-jul-2026) -- DEBE ir antes de GET ':compraId' en este archivo,
   * si no, esa ruta comodín se lo come a "mis-creditos" como si fuera
   * un id de compra y esta nunca se alcanza.
   */
  @UseGuards(JwtAuthGuard)
  @Get('mis-creditos')
  async listarMisCreditos(@Request() req: { user: PayloadToken }) {
    return this.checkout.listarMisCreditos(req.user.sub);
  }

  /** Lo que el pasajero ve para elegir cómo pagar -- no requiere pertenecer a esa cooperativa. */
  @UseGuards(JwtAuthGuard)
  @Get('metodos-pago/:viajeId')
  async listarMetodosPagoPorViaje(@Param('viajeId') viajeId: string) {
    return this.checkout.listarMetodosPagoActivosPorViaje(viajeId);
  }

  /**
   * Solicitud de factura del pasaje (29-jul-2026) -- confirmado con el
   * usuario: la cooperativa emite en su propio sistema, esto solo
   * avisa. DEBE ir antes de GET ':compraId' -- mismo motivo que
   * mis-creditos.
   */
  @UseGuards(JwtAuthGuard)
  @Post('boletos/:boletoId/solicitar-factura')
  async solicitarFacturaCooperativa(
    @Param('boletoId') boletoId: string,
    @Body() dto: SolicitarFacturaDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.checkout.solicitarFacturaCooperativa(
      boletoId,
      req.user.sub,
      dto.datosTributarios,
    );
  }

  /**
   * Métodos de pago manuales (29-jul-2026) -- mientras no hay pasarela
   * real conectada, el pasajero paga por fuera (transferencia,
   * efectivo, DeUna, PayPhone) y sube su comprobante. DEBE ir antes de
   * GET ':compraId' -- mismo motivo que mis-creditos arriba.
   */
  @UseGuards(JwtAuthGuard)
  @Post('pago-manual')
  async iniciarPagoManual(
    @Body() dto: IniciarPagoManualDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.checkout.iniciarPagoManual(
      dto.pasajeros,
      req.user.sub,
      dto.tipoMetodoPago,
      dto.idempotencyKey,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':compraId/comprobante')
  @UseInterceptors(
    FileInterceptor('comprobante', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async subirComprobante(
    @Param('compraId') compraId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: { user: PayloadToken },
  ) {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype)) {
      throw new BadRequestException('Solo se permiten imágenes JPG, PNG, WEBP, o un PDF.');
    }
    return this.checkout.subirComprobantePago(
      compraId,
      req.user.sub,
      file.buffer,
      file.originalname,
    );
  }

  /** Recibo completo de una compra propia -- detalle de viaje, pasajeros y pago. */
  @UseGuards(JwtAuthGuard)
  @Get(':compraId')
  async obtenerRecibo(
    @Param('compraId') compraId: string,
    @Request() req: { user: PayloadToken },
  ) {
    const recibo = await this.checkout.obtenerReciboCompra(
      compraId,
      req.user.sub,
    );
    if (!recibo) {
      throw new HttpException('Compra no encontrada.', HttpStatus.NOT_FOUND);
    }
    return recibo;
  }

  /**
   * Reprogramación con crédito (Fase C, 29-jul-2026). El asiento nuevo
   * debe estar bloqueado a nombre de este usuario antes de llamar esto
   * (mismo flujo de checkout normal: bloquear-asiento primero).
   */
  @UseGuards(JwtAuthGuard)
  @Post('boletos/:boletoId/reprogramar')
  async reprogramarBoleto(
    @Param('boletoId') boletoId: string,
    @Body() dto: ReprogramarBoletoDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.checkout.reprogramarBoleto(
      boletoId,
      dto.nuevoViajeId,
      dto.nuevoNumeroAsiento,
      req.user.sub,
    );
  }
}
