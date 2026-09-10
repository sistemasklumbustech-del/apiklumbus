import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import type { AlmacenamientoArchivos } from '../../dominio/auth/auth.ports';
import { ALMACENAMIENTO_ARCHIVOS } from '../auth/auth.service';
import { NotificacionesProgramadasService } from '../notificaciones-programadas/notificaciones-programadas.service';
import { GeneradorViajesService } from '../generador-viajes/generador-viajes.service';
import { WalletService } from '../wallet/wallet.service';
import { ReferidosService } from '../referidos/referidos.service';
import type {
  PanelEmpresaRepositorio,
  DatosNuevoTipoVehiculo,
  DatosNuevaUnidad,
  DatosEditarTipoVehiculo,
  DatosEditarRuta,
  DatosNuevaRuta,
  DatosNuevaParada,
  DatosEditarParada,
  DatosNuevoViaje,
  DatosNuevoUsuarioStaff,
  DatosNuevoConductor,
  DatosImportacion,
  DatosNuevoHorarioRuta,
  DatosLegalesCooperativa,
} from '../../dominio/panelempresa/panel-empresa.ports';
import {
  validarDistribucionAsientos,
  calcularEstadoActualizacionDatos,
  type TipoMetodoPago,
  type EntidadFinanciera,
} from '../../dominio/panelempresa/panel-empresa.ports';

export const PANEL_EMPRESA_REPOSITORIO = 'PANEL_EMPRESA_REPOSITORIO';

@Injectable()
export class PanelEmpresaService {
  constructor(
    @Inject(PANEL_EMPRESA_REPOSITORIO)
    private readonly panel: PanelEmpresaRepositorio,
    @Inject(ALMACENAMIENTO_ARCHIVOS)
    private readonly almacenamiento: AlmacenamientoArchivos,
    private readonly notificaciones: NotificacionesProgramadasService,
    private readonly generadorViajes: GeneradorViajesService,
    private readonly wallet: WalletService,
    private readonly referidos: ReferidosService,
  ) {}

  crearTipoVehiculo(cooperativaId: string, datos: DatosNuevoTipoVehiculo) {
    // VacÃ­o real de diseÃ±o encontrado el 29-jul-2026 â€” se valida solo
    // cuando de verdad se estÃ¡ configurando una distribuciÃ³n real. El
    // DTO manda `{}` por defecto cuando el cliente no envÃ­a nada
    // (la columna es NOT NULL) â€” eso NO es un intento de configurar
    // pisos, es el valor de reserva, y no debe rechazarse.
    if (
      datos.distribucionAsientos !== undefined &&
      Object.keys(datos.distribucionAsientos as object).length > 0
    ) {
      const resultado = validarDistribucionAsientos(
        datos.distribucionAsientos,
        datos.capacidadTotal,
      );
      if (!resultado.ok) throw new BadRequestException(resultado.motivo);
    }
    return this.panel.crearTipoVehiculo(cooperativaId, datos);
  }

  listarTiposVehiculo(cooperativaId: string) {
    return this.panel.listarTiposVehiculo(cooperativaId);
  }

  /**
   * Cooperativas proponen sus propios puntos de operación (13-ago-2026).
   * El DTO (`@IsIn(['oficina_agencia', 'parada_intermedia'])`) ya
   * bloquea 'terminal_terrestre' a nivel de validación de entrada, pero
   * se repite la defensa aquí también -- si algún día alguien relaja
   * el DTO sin darse cuenta de esta regla de negocio, esta capa sigue
   * protegiendo. cooperativaId siempre viene del token autenticado
   * (nunca del cuerpo de la petición) -- una cooperativa nunca puede
   * proponer a nombre de otra.
   */
  proponerPuntoOperacion(
    cooperativaId: string,
    datos: { tipo: string; nombre: string; ciudad: string; provincia: string },
  ) {
    if (datos.tipo !== 'oficina_agencia' && datos.tipo !== 'parada_intermedia') {
      throw new BadRequestException(
        'Una cooperativa solo puede proponer oficina_agencia o parada_intermedia -- terminal_terrestre es exclusivo del administrador de plataforma.',
      );
    }
    return this.panel.proponerPuntoOperacion(cooperativaId, {
      tipo: datos.tipo,
      nombre: datos.nombre,
      ciudad: datos.ciudad,
      provincia: datos.provincia,
    });
  }

