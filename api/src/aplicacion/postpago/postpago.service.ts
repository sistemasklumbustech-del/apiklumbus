import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ProveedorFacturacionElectronica } from '../../dominio/facturacion/facturacion.ports';
import type {
  DatosVentaParaTasa,
  PasajeroParaTasa,
  ProveedorIntegracionTerminal,
} from '../../dominio/integraciones-terminal/integracion-terminal.ports';
import { PROVEEDOR_INTEGRACION_TERMINAL } from '../../dominio/integraciones-terminal/integracion-terminal.ports';
import {
  ErrorProveedorSinEfecto,
  PROVEEDOR_FACTURACION_POSTPAGO,
  TAREAS_POSTPAGO_REPOSITORIO,
  calcularProximoIntento,
  estadoCompraSegunTareas,
  tareasParaCompra,
  type ContextoVentaCooperativa,
  type FiltrosTareasPostpago,
  type TareaPostpago,
  type TareasPostpagoRepositorio,
} from '../../dominio/postpago/postpago.ports';
import { AuditoriaRegistrador } from '../../infraestructura/auditoria/auditoria.registrador';

type Resultado =
  | { tipo: 'ok'; resultado: Record<string, unknown> }
  /** El proveedor respondió que no: se puede reintentar más tarde (por ejemplo, saldo insuficiente). */
  | { tipo: 'rechazo'; error: string }
  /** Falta un paso previo; se vuelve a intentar pronto sin gastar un intento. */
  | { tipo: 'esperar'; motivo: string }
  /** No tiene sentido reintentar sin intervención de una persona. */
  | { tipo: 'bloqueada'; error: string };

const PRIORIDAD: Record<TareaPostpago['tipo'], number> = {
  factura_pasaje: 1,
  registro_tasa: 2,
  factura_plataforma: 3,
};

const SEGUNDOS_ESPERA_DEPENDENCIA = 30;

/** "04" RUC, "05" persona natural, "06" pasaporte (respuestas de Derpacif, 15-sep-2026). */
const TIPO_CLIENTE_SIAT = { ruc: '04', cedula: '05', pasaporte: '06' } as const;

/**
 * ⚠ Suposición sin confirmar: el manual del SIAT 3000 define cinco tipos de
 * pasajero (normal, adulto, niño, estudiante, especial) y no dice a qué
 * corresponde "adulto". Se asume que es el adulto mayor. Se confirma con
 * Derpacif o con la primera cooperativa antes de conectar el adaptador real.
 */
const TIPO_PASAJERO_SIAT: Record<string, PasajeroParaTasa['tipo']> = {
  adulto: 'normal',
  nino: 'infante',
  tercera_edad: 'adulto',
  discapacidad: 'especial',
};

/**
 * Orquestador posterior al pago (06-oct-2026): ver dominio/postpago/postpago.ports.ts.
 *
 * Apagado por defecto: solo actúa con ORQUESTADOR_POSTPAGO=1. Mientras los
 * proveedores sean simuladores, activarlo llena la base con facturas y tasas
 * simuladas, así que se prende en pruebas y cuando haya proveedores reales.
 */
@Injectable()
export class PostpagoService {
  private readonly logger = new Logger(PostpagoService.name);
  private enEjecucion = false;

  constructor(
    @Inject(TAREAS_POSTPAGO_REPOSITORIO) private readonly repo: TareasPostpagoRepositorio,
    @Inject(PROVEEDOR_FACTURACION_POSTPAGO) private readonly facturacion: ProveedorFacturacionElectronica,
    @Inject(PROVEEDOR_INTEGRACION_TERMINAL) private readonly terminal: ProveedorIntegracionTerminal,
    private readonly auditoria: AuditoriaRegistrador,
  ) {}

  static activo(): boolean {
    return process.env.ORQUESTADOR_POSTPAGO === '1';
  }

