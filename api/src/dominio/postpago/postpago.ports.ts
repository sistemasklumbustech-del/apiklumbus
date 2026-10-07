/**
 * Orquestador posterior al pago (06-oct-2026).
 *
 * Una compra cobrada todavía necesita tres cosas antes de estar completa:
 * la factura del pasaje de cada cooperativa, el registro de la venta en el
 * SIAT 3000 (que exige el número de esa factura y entrega el QR del
 * torniquete) y la factura del cargo de servicio de Klumbus. Cada una es una
 * tarea persistente con reintentos: un proveedor caído o un saldo agotado no
 * debe perder la venta ni dejarla a medias sin que nadie lo sepa.
 */

export type TipoTareaPostpago = 'factura_pasaje' | 'registro_tasa' | 'factura_plataforma';
export type EstadoTareaPostpago = 'pendiente' | 'en_proceso' | 'exitosa' | 'agotada';

export interface TareaPostpago {
  id: string;
  compraId: string;
  cooperativaId: string | null;
  tipo: TipoTareaPostpago;
  estado: EstadoTareaPostpago;
  intentos: number;
  maxIntentos: number;
  proximoIntentoEn: string;
  ultimoError: string | null;
  resultado: Record<string, unknown> | null;
  creadoEn: string;
  completadoEn: string | null;
}

export const MAX_INTENTOS_POSTPAGO = 6;

/**
 * Un proveedor lanza esto cuando está seguro de que NO llegó a hacer nada
 * (por ejemplo, no pudo conectarse): ahí es seguro reintentar solo. Cualquier
 * otro error lanzado es ambiguo (¿la factura salió y se cortó la respuesta?),
 * y reintentar a ciegas podría duplicar una factura o cobrar dos veces la
 * tasa del terminal, así que esa tarea pasa a revisión manual.
 */
export class ErrorProveedorSinEfecto extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorProveedorSinEfecto';
  }
}

/** Espera, en minutos, antes de cada reintento: 1, 5, 15, 60, 180 y 360. */
const ESPERAS_MINUTOS = [1, 5, 15, 60, 180, 360];

/**
 * Cuándo reintentar después del intento número `intentosHechos` (1 = el
 * primero que falló). Crece rápido al principio, para cubrir cortes cortos,
 * y se espacia después, para no martillar a un proveedor caído.
 */
export function calcularProximoIntento(intentosHechos: number, ahora: Date = new Date()): Date {
  const indice = Math.min(Math.max(intentosHechos, 1), ESPERAS_MINUTOS.length) - 1;
  return new Date(ahora.getTime() + ESPERAS_MINUTOS[indice] * 60_000);
}

/** Qué tareas hay que crear para una compra, a partir de las cooperativas que la componen. */
export function tareasParaCompra(
  cooperativaIds: string[],
  cargoPlataforma: number,
): { tipo: TipoTareaPostpago; cooperativaId: string | null }[] {
  const tareas: { tipo: TipoTareaPostpago; cooperativaId: string | null }[] = [];
  for (const cooperativaId of cooperativaIds) {
    tareas.push({ tipo: 'factura_pasaje', cooperativaId });
    tareas.push({ tipo: 'registro_tasa', cooperativaId });
  }
  if (cargoPlataforma > 0) tareas.push({ tipo: 'factura_plataforma', cooperativaId: null });
  return tareas;
}

/** Estado al que debe avanzar la compra según cómo van sus tareas, o null si no cambia. */
export function estadoCompraSegunTareas(
  tareas: Pick<TareaPostpago, 'tipo' | 'estado'>[],
): 'tasa_confirmada' | 'completada' | null {
  if (tareas.length === 0) return null;
  const tasas = tareas.filter((t) => t.tipo === 'registro_tasa');
  const tasasListas = tasas.length > 0 && tasas.every((t) => t.estado === 'exitosa');
  if (tareas.every((t) => t.estado === 'exitosa')) return 'completada';
  if (tasasListas) return 'tasa_confirmada';
  return null;
}

/** Forma de los datos con los que se factura, ya resuelta (con o sin lo que envió el cliente). */
export interface ClienteFactura {
  tipoIdentificacion: 'cedula' | 'ruc' | 'pasaporte';
  identificacion: string;
  razonSocial: string;
  correo: string | null;
  direccion: string | null;
}