  editarTipoVehiculo(
    cooperativaId: string,
    tipoVehiculoId: string,
    datos: DatosEditarTipoVehiculo,
  ) {
    // Solo se puede validar la coherencia con la capacidad si ambos
    // valores llegan juntos en la misma ediciÃ³n â€” si solo se manda
    // distribucionAsientos sin capacidadTotal, no hay con quÃ©
    // comparar sin una consulta extra (fuera del alcance de esta
    // entrega, ver LEEME del mapa de asientos).
    if (
      datos.distribucionAsientos !== undefined &&
      Object.keys(datos.distribucionAsientos as object).length > 0 &&
      datos.capacidadTotal !== undefined
    ) {
      const resultado = validarDistribucionAsientos(
        datos.distribucionAsientos,
        datos.capacidadTotal,
      );
      if (!resultado.ok) throw new BadRequestException(resultado.motivo);
    }
    return this.panel.editarTipoVehiculo(cooperativaId, tipoVehiculoId, datos);
  }

  crearUnidad(cooperativaId: string, datos: DatosNuevaUnidad) {
    return this.panel.crearUnidad(cooperativaId, datos);
  }

  listarUnidades(cooperativaId: string) {
    return this.panel.listarUnidades(cooperativaId);
  }

  actualizarEstadoUnidad(
    cooperativaId: string,
    unidadId: string,
    activo: boolean,
  ) {
    return this.panel.actualizarEstadoUnidad(cooperativaId, unidadId, activo);
  }

  crearRuta(cooperativaId: string, datos: DatosNuevaRuta) {
    return this.panel.crearRuta(cooperativaId, datos);
  }

  listarRutas(cooperativaId: string) {
    return this.panel.listarRutas(cooperativaId);
  }

  agregarParada(cooperativaId: string, datos: DatosNuevaParada) {
    return this.panel.agregarParada(cooperativaId, datos);
  }

  listarParadas(cooperativaId: string, rutaId: string) {
    return this.panel.listarParadas(cooperativaId, rutaId);
  }

  editarParada(cooperativaId: string, paradaId: string, datos: DatosEditarParada) {
    return this.panel.editarParada(cooperativaId, paradaId, datos);
  }

  eliminarParada(cooperativaId: string, paradaId: string) {
    return this.panel.eliminarParada(cooperativaId, paradaId);
  }

  editarRuta(cooperativaId: string, rutaId: string, datos: DatosEditarRuta) {
    return this.panel.editarRuta(cooperativaId, rutaId, datos);
  }

  crearViaje(cooperativaId: string, datos: DatosNuevoViaje) {
    return this.panel.crearViaje(cooperativaId, datos);
  }

  listarViajes(cooperativaId: string) {
    return this.panel.listarViajes(cooperativaId);
  }

  /**
   * 03-ago-2026 -- notifica ANTES de cancelar a propÃ³sito: la
   * notificaciÃ³n necesita ver los boletos todavÃ­a 'vigente' para saber
   * a quiÃ©n avisar; despuÃ©s de cancelar ya no los encontrarÃ­a.
   */
  async cancelarViaje(cooperativaId: string, viajeId: string) {
    await this.notificaciones.notificarCambioOperativo(
      cooperativaId,
      viajeId,
      'Tu viaje fue cancelado. Se generÃ³ un crÃ©dito por el monto pagado, disponible en tu cuenta.',
    );
    return this.panel.cancelarViaje(cooperativaId, viajeId);
  }

  /**
   * Horarios recurrentes (plantilla) â€” Ã­tem 7, RF-COOP-002.
   */
  /**
   * Ãtem 10, Fase 2 (04-ago-2026) -- bloqueado si la cooperativa lleva
   * 12 meses sin confirmar sus datos legales. Nunca bloquea venta,
   * validaciÃ³n de boletos, ni pagos -- solo esta funciÃ³n y la carga
   * masiva (decisiÃ³n del director).
   */
  async crearHorarioRuta(cooperativaId: string, datos: DatosNuevoHorarioRuta) {
    await this.verificarNoBloqueadoPorDatos(cooperativaId);
    return this.panel.crearHorarioRuta(cooperativaId, datos);
  }

  listarHorariosRuta(cooperativaId: string, rutaId?: string) {
    return this.panel.listarHorariosRuta(cooperativaId, rutaId);
  }

  actualizarEstadoHorarioRuta(cooperativaId: string, horarioId: string, activo: boolean) {
    return this.panel.actualizarEstadoHorarioRuta(cooperativaId, horarioId, activo);
  }