  /**
   * Se llama justo después de confirmar un pago. Crea las tareas y las
   * intenta una vez en el momento; lo que falle queda para el worker. Nunca
   * lanza: nada de esto debe tumbar una venta ya cobrada.
   */
  async programarYProcesar(compraId: string): Promise<void> {
    try {
      const { cooperativaIds, cargoPlataforma } = await this.repo.cooperativasYCargoDeCompra(compraId);
      await this.repo.programar(compraId, tareasParaCompra(cooperativaIds, cargoPlataforma));
      await this.procesarCompra(compraId);
    } catch (error) {
      this.logger.error(
        `No se pudieron programar las tareas posteriores al pago de la compra ${compraId}: ${this.mensaje(error)}`,
      );
    }
  }

  async procesarCompra(compraId: string): Promise<void> {
    const tareas = await this.repo.reclamarListas(50, compraId);
    await this.ejecutar(tareas);
    await this.actualizarEstadoCompra(compraId);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async procesarPendientes(): Promise<void> {
    if (!PostpagoService.activo() || this.enEjecucion) return;
    this.enEjecucion = true;
    try {
      const tareas = await this.repo.reclamarListas(20);
      if (tareas.length === 0) return;
      await this.ejecutar(tareas);
      for (const compraId of new Set(tareas.map((t) => t.compraId))) {
        await this.actualizarEstadoCompra(compraId);
      }
    } catch (error) {
      this.logger.error(`Falló el ciclo de tareas posteriores al pago: ${this.mensaje(error)}`);
    } finally {
      this.enEjecucion = false;
    }
  }

  listar(filtros: FiltrosTareasPostpago) {
    return this.repo.listar(filtros);
  }

  /** Acción de un administrador: vuelve a dejar lista una tarea agotada y la intenta de inmediato. */
  async reintentar(tareaId: string, usuarioId: string): Promise<boolean> {
    const tarea = await this.repo.obtener(tareaId);
    if (!tarea || !(await this.repo.reiniciar(tareaId))) return false;
    await this.auditoria.registrar({
      accion: 'postpago_tarea_reintentada',
      usuarioId,
      entidadTipo: 'tarea_postpago',
      entidadId: tareaId,
      detalle: { compraId: tarea.compraId, tipo: tarea.tipo },
    });
    await this.procesarCompra(tarea.compraId);
    return true;
  }

  private async ejecutar(tareas: TareaPostpago[]): Promise<void> {
    const ordenadas = [...tareas].sort((a, b) => PRIORIDAD[a.tipo] - PRIORIDAD[b.tipo]);
    for (const tarea of ordenadas) {
      await this.ejecutarUna(tarea);
    }
  }

  private async ejecutarUna(tarea: TareaPostpago): Promise<void> {
    let salida: Resultado;
    let ambiguo = false;
    try {
      salida = await this.manejar(tarea);
    } catch (error) {
      if (error instanceof ErrorProveedorSinEfecto) {
        salida = { tipo: 'rechazo', error: error.message };
      } else {
        ambiguo = true;
        salida = {
          tipo: 'bloqueada',
          error: `Respuesta ambigua del proveedor (${this.mensaje(error)}). Verificar en el proveedor antes de reintentar, para no duplicar la factura ni la tasa.`,
        };
      }
    }

    switch (salida.tipo) {
      case 'ok':
        await this.repo.marcarExitosa(tarea.id, salida.resultado);
        return;
      case 'esperar':
        await this.repo.posponer(tarea.id, new Date(Date.now() + SEGUNDOS_ESPERA_DEPENDENCIA * 1000), salida.motivo);
        return;
      case 'rechazo': {
        const intentosHechos = tarea.intentos + 1;
        if (intentosHechos >= tarea.maxIntentos) {
          await this.agotar(tarea, salida.error);
        } else {
          await this.repo.marcarReintento(tarea.id, salida.error, calcularProximoIntento(intentosHechos));
        }
        return;
      }
      case 'bloqueada':
        await this.agotar(tarea, salida.error, ambiguo);
        return;
    }
  }

  private async agotar(tarea: TareaPostpago, error: string, ambiguo = false): Promise<void> {
    await this.repo.marcarAgotada(tarea.id, error);
    this.logger.error(`Tarea ${tarea.tipo} de la compra ${tarea.compraId} necesita revisión: ${error}`);
    await this.auditoria.registrar({
      accion: 'postpago_tarea_agotada',
      entidadTipo: 'tarea_postpago',
      entidadId: tarea.id,
      detalle: { compraId: tarea.compraId, cooperativaId: tarea.cooperativaId, tipo: tarea.tipo, error, ambiguo },
      resultado: 'fallo',
      origen: 'sistema',
    });
  }

  private async manejar(tarea: TareaPostpago): Promise<Resultado> {
    switch (tarea.tipo) {
      case 'factura_pasaje':
        return this.facturarPasaje(tarea);
      case 'registro_tasa':
        return this.registrarTasa(tarea);
      case 'factura_plataforma':
        return this.facturarPlataforma(tarea);
    }
  }

  private async facturarPasaje(tarea: TareaPostpago): Promise<Resultado> {
    const ctx = await this.contexto(tarea);
    if (!ctx) return { tipo: 'bloqueada', error: 'No se encontraron los datos de la venta de esta cooperativa.' };

    const monto = this.redondear(ctx.pasajeros.reduce((a, p) => a + p.precioPagado + p.tasaTerminal, 0));
    const factura = await this.facturacion.emitirComprobante({
      montoTotal: monto,
      descripcion: `Pasaje de transporte terrestre - ${ctx.cooperativaNombre}`,
      rucOCedulaCliente: ctx.cliente.identificacion,
      nombreCliente: ctx.cliente.razonSocial,
      rucEmisor: ctx.cooperativaRuc,
      tipoIdentificacionCliente: ctx.cliente.tipoIdentificacion,
      correoCliente: ctx.cliente.correo ?? undefined,
      direccionCliente: ctx.cliente.direccion ?? undefined,
    });
    if (!factura.exitoso) return { tipo: 'rechazo', error: factura.error ?? 'El proveedor rechazó la factura.' };
    if (!factura.numeroFactura) {
      return { tipo: 'bloqueada', error: 'El proveedor no devolvió el número de factura, que el SIAT 3000 necesita.' };
    }

    await this.repo.guardarComprobanteCooperativa(tarea.compraId, ctx.cooperativaId, {
      rucEmisor: ctx.cooperativaRuc,
      monto,
      claveAcceso: factura.claveAcceso,
      numeroAutorizacion: factura.numeroAutorizacion,
      xmlUrl: factura.xmlUrl,
      pdfUrl: factura.pdfUrl,
    });
    return {
      tipo: 'ok',
      resultado: {
        numeroFactura: factura.numeroFactura,
        claveAcceso: factura.claveAcceso ?? null,
        numeroAutorizacion: factura.numeroAutorizacion ?? null,
        monto,
      },
    };
  }

  private async registrarTasa(tarea: TareaPostpago): Promise<Resultado> {
    const hermanas = await this.repo.tareasDeCompra(tarea.compraId);
    const factura = hermanas.find((t) => t.tipo === 'factura_pasaje' && t.cooperativaId === tarea.cooperativaId);
    if (!factura) return { tipo: 'bloqueada', error: 'No existe la tarea de la factura del pasaje.' };
    if (factura.estado === 'agotada') {
      return { tipo: 'bloqueada', error: 'La factura del pasaje no se pudo emitir, así que no se puede registrar la tasa.' };
    }
    if (factura.estado !== 'exitosa') return { tipo: 'esperar', motivo: 'Esperando la factura del pasaje.' };
    const numeroFactura = String(factura.resultado?.numeroFactura ?? '');

    const ctx = await this.contexto(tarea);
    if (!ctx) return { tipo: 'bloqueada', error: 'No se encontraron los datos de la venta de esta cooperativa.' };

    const total = this.redondear(ctx.pasajeros.reduce((a, p) => a + p.precioPagado + p.tasaTerminal, 0));
    const datos: DatosVentaParaTasa = {
      cooperativaId: ctx.cooperativaId,
      compraId: tarea.compraId,
      facturaNumero: numeroFactura,
      // Fase 3: el código del viaje del día y el destino del terminal salen de
      // mapeo_entidades_terminal. Con el simulador no se usan.
      codigoViaje: 'SIMULADO',
      destinoCodigoTerminal: 'SIMULADO',
      tipoCliente: TIPO_CLIENTE_SIAT[ctx.cliente.tipoIdentificacion],
      identificacionCliente: ctx.cliente.identificacion,
      razonSocialCliente: ctx.cliente.razonSocial,
      direccionCliente: ctx.cliente.direccion ?? undefined,
      correoCliente: ctx.cliente.correo ?? undefined,
      totalFacturado: total,
      // Numeración de asientos del terminal pendiente (carta a las cooperativas, E5): por ahora, orden de compra.
      pasajeros: ctx.pasajeros.map((p, i) => ({
        asiento: i + 1,
        tipo: TIPO_PASAJERO_SIAT[p.tipoTarifa],
        valor: this.redondear(p.precioPagado + p.tasaTerminal),
      })),
    };

    const respuesta = await this.terminal.registrarVentaYObtenerTasa(
      datos,
      `registro-${tarea.compraId}-${ctx.cooperativaId}`,
    );
    await this.repo.guardarResultadoTasa(tarea.compraId, ctx.cooperativaId, {
      exitoso: respuesta.exitoso,
      codigoTasa: respuesta.codigoTasa,
      mensaje: respuesta.mensaje ?? respuesta.error,
      saldoRestante: respuesta.saldoRestante,
      solicitud: { facturaNumero: numeroFactura, totalFacturado: total, pasajeros: datos.pasajeros },
      respuesta: { ...respuesta },
    });
    if (!respuesta.exitoso) {
      return { tipo: 'rechazo', error: respuesta.error ?? respuesta.mensaje ?? 'El terminal rechazó la venta.' };
    }
    return { tipo: 'ok', resultado: { codigoTasa: respuesta.codigoTasa ?? null, saldoRestante: respuesta.saldoRestante ?? null } };
  }

  private async facturarPlataforma(tarea: TareaPostpago): Promise<Resultado> {
    const { cargoPlataforma } = await this.repo.cooperativasYCargoDeCompra(tarea.compraId);
    if (cargoPlataforma <= 0) return { tipo: 'ok', resultado: { monto: 0, omitida: true } };
    const ruc = await this.repo.rucPlataforma();
    const factura = await this.facturacion.emitirComprobante({
      montoTotal: cargoPlataforma,
      descripcion: 'Cargo por servicio de plataforma Klumbus',
      rucEmisor: ruc,
    });
    if (!factura.exitoso) return { tipo: 'rechazo', error: factura.error ?? 'El proveedor rechazó la factura.' };
    await this.repo.guardarComprobantePlataforma(tarea.compraId, {
      rucEmisor: ruc,
      monto: cargoPlataforma,
      claveAcceso: factura.claveAcceso,
      numeroAutorizacion: factura.numeroAutorizacion,
      xmlUrl: factura.xmlUrl,
      pdfUrl: factura.pdfUrl,
    });
    return { tipo: 'ok', resultado: { monto: cargoPlataforma, claveAcceso: factura.claveAcceso ?? null } };
  }

  private async actualizarEstadoCompra(compraId: string): Promise<void> {
    const objetivo = estadoCompraSegunTareas(await this.repo.tareasDeCompra(compraId));
    if (!objetivo) return;
    await this.repo.transicionarCompra(compraId, 'tasa_confirmada');
    if (objetivo === 'completada') await this.repo.transicionarCompra(compraId, 'completada');
  }

  private contexto(tarea: TareaPostpago): Promise<ContextoVentaCooperativa | null> {
    if (!tarea.cooperativaId) return Promise.resolve(null);
    return this.repo.contextoVenta(tarea.compraId, tarea.cooperativaId);
  }

  private redondear(n: number): number {
    return Number(n.toFixed(2));
  }

  private mensaje(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
