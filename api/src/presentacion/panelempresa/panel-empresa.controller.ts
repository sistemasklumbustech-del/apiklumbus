import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PanelEmpresaService } from '../../aplicacion/panelempresa/panel-empresa.service';
import { CheckoutService } from '../../aplicacion/ventas/checkout.service';
import { LiquidacionesService } from '../../aplicacion/liquidaciones/liquidaciones.service';
import {
  CrearTipoVehiculoDto,
  CrearUnidadDto,
  CrearRutaDto,
  CrearParadaDto,
  EditarParadaDto,
  CrearViajeDto,
  CrearUsuarioStaffDto,
  CrearConductorDto,
  ImportarDatosDto,
  ValidarQrDto,
  CambiarUnidadViajeDto,
  EditarViajeDto,
  ActualizarEstadoUnidadDto,
  VerificarMenorDto,
  ActualizarConfiguracionFiscalDto,
  ActualizarConfiguracionVipDto,
  ActualizarHorasLimiteReprogramacionDto,
  ActualizarPoliticaCancelacionReprogramacionDto,
  ActualizarPerfilDto,
  EditarTipoVehiculoDto,
  EditarRutaDto,
  CrearHorarioRutaDto,
  ActualizarEstadoHorarioRutaDto,
  CancelarViajesMasivoDto,
  ConfirmarDatosCooperativaDto,
  ProponerPuntoOperacionDto,
} from './dto/panel-empresa.dto';
import { GuardarMetodoPagoDto, ConfirmarPagoManualDto, MarcarFacturaEmitidaDto } from './dto/metodos-pago.dto';
import { CrearCredencialApiDto, ActualizarWebhookCredencialApiDto } from './dto/credenciales-api.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PayloadToken } from '../../dominio/auth/auth.ports';

/**
 * La cooperativa del usuario sale SIEMPRE de su propio token firmado
 * (nunca de un parÃ¡metro que el cliente podrÃ­a manipular) â€” asÃ­ un
 * admin_cooperativa fÃ­sicamente no puede operar sobre otra cooperativa
 * aunque lo intente, sin necesidad de validarlo caso por caso.
 */