  /**
   * CancelaciÃ³n/suspensiÃ³n masiva â€” Ã­tem 7. Reutiliza cancelarViaje()
   * de arriba por cada viaje afectado (misma lÃ³gica de crÃ©dito +
   * notificaciÃ³n + cascada de boletos, sin duplicarla).
   */
  async cancelarViajesMasivo(
    cooperativaId: string,
    rutaId: string,
    fechaInicio: string,
    fechaFin: string,
  ) {
    const viajeIds = await this.panel.listarViajesProgramadosEnRango(
      cooperativaId,
      rutaId,
      fechaInicio,
      fechaFin,
    );

    let viajesCancelados = 0;
    let boletosCancelados = 0;
    for (const viajeId of viajeIds) {
      const resultado = await this.cancelarViaje(cooperativaId, viajeId);
      if (resultado.ok) {
        viajesCancelados++;
        boletosCancelados += resultado.boletosCancelados;
      }
    }

    return { viajesCancelados, boletosCancelados, viajesEncontrados: viajeIds.length };
  }

  async cambiarUnidadViaje(
    cooperativaId: string,
    viajeId: string,
    nuevaUnidadId: string,
  ) {
    const resultado = await this.panel.cambiarUnidadViaje(
      cooperativaId,
      viajeId,
      nuevaUnidadId,
    );
    // RF-NOTIF-003 (03-ago-2026) -- solo se avisa si el cambio se aplicÃ³
    // de verdad, nunca si fue rechazado por regla de negocio (capacidad
    // insuficiente, viaje no programado, etc).
    if (resultado.ok) {
      await this.notificaciones.notificarCambioOperativo(
        cooperativaId,
        viajeId,
        'Se cambiÃ³ la unidad asignada a tu viaje.',
      );
    }
    return resultado;
  }

  editarViaje(
    cooperativaId: string,
    viajeId: string,
    datos: { horaSalidaProgramada?: string; precioBase?: number },
  ) {
    return this.panel.editarViaje(cooperativaId, viajeId, datos);
  }

  listarPasajerosDeViaje(cooperativaId: string, viajeId: string) {
    return this.panel.listarPasajerosDeViaje(cooperativaId, viajeId);
  }

  crearUsuarioStaff(cooperativaId: string, datos: DatosNuevoUsuarioStaff) {
    return this.panel.crearUsuarioStaff(cooperativaId, datos);
  }

  listarUsuariosStaff(cooperativaId: string) {
    return this.panel.listarUsuariosStaff(cooperativaId);
  }

  crearConductor(cooperativaId: string, datos: DatosNuevoConductor) {
    return this.panel.crearConductor(cooperativaId, datos);
  }

  listarConductores(cooperativaId: string) {
    return this.panel.listarConductores(cooperativaId);
  }

  /**
   * 04-ago-2026 -- Ã­tem 8: la generaciÃ³n de viajes ya no ocurre dentro
   * del repositorio (ver comentario en panel-empresa.repositorio.drizzle.ts)
   * -- se dispara aquÃ­, despuÃ©s, con el mismo mecanismo que el cron del
   * Ã­tem 7 (GeneradorViajesService), en vez de un camino paralelo mÃ¡s
   * dÃ©bil que existÃ­a antes.
   */
  async importarDatos(cooperativaId: string, datos: DatosImportacion) {
    // Ãtem 10, Fase 2 (04-ago-2026) -- mismo bloqueo que crearHorarioRuta.
    await this.verificarNoBloqueadoPorDatos(cooperativaId);

    const resultado = await this.panel.importarDatos(cooperativaId, datos);

    let viajesGenerados = 0;
    if (
      datos.generarViajesDesde &&
      datos.generarViajesHasta &&
      resultado.horarioIds.length > 0
    ) {
      const generado = await this.generadorViajes.generarViajesParaHorarios(
        resultado.horarioIds,
        new Date(`${datos.generarViajesDesde}T00:00:00`),
        new Date(`${datos.generarViajesHasta}T00:00:00`),
      );
      viajesGenerados = generado.generados;
    }

    const { horarioIds: _horarioIds, ...resto } = resultado;
    return { ...resto, viajesGenerados };
  }

  dashboardVentasDelDia(cooperativaId: string) {
    return this.panel.dashboardVentasDelDia(cooperativaId);
  }

  obtenerPerfil(cooperativaId: string) {
    return this.panel.obtenerPerfil(cooperativaId);
  }