export interface PasajeroVenta {
  asientoEtiqueta: string;
  viajeId: string;
  tipoTarifa: 'adulto' | 'nino' | 'tercera_edad' | 'discapacidad';
  precioPagado: number;
  tasaTerminal: number;
}

/** Todo lo que hace falta para facturar y registrar la tasa de una cooperativa en una compra. */
export interface ContextoVentaCooperativa {
  cooperativaId: string;
  cooperativaRuc: string;
  cooperativaNombre: string;
  cliente: ClienteFactura;
  pasajeros: PasajeroVenta[];
}

export interface FiltrosTareasPostpago {
  estado?: EstadoTareaPostpago;
  compraId?: string;
  pagina: number;
  limite: number;
}

export interface TareasPostpagoRepositorio {
  /** Crea las tareas que falten; no duplica las que ya existen. */
  programar(
    compraId: string,
    tareas: { tipo: TipoTareaPostpago; cooperativaId: string | null }[],
  ): Promise<void>;
  /** Toma (y marca en proceso) las tareas que ya les toca, opcionalmente solo las de una compra. */
  reclamarListas(limite: number, compraId?: string): Promise<TareaPostpago[]>;
  tareasDeCompra(compraId: string): Promise<TareaPostpago[]>;
  marcarExitosa(id: string, resultado: Record<string, unknown>): Promise<void>;
  /** Un intento falló pero quedan más: reprograma contando el intento. */
  marcarReintento(id: string, error: string, proximoIntentoEn: Date): Promise<void>;
  marcarAgotada(id: string, error: string): Promise<void>;
  /** Todavía no se puede hacer (falta un paso previo): reprograma sin gastar un intento. */
  posponer(id: string, proximoIntentoEn: Date, motivo: string): Promise<void>;
  /** Vuelve a dejar lista una tarea agotada (acción de un administrador). */
  reiniciar(id: string): Promise<boolean>;
  listar(filtros: FiltrosTareasPostpago): Promise<{ filas: TareaPostpago[]; total: number }>;
  obtener(id: string): Promise<TareaPostpago | null>;

  cooperativasYCargoDeCompra(compraId: string): Promise<{ cooperativaIds: string[]; cargoPlataforma: number }>;
  contextoVenta(compraId: string, cooperativaId: string): Promise<ContextoVentaCooperativa | null>;
  /** Registra el resultado de la tasa en el registro local que se crea al confirmar el pago. */
  guardarResultadoTasa(
    compraId: string,
    cooperativaId: string,
    datos: {
      exitoso: boolean;
      codigoTasa?: string;
      mensaje?: string;
      saldoRestante?: number;
      solicitud: Record<string, unknown>;
      respuesta: Record<string, unknown>;
    },
  ): Promise<void>;
  /** Avanza el estado de la compra si corresponde; no hace nada si ya pasó de ahí. Devuelve si cambió. */
  transicionarCompra(compraId: string, estado: 'tasa_confirmada' | 'completada'): Promise<boolean>;
  rucPlataforma(): Promise<string>;
  /** Guarda la factura del cargo de servicio de la plataforma, sin duplicarla si ya existe. */
  guardarComprobantePlataforma(
    compraId: string,
    datos: { rucEmisor: string; monto: number; claveAcceso?: string; numeroAutorizacion?: string; xmlUrl?: string; pdfUrl?: string },
  ): Promise<void>;
  /** Guarda la factura del pasaje de una cooperativa, sin duplicarla si ya existe. */
  guardarComprobanteCooperativa(
    compraId: string,
    cooperativaId: string,
    datos: {
      rucEmisor: string;
      monto: number;
      claveAcceso?: string;
      numeroAutorizacion?: string;
      xmlUrl?: string;
      pdfUrl?: string;
    },
  ): Promise<void>;
}

export const TAREAS_POSTPAGO_REPOSITORIO = 'TAREAS_POSTPAGO_REPOSITORIO';
/** Mismo proveedor de facturación que usa el checkout; token propio para no importar el servicio de ventas. */
export const PROVEEDOR_FACTURACION_POSTPAGO = 'PROVEEDOR_FACTURACION_POSTPAGO';