function cooperativaDelToken(user: PayloadToken): string {
  if (!user.cooperativaId) {
    throw new ForbiddenException(
      'Este usuario no pertenece a ninguna cooperativa.',
    );
  }
  return user.cooperativaId;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('coop')
export class PanelEmpresaController {
  constructor(
    private readonly panel: PanelEmpresaService,
    private readonly checkout: CheckoutService,
    private readonly liquidaciones: LiquidacionesService,
  ) {}

  @Roles('admin_cooperativa')
  @Post('tipos-vehiculo')
  async crearTipoVehiculo(
    @Body() dto: CrearTipoVehiculoDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.crearTipoVehiculo(cooperativaDelToken(req.user), dto);
  }

  @Roles('admin_cooperativa', 'vendedor')
  @Get('tipos-vehiculo')
  async listarTiposVehiculo(@Request() req: { user: PayloadToken }) {
    return this.panel.listarTiposVehiculo(cooperativaDelToken(req.user));
  }

  /**
   * Cooperativas proponen sus propios puntos de operación (13-ago-2026)
   * -- queda 'pendiente_revision', el admin de plataforma aprueba o
   * rechaza (ver GET/PATCH /admin/puntos-operacion/...).
   */
  @Roles('admin_cooperativa')
  @Post('puntos-operacion')
  async proponerPuntoOperacion(
    @Body() dto: ProponerPuntoOperacionDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.proponerPuntoOperacion(cooperativaDelToken(req.user), dto);
  }

  @Roles('admin_cooperativa')
  @Patch('tipos-vehiculo/:tipoVehiculoId')
  async editarTipoVehiculo(
    @Param('tipoVehiculoId') tipoVehiculoId: string,
    @Body() dto: EditarTipoVehiculoDto,
    @Request() req: { user: PayloadToken },
  ) {
    const resultado = await this.panel.editarTipoVehiculo(
      cooperativaDelToken(req.user),
      tipoVehiculoId,
      dto,
    );
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return resultado;
  }

  @Roles('admin_cooperativa')
  @Post('unidades')
  async crearUnidad(
    @Body() dto: CrearUnidadDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.crearUnidad(cooperativaDelToken(req.user), dto);
  }

  @Roles('admin_cooperativa', 'vendedor')
  @Get('unidades')
  async listarUnidades(@Request() req: { user: PayloadToken }) {
    return this.panel.listarUnidades(cooperativaDelToken(req.user));
  }

  /** Activar/desactivar una unidad â€” hallazgo cerrado 22-jul-2026. */
  @Roles('admin_cooperativa')
  @Patch('unidades/:unidadId/estado')
  async actualizarEstadoUnidad(
    @Param('unidadId') unidadId: string,
    @Body() dto: ActualizarEstadoUnidadDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.panel.actualizarEstadoUnidad(
      cooperativaDelToken(req.user),
      unidadId,
      dto.activo,
    );
    return { ok: true };
  }

  @Roles('admin_cooperativa')
  @Post('rutas')
  async crearRuta(
    @Body() dto: CrearRutaDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.crearRuta(cooperativaDelToken(req.user), dto);
  }

  @Roles('admin_cooperativa', 'vendedor')
  @Get('rutas')
  async listarRutas(@Request() req: { user: PayloadToken }) {
    return this.panel.listarRutas(cooperativaDelToken(req.user));
  }

  @Roles('admin_cooperativa')
  @Post('paradas')
  async agregarParada(
    @Body() dto: CrearParadaDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.agregarParada(cooperativaDelToken(req.user), dto);
  }

  @Roles('admin_cooperativa', 'vendedor')
  @Get('rutas/:rutaId/paradas')
  async listarParadas(
    @Param('rutaId') rutaId: string,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.listarParadas(cooperativaDelToken(req.user), rutaId);
  }

  @Roles('admin_cooperativa')
  @Patch('paradas/:paradaId')
  async editarParada(
    @Param('paradaId') paradaId: string,
    @Body() dto: EditarParadaDto,
    @Request() req: { user: PayloadToken },
  ) {
    const resultado = await this.panel.editarParada(
      cooperativaDelToken(req.user),
      paradaId,
      dto,
    );
    if (!resultado.ok) throw new BadRequestException(resultado.motivo);
    return { ok: true };
  }

  @Roles('admin_cooperativa')
  @Delete('paradas/:paradaId')
  async eliminarParada(
    @Param('paradaId') paradaId: string,
    @Request() req: { user: PayloadToken },
  ) {
    const resultado = await this.panel.eliminarParada(
      cooperativaDelToken(req.user),
      paradaId,
    );
    if (!resultado.ok) throw new BadRequestException(resultado.motivo);
    return { ok: true };
  }

  @Roles('admin_cooperativa')
  @Patch('rutas/:rutaId')
  async editarRuta(
    @Param('rutaId') rutaId: string,
    @Body() dto: EditarRutaDto,
    @Request() req: { user: PayloadToken },
  ) {
    const resultado = await this.panel.editarRuta(
      cooperativaDelToken(req.user),
      rutaId,
      dto,
    );
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return resultado;
  }

  @Roles('admin_cooperativa')
  @Post('viajes')
  async crearViaje(
    @Body() dto: CrearViajeDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.crearViaje(cooperativaDelToken(req.user), dto);
  }

  @Roles('admin_cooperativa', 'vendedor')
  @Get('viajes')
  async listarViajes(@Request() req: { user: PayloadToken }) {
    return this.panel.listarViajes(cooperativaDelToken(req.user));
  }

  /** Cancelar un viaje completo (cascada a sus boletos) â€” hallazgo cerrado 22-jul-2026. Solo el admin, no el vendedor. */
  @Roles('admin_cooperativa')
  @Post('viajes/:viajeId/cancelar')
  async cancelarViaje(
    @Param('viajeId') viajeId: string,
    @Request() req: { user: PayloadToken },
  ) {
    const resultado = await this.panel.cancelarViaje(
      cooperativaDelToken(req.user),
      viajeId,
    );
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return resultado;
  }

  /**
   * Horarios recurrentes (plantilla) -- Ã­tem 7, RF-COOP-002
   * (03-ago-2026). Un generador aparte (cron diario) crea los viajes
   * reales a partir de estas plantillas.
   */
  @Roles('admin_cooperativa')
  @Post('horarios-ruta')
  async crearHorarioRuta(
    @Body() dto: CrearHorarioRutaDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.crearHorarioRuta(cooperativaDelToken(req.user), dto);
  }

  @Roles('admin_cooperativa')
  @Get('horarios-ruta')
  async listarHorariosRuta(
    @Query('rutaId') rutaId: string | undefined,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.listarHorariosRuta(cooperativaDelToken(req.user), rutaId);
  }

  @Roles('admin_cooperativa')
  @Patch('horarios-ruta/:id/estado')
  async actualizarEstadoHorarioRuta(
    @Param('id') id: string,
    @Body() dto: ActualizarEstadoHorarioRutaDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.panel.actualizarEstadoHorarioRuta(
      cooperativaDelToken(req.user),
      id,
      dto.activo,
    );
    return { ok: true };
  }

  /**
   * CancelaciÃ³n/suspensiÃ³n masiva por ruta y rango de fechas -- Ã­tem 7
   * (03-ago-2026), para contratiempos operativos (cierre de vÃ­a,
   * feriado, paro). Los viajes con boletos vendidos SÃ se cancelan,
   * generando crÃ©dito automÃ¡tico y notificaciÃ³n por WhatsApp -- decisiÃ³n
   * del director, no se bloquea la acciÃ³n ni se saltan en silencio.
   */
  @Roles('admin_cooperativa')
  @Post('rutas/:id/cancelar-masivo')
  async cancelarViajesMasivo(
    @Param('id') rutaId: string,
    @Body() dto: CancelarViajesMasivoDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.cancelarViajesMasivo(
      cooperativaDelToken(req.user),
      rutaId,
      dto.fechaInicio,
      dto.fechaFin,
    );
  }

  /**
   * Cambiar la unidad de un viaje ya programado â€” "vehÃ­culo de
   * reemplazo" (investigado y confirmado 22-jul-2026, ver comentario
   * completo en panel-empresa.ports.ts). No toca boletos ni asientos.
   */
  @Roles('admin_cooperativa')
  @Patch('viajes/:viajeId/unidad')
  async cambiarUnidadViaje(
    @Param('viajeId') viajeId: string,
    @Body() dto: CambiarUnidadViajeDto,
    @Request() req: { user: PayloadToken },
  ) {
    const resultado = await this.panel.cambiarUnidadViaje(
      cooperativaDelToken(req.user),
      viajeId,
      dto.nuevaUnidadId,
    );
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return resultado;
  }

  /** Editar hora/precio de un viaje sin boletos vendidos â€” hallazgo cerrado 22-jul-2026. */
  @Roles('admin_cooperativa')
  @Patch('viajes/:viajeId')
  async editarViaje(
    @Param('viajeId') viajeId: string,
    @Body() dto: EditarViajeDto,
    @Request() req: { user: PayloadToken },
  ) {
    const resultado = await this.panel.editarViaje(
      cooperativaDelToken(req.user),
      viajeId,
      dto,
    );
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return resultado;
  }

  /** Lista de pasajeros de un viaje ("manifiesto") â€” hallazgo cerrado 22-jul-2026. */
  @Roles('admin_cooperativa', 'vendedor')
  @Get('viajes/:viajeId/pasajeros')
  async listarPasajerosDeViaje(
    @Param('viajeId') viajeId: string,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.listarPasajerosDeViaje(
      cooperativaDelToken(req.user),
      viajeId,
    );
  }

  /** RF-COOP-007 â€” mÃºltiples usuarios por cooperativa con permisos diferenciados. */
  @Roles('admin_cooperativa')
  @Post('usuarios')
  async crearUsuarioStaff(
    @Body() dto: CrearUsuarioStaffDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.crearUsuarioStaff(cooperativaDelToken(req.user), dto);
  }

  @Roles('admin_cooperativa')
  @Get('usuarios')
  async listarUsuariosStaff(@Request() req: { user: PayloadToken }) {
    return this.panel.listarUsuariosStaff(cooperativaDelToken(req.user));
  }

  @Roles('admin_cooperativa')
  @Post('conductores')
  async crearConductor(
    @Body() dto: CrearConductorDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.crearConductor(cooperativaDelToken(req.user), dto);
  }

  @Roles('admin_cooperativa')
  @Get('conductores')
  async listarConductores(@Request() req: { user: PayloadToken }) {
    return this.panel.listarConductores(cooperativaDelToken(req.user));
  }

  /**
   * Carga masiva de rutas/horarios/flota/conductores â€” pensado para
   * cuando una cooperativa ya tiene toda esta informaciÃ³n en su propio
   * sistema y necesita subirla de una sola vez, en vez de crear cada
   * recurso uno por uno a mano.
   */
  @Roles('admin_cooperativa')
  @Post('importar')
  async importarDatos(
    @Body() dto: ImportarDatosDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.importarDatos(cooperativaDelToken(req.user), dto);
  }

  /** RF-COOP-004 */
  @Roles('admin_cooperativa')
  @Get('dashboard')
  async dashboard(@Request() req: { user: PayloadToken }) {
    return this.panel.dashboardVentasDelDia(cooperativaDelToken(req.user));
  }

  /** Perfil visual de la cooperativa â€” hoy solo el logo (22-jul-2026). */
  @Roles('admin_cooperativa')
  @Get('perfil')
  async obtenerPerfil(@Request() req: { user: PayloadToken }) {
    return this.panel.obtenerPerfil(cooperativaDelToken(req.user));
  }

  @Roles('admin_cooperativa')
  @Patch('perfil')
  async actualizarPerfil(
    @Body() dto: ActualizarPerfilDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.panel.actualizarPerfil(cooperativaDelToken(req.user), {
      logoUrl: dto.logoUrl && dto.logoUrl.trim() !== '' ? dto.logoUrl : null,
    });
    return { ok: true };
  }

  /** 27-jul-2026 -- subida real de logo, con simulador de almacenamiento (mismo patron que la foto de perfil). */
  @Roles('admin_cooperativa')
  @Post('perfil/logo')
  @UseInterceptors(
    FileInterceptor('logo', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async subirLogo(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: { user: PayloadToken },
  ) {
    if (!file) {
      throw new BadRequestException('No se recibio ningun archivo.');
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new BadRequestException(
        'Solo se permiten imagenes JPG, PNG o WEBP.',
      );
    }
    return this.panel.subirLogoCooperativa(
      cooperativaDelToken(req.user),
      file.buffer,
      file.originalname,
    );
  }

  /** IVA de la cooperativa â€” solo el admin puede verla/cambiarla (21-jul-2026). */
  @Roles('admin_cooperativa')
  @Get('configuracion-fiscal')
  async obtenerConfiguracionFiscal(@Request() req: { user: PayloadToken }) {
    return this.panel.obtenerConfiguracionFiscal(cooperativaDelToken(req.user));
  }

  /** Recargo VIP por defecto -- correccion real 18-ago-2026. */
  @Roles('admin_cooperativa')
  @Get('configuracion-vip')
  async obtenerConfiguracionVip(@Request() req: { user: PayloadToken }) {
    return this.panel.obtenerConfiguracionVip(cooperativaDelToken(req.user));
  }

  @Roles('admin_cooperativa')
  @Patch('configuracion-fiscal')
  async actualizarConfiguracionFiscal(
    @Body() dto: ActualizarConfiguracionFiscalDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.panel.actualizarConfiguracionFiscal(
      cooperativaDelToken(req.user),
      dto,
    );
    return { ok: true };
  }

  @Roles('admin_cooperativa')
  @Patch('configuracion-vip')
  async actualizarConfiguracionVip(
    @Body() dto: ActualizarConfiguracionVipDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.panel.actualizarConfiguracionVip(
      cooperativaDelToken(req.user),
      dto.recargoVipDefault,
    );
    return { ok: true };
  }

  /** ReprogramaciÃ³n con crÃ©dito (Fase C, 28-jul-2026) â€” horas mÃ­nimas antes de la salida, configurable por cooperativa. */
  @Roles('admin_cooperativa')
  @Get('horas-limite-reprogramacion')
  async obtenerHorasLimiteReprogramacion(@Request() req: { user: PayloadToken }) {
    const horas = await this.panel.obtenerHorasLimiteReprogramacion(
      cooperativaDelToken(req.user),
    );
    return { horas };
  }

  @Roles('admin_cooperativa')
  @Patch('horas-limite-reprogramacion')
  async actualizarHorasLimiteReprogramacion(
    @Body() dto: ActualizarHorasLimiteReprogramacionDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.panel.actualizarHorasLimiteReprogramacion(
      cooperativaDelToken(req.user),
      dto.horas,
    );
    return { ok: true };
  }

  /**
   * PolÃ­tica de cancelaciÃ³n/reprogramaciÃ³n (29-jul-2026, hallazgo real
   * de negocio): algunas cooperativas (ej. Transportes Occidental, no
   * permite cambios ni devoluciones) no admiten estas opciones en
   * absoluto. Se configuran por separado a propÃ³sito -- cancelar es
   * una venta perdida para la cooperativa, reprogramar no.
   */
  @Roles('admin_cooperativa')
  @Get('politica-cancelacion-reprogramacion')
  async obtenerPoliticaCancelacionReprogramacion(@Request() req: { user: PayloadToken }) {
    return this.panel.obtenerPoliticaCancelacionReprogramacion(
      cooperativaDelToken(req.user),
    );
  }

  @Roles('admin_cooperativa')
  @Patch('politica-cancelacion-reprogramacion')
  async actualizarPoliticaCancelacionReprogramacion(
    @Body() dto: ActualizarPoliticaCancelacionReprogramacionDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.panel.actualizarPoliticaCancelacionReprogramacion(
      cooperativaDelToken(req.user),
      dto,
    );
    return { ok: true };
  }

  /**
   * MÃ©todos de pago manuales (29-jul-2026) â€” mientras no hay pasarela
   * real conectada, cada cooperativa configura los que ya usa hoy en
   * Ecuador (transferencia, efectivo, DeUna, PayPhone) con sus propios
   * datos para recibir el pago.
   */
  @Roles('admin_cooperativa')
  @Get('metodos-pago')
  async listarMetodosPago(@Request() req: { user: PayloadToken }) {
    return this.panel.listarMetodosPago(cooperativaDelToken(req.user));
  }

  @Roles('admin_cooperativa')
  @Post('metodos-pago')
  async guardarMetodoPago(
    @Body() dto: GuardarMetodoPagoDto,
    @Request() req: { user: PayloadToken },
  ) {
    const resultado = await this.panel.guardarMetodoPago(
      cooperativaDelToken(req.user),
      dto.tipo,
      dto.datosCuenta,
      dto.activo ?? true,
      dto.entidadFinanciera ?? null,
    );
    return resultado;
  }

  @Roles('admin_cooperativa')
  @Delete('metodos-pago/:id')
  async eliminarMetodoPago(
    @Param('id') id: string,
    @Request() req: { user: PayloadToken },
  ) {
    await this.panel.eliminarMetodoPago(cooperativaDelToken(req.user), id);
    return { ok: true };
  }

  /**
   * Credenciales API -- Modelo B (02-ago-2026), autoservicio de la
   * propia cooperativa (RF-API-001, secciÃ³n 3.11 del documento maestro).
   * La llave completa (apiKeyCompleta) solo aparece en la respuesta de
   * crear/rotar -- nunca mÃ¡s se puede recuperar despuÃ©s de eso, ni
   * siquiera por este mismo endpoint.
   */
  @Roles('admin_cooperativa')
  @Get('credenciales-api')
  async listarCredencialesApi(@Request() req: { user: PayloadToken }) {
    return this.panel.listarCredencialesApi(cooperativaDelToken(req.user));
  }

  @Roles('admin_cooperativa')
  @Post('credenciales-api')
  async crearCredencialApi(
    @Body() dto: CrearCredencialApiDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.crearCredencialApi(
      cooperativaDelToken(req.user),
      dto.webhookUrl ?? null,
    );
  }

  /** Revoca la credencial actual y genera una nueva de inmediato -- sin ventana donde ambas sirvan. */
  @Roles('admin_cooperativa')
  @Post('credenciales-api/:id/rotar')
  async rotarCredencialApi(
    @Param('id') id: string,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.rotarCredencialApi(cooperativaDelToken(req.user), id);
  }

  @Roles('admin_cooperativa')
  @Delete('credenciales-api/:id')
  async revocarCredencialApi(
    @Param('id') id: string,
    @Request() req: { user: PayloadToken },
  ) {
    await this.panel.revocarCredencialApi(cooperativaDelToken(req.user), id);
    return { ok: true };
  }

  @Roles('admin_cooperativa')
  @Patch('credenciales-api/:id/webhook')
  async actualizarWebhookCredencialApi(
    @Param('id') id: string,
    @Body() dto: ActualizarWebhookCredencialApiDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.panel.actualizarWebhookCredencialApi(
      cooperativaDelToken(req.user),
      id,
      dto.webhookUrl && dto.webhookUrl.trim() !== '' ? dto.webhookUrl : null,
    );
    return { ok: true };
  }

  /**
   * Confirmar/rechazar pagos manuales (29-jul-2026) -- el lado
   * cooperativa del flujo de transferencia/efectivo/DeUna/PayPhone.
   * Solo el admin (no el vendedor) confirma dinero real, mismo
   * criterio que el resto de operaciones financieras de este panel.
   */
  @Roles('admin_cooperativa')
  @Get('pagos-pendientes')
  async listarPagosPendientes(@Request() req: { user: PayloadToken }) {
    return this.checkout.listarPagosPendientesConfirmacion(cooperativaDelToken(req.user));
  }

  @Roles('admin_cooperativa')
  @Patch('pagos-pendientes/:pagoId/confirmar')
  async confirmarPagoManual(
    @Param('pagoId') pagoId: string,
    @Request() req: { user: PayloadToken },
  ) {
    return this.checkout.confirmarPagoManual(
      pagoId,
      cooperativaDelToken(req.user),
      req.user.sub,
    );
  }

  @Roles('admin_cooperativa')
  @Patch('pagos-pendientes/:pagoId/rechazar')
  async rechazarPagoManual(
    @Param('pagoId') pagoId: string,
    @Body() dto: ConfirmarPagoManualDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.checkout.rechazarPagoManual(
      pagoId,
      cooperativaDelToken(req.user),
      dto.motivo,
      req.user.sub,
    );
  }

  /**
   * Solicitudes de factura del pasaje (29-jul-2026) -- confirmado con
   * el usuario: la cooperativa emite en su propio sistema (fuera de
   * esta plataforma), esto solo avisa y deja registro de la solicitud.
   */
  @Roles('admin_cooperativa')
  @Get('solicitudes-factura')
  async listarSolicitudesFactura(@Request() req: { user: PayloadToken }) {
    return this.checkout.listarSolicitudesFactura(cooperativaDelToken(req.user));
  }

  @Roles('admin_cooperativa')
  @Patch('solicitudes-factura/:id/marcar-emitida')
  async marcarFacturaEmitida(
    @Param('id') id: string,
    @Body() dto: MarcarFacturaEmitidaDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.checkout.marcarFacturaEmitida(id, cooperativaDelToken(req.user), dto.urlFactura);
  }

  /** RF-COOP-006 â€” tanto el vendedor como el admin pueden validar boletos en el andÃ©n. */
  @Roles('vendedor', 'admin_cooperativa')
  @Post('validar-qr')
  async validarQr(
    @Body() dto: ValidarQrDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.validarBoletoPorQr(
      cooperativaDelToken(req.user),
      dto.codigoQr,
      req.user.sub,
    );
  }

  /** RF-MENOR-004 â€” verificaciÃ³n de documentos del menor en abordaje (22-jul-2026). */
  @Roles('vendedor', 'admin_cooperativa')
  @Post('verificar-menor')
  async verificarMenor(
    @Body() dto: VerificarMenorDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.panel.verificarMenor(
      cooperativaDelToken(req.user),
      dto.boletoId,
      req.user.sub,
      dto.documentoIdentidadVerificado,
      dto.documentoAutorizacionVerificado,
    );
    return { ok: true };
  }

  /**
   * Historial de liquidaciones propio de la cooperativa (30-jul-2026,
   * hallazgo real de la auditorÃ­a): antes, el Ãºnico acceso a
   * liquidaciones era admin_plataforma -- la cooperativa no tenÃ­a
   * ninguna forma de consultar cuÃ¡nto se le debe o cuÃ¡ndo se le pagÃ³
   * sin pedÃ­rselo al admin de plataforma cada vez. Solo lectura --
   * generar y marcar pagada siguen siendo exclusivos del admin de
   * plataforma, en /admin/liquidaciones.
   */
  @Roles('admin_cooperativa')
  @Get('liquidaciones')
  async listarMisLiquidaciones(@Request() req: { user: PayloadToken }) {
    return this.liquidaciones.listar(cooperativaDelToken(req.user));
  }

  /**
   * Ãtem 10, Fase 2 (04-ago-2026) -- actualizaciÃ³n periÃ³dica
   * obligatoria de datos de cooperativa (secciÃ³n 3.7 del documento
   * maestro). 6 meses sin confirmar = advertencia; 12 meses de
   * silencio total = se bloquea SOLO horarios recurrentes y carga
   * masiva -- nunca venta, validaciÃ³n de boletos, ni pagos.
   */
  @Roles('admin_cooperativa')
  @Get('estado-datos')
  async obtenerEstadoDatos(@Request() req: { user: PayloadToken }) {
    return this.panel.obtenerEstadoDatosCooperativa(cooperativaDelToken(req.user));
  }

  @Roles('admin_cooperativa')
  @Post('confirmar-datos')
  async confirmarDatos(
    @Body() dto: ConfirmarDatosCooperativaDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.panel.confirmarDatosCooperativa(cooperativaDelToken(req.user), dto);
  }
}