  actualizarPerfil(cooperativaId: string, datos: { logoUrl: string | null }) {
    return this.panel.actualizarPerfil(cooperativaId, datos);
  }

  async subirLogoCooperativa(
    cooperativaId: string,
    buffer: Buffer,
    nombreOriginal: string,
  ) {
    const resultado = await this.almacenamiento.guardarImagen(
      buffer,
      nombreOriginal,
      'logos',
    );
    await this.panel.actualizarPerfil(cooperativaId, { logoUrl: resultado.url });
    return { url: resultado.url };
  }

  obtenerConfiguracionFiscal(cooperativaId: string) {
    return this.panel.obtenerConfiguracionFiscal(cooperativaId);
  }

  actualizarConfiguracionFiscal(
    cooperativaId: string,
    datos: {
      ivaPorcentaje: number;
      ivaVisibleEnBoleto: boolean;
      ivaSigueTasaNacional: boolean;
    },
  ) {
    return this.panel.actualizarConfiguracionFiscal(cooperativaId, datos);
  }

  obtenerConfiguracionVip(cooperativaId: string) {
    return this.panel.obtenerConfiguracionVip(cooperativaId);
  }

  actualizarConfiguracionVip(cooperativaId: string, recargoVipDefault: number) {
    return this.panel.actualizarConfiguracionVip(cooperativaId, recargoVipDefault);
  }

  obtenerHorasLimiteReprogramacion(cooperativaId: string) {
    return this.panel.obtenerHorasLimiteReprogramacion(cooperativaId);
  }

  actualizarHorasLimiteReprogramacion(cooperativaId: string, horas: number) {
    return this.panel.actualizarHorasLimiteReprogramacion(cooperativaId, horas);
  }

  obtenerPoliticaCancelacionReprogramacion(cooperativaId: string) {
    return this.panel.obtenerPoliticaCancelacionReprogramacion(cooperativaId);
  }

  actualizarPoliticaCancelacionReprogramacion(
    cooperativaId: string,
    datos: {
      permiteCancelacion?: boolean;
      horasLimiteCancelacion?: number;
      permiteReprogramacion?: boolean;
      horasLimiteReprogramacion?: number;
    },
  ) {
    return this.panel.actualizarPoliticaCancelacionReprogramacion(cooperativaId, datos);
  }

  listarMetodosPago(cooperativaId: string) {
    return this.panel.listarMetodosPago(cooperativaId);
  }

  /**
   * Item 21/22 (06-ago-2026) -- regla de negocio real: si el tipo es
   * transferencia_bancaria, la entidad financiera es obligatoria --
   * catalogo cerrado, no tiene sentido guardar una transferencia sin
   * saber a que banco/cooperativa pertenece.
   */
  guardarMetodoPago(
    cooperativaId: string,
    tipo: TipoMetodoPago,
    datosCuenta: Record<string, string>,
    activo: boolean,
    entidadFinanciera: EntidadFinanciera | null,
  ) {
    if (tipo === 'transferencia_bancaria' && !entidadFinanciera) {
      throw new BadRequestException('Elige el banco o entidad receptora de la transferencia.');
    }
    const entidadReal = tipo === 'transferencia_bancaria' ? entidadFinanciera : null;
    return this.panel.guardarMetodoPago(cooperativaId, tipo, datosCuenta, activo, entidadReal);
  }

  eliminarMetodoPago(cooperativaId: string, metodoPagoId: string) {
    return this.panel.eliminarMetodoPago(cooperativaId, metodoPagoId);
  }

  listarCredencialesApi(cooperativaId: string) {
    return this.panel.listarCredencialesApi(cooperativaId);
  }

  crearCredencialApi(cooperativaId: string, webhookUrl: string | null) {
    return this.panel.crearCredencialApi(cooperativaId, webhookUrl);
  }

  rotarCredencialApi(cooperativaId: string, credencialId: string) {
    return this.panel.rotarCredencialApi(cooperativaId, credencialId);
  }

  revocarCredencialApi(cooperativaId: string, credencialId: string) {
    return this.panel.revocarCredencialApi(cooperativaId, credencialId);
  }

  actualizarWebhookCredencialApi(
    cooperativaId: string,
    credencialId: string,
    webhookUrl: string | null,
  ) {
    return this.panel.actualizarWebhookCredencialApi(cooperativaId, credencialId, webhookUrl);
  }

  /**
   * Wallet/cashback Fase 1 (13-ago-2026) -- justo después de que el
   * boleto pasa a 'usado' de verdad, se intenta acreditar cashback
   * (WalletService nunca lanza -- ver comentario ahí). Los 3 campos
   * internos que el repositorio agrega para esto (compraId,
   * precioPagado, compradorUsuarioId) se consumen aquí y NUNCA se
   * devuelven en la respuesta HTTP -- el vendedor en la terminal no
   * necesita ver el precio pagado ni el id del comprador, solo si el
   * boleto es válido.
   */
  async validarBoletoPorQr(
    cooperativaId: string,
    codigoQr: string,
    validadoPorUsuarioId: string,
  ) {
    const resultado = await this.panel.validarBoletoPorQr(
      cooperativaId,
      codigoQr,
      validadoPorUsuarioId,
    );

    if (resultado.valido && resultado.compraId && resultado.precioPagado !== undefined) {
      await this.wallet.acreditarCashbackPorValidacion({
        compradorUsuarioId: resultado.compradorUsuarioId ?? null,
        compraId: resultado.compraId,
        precioPagado: resultado.precioPagado,
      });
    }

    // Programa de referidos (13-ago-2026) -- mismo punto exacto y
    // mismo criterio que el cashback de arriba: justo después de que
    // el boleto pasa a 'usado' de verdad. Si este boleto es el primer
    // viaje real de alguien que fue referido, el referidor gana su
    // crédito aquí -- nunca antes.
    if (resultado.valido && resultado.boletoId) {
      await this.referidos.acreditarReferidorPorValidacion({
        usuarioReferidoId: resultado.compradorUsuarioId ?? null,
        boletoId: resultado.boletoId,
      });
    }

    const { compraId, precioPagado, compradorUsuarioId, boletoId, ...respuestaPublica } = resultado;
    void compraId;
    void precioPagado;
    void compradorUsuarioId;
    void boletoId;
    return respuestaPublica;
  }

  verificarMenor(
    cooperativaId: string,
    boletoId: string,
    verificadoPorUsuarioId: string,
    documentoIdentidadVerificado: boolean,
    documentoAutorizacionVerificado: boolean,
  ) {
    return this.panel.verificarMenor(
      cooperativaId,
      boletoId,
      verificadoPorUsuarioId,
      documentoIdentidadVerificado,
      documentoAutorizacionVerificado,
    );
  }

  /**
   * Ãtem 10, Fase 2 (04-ago-2026) -- actualizaciÃ³n periÃ³dica
   * obligatoria de datos de cooperativa (secciÃ³n 3.7 del documento
   * maestro). 6 meses sin confirmar = advertencia (banner en el
   * panel, no bloqueante). 12 meses de silencio total = se bloquea
   * SOLO creaciÃ³n de horarios recurrentes y carga masiva.
   */
  async obtenerEstadoDatosCooperativa(cooperativaId: string) {
    const { ultimaConfirmacion, fechaAfiliacion, datosActuales } =
      await this.panel.obtenerEstadoActualizacionDatos(cooperativaId);
    const estado = calcularEstadoActualizacionDatos(ultimaConfirmacion, fechaAfiliacion);
    return { ...estado, datosActuales };
  }

  async confirmarDatosCooperativa(
    cooperativaId: string,
    datos: Partial<DatosLegalesCooperativa>,
  ) {
    await this.panel.confirmarDatosCooperativa(cooperativaId, datos);
    return { ok: true };
  }

  /**
   * No lanza si no hay suficiente informaciÃ³n para evaluar (mismo
   * criterio conservador que calcularEstadoActualizacionDatos): un
   * hueco de datos no debe convertirse en un bloqueo injusto.
   */
  private async verificarNoBloqueadoPorDatos(cooperativaId: string): Promise<void> {
    const { ultimaConfirmacion, fechaAfiliacion } =
      await this.panel.obtenerEstadoActualizacionDatos(cooperativaId);
    const estado = calcularEstadoActualizacionDatos(ultimaConfirmacion, fechaAfiliacion);
    if (estado.estado === 'bloqueado') {
      throw new BadRequestException(
        `Tus datos de cooperativa llevan ${estado.mesesSinConfirmar} meses sin confirmarse. Confirma tus datos legales en la secciÃ³n de configuraciÃ³n para poder crear horarios recurrentes o usar la carga masiva.`,
      );
    }
  }
}
