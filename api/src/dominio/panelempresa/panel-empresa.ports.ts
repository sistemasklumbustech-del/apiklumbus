/**
 * Dominio del Panel Empresa — RF-COOP, RF-FLOTA.
 */

import { ETIQUETAS_VALIDAS } from '../asientos/distribucion-asientos.util';

/**
 * Métodos de pago manuales (29-jul-2026) — ver metodos-pago.ts en el
 * paquete de base de datos para el contexto completo de negocio.
 */
export type TipoMetodoPago =
  | 'transferencia_bancaria'
  | 'efectivo'
  | 'deuna'
  | 'payphone'
  | 'tarjeta_pasarela';

/**
 * Ítem 21/22 (06-ago-2026) -- catálogo cerrado de entidad financiera,
 * ver enums.ts en el paquete de base de datos para el contexto
 * completo de por qué el texto libre no era suficiente.
 */
export type EntidadFinanciera =
  | 'banco_pichincha'
  | 'banco_guayaquil'
  | 'banco_pacifico'
  | 'produbanco'
  | 'banco_bolivariano'
  | 'banco_internacional'
  | 'diners_club'
  | 'banco_ruminahui'
  | 'coop_jep'
  | 'coop_jardin_azuayo'
  | 'otro';

export interface MetodoPagoCooperativa {
  id: string;
  tipo: TipoMetodoPago;
  activo: boolean;
  datosCuenta: Record<string, string>;
  /** Solo aplica cuando tipo = 'transferencia_bancaria', null en el resto. */
  entidadFinanciera: EntidadFinanciera | null;
}

/**
 * Credenciales API — Modelo B (02-ago-2026), RF-API-001/003. Autoservicio
 * de la propia cooperativa (decisión de negocio confirmada, sección 3.11
 * del documento maestro) — mismo criterio que métodos de pago arriba.
 *
 * `apiKeyPrefix` es el identificador público (patrón Stripe/GitHub) --
 * la llave completa (con el secreto) solo se devuelve UNA vez, al crear
 * o al rotar; después de eso, ni el backend puede volver a mostrarla
 * completa (solo el hash queda guardado).
 */
export interface CredencialApiCooperativa {
  id: string;
  tipo: 'api_key';
  apiKeyPrefix: string;
  webhookUrl: string | null;
  activo: boolean;
  creadoEn: string;
  revocadoEn: string | null;
}

export interface CredencialApiRecienCreada {
  id: string;
  apiKeyPrefix: string;
  /** Llave completa en texto plano -- se muestra UNA sola vez, nunca se vuelve a guardar así. */
  apiKeyCompleta: string;
}

/**
 * Horarios recurrentes (plantilla) — ítem 7, Fase 2 (03-ago-2026),
 * RF-COOP-002. El generador (módulo aparte, cron diario) crea filas de
 * `viajes` a partir de estas plantillas -- SOLO con INSERT, nunca
 * UPDATE: si ya existe un viaje para (horarioRutaId, fecha), la
 * plantilla nunca vuelve a tocarlo, ni siquiera si alguien lo editó a
 * mano. Mismo patrón que calendarios con eventos recurrentes +
 * excepciones (decisión del director, 03-ago-2026).
 */
export interface HorarioRutaResumen {
  id: string;
  rutaId: string;
  horaSalida: string;
  diasSemana: number[]; // 0=domingo..6=sábado
  tipoVehiculoPredeterminadoId: string;
  tipoVehiculoNombre: string;
  activo: boolean;
}

export interface DatosNuevoHorarioRuta {
  rutaId: string;
  horaSalida: string;
  diasSemana: number[];
  // Requerido en la práctica (aunque la columna de esquema es nullable):
  // el generador necesita saber qué tipo de unidad buscar disponible
  // para poder crear el viaje.
  tipoVehiculoPredeterminadoId: string;
}

/**
 * Cancelación/suspensión masiva — ítem 7, Fase 2 (03-ago-2026),
 * RF-COOP contratiempos operativos. Decisión del director: los viajes
 * con boletos vendidos SÍ se cancelan (no se bloquea la acción ni se
 * saltan en silencio), generando crédito automático por el monto
 * pagado y notificando por WhatsApp -- mismo criterio de compensación
 * justa que ya usa reprogramación, reutilizado aquí.
 */
export interface ResultadoCancelacionMasiva {
  viajesCancelados: number;
  boletosCancelados: number;
  viajesSinCambios: number; // ya estaban en otro estado (cancelado/completado/etc), no se tocaron
}

/**
 * Vacío real de diseño encontrado el 29-jul-2026: `distribucionAsientos`
 * ya se guardaba (tipo `unknown`), pero nunca tuvo una forma definida
 * ni el frontend la usaba — el mapa de asientos siempre dibujaba una
 * simplificación de 2+2, sin importar si el bus real tenía dos pisos o
 * sección VIP. Esta es la forma real, mínima pero completa:
 *
 * - Uno o más "pisos" (buses de un piso solo declaran uno).
 * - Cada piso tiene filas; cada fila es una lista de celdas.
 * - Una celda es el número de asiento (string) o `null` — `null`
 *   representa el pasillo (hueco visual entre columnas de asientos).
 * - `categoria` en el piso es opcional, solo para mostrar una
 *   etiqueta/color distinto en el frontend (ej. "VIP", "Cama").
 */
export interface PisoDistribucionAsientos {
  nombre: string;
  categoria?: string;
  filas: Array<{ celdas: Array<string | null> }>;
}

export interface DistribucionAsientos {
  pisos: PisoDistribucionAsientos[];
}

/**
 * Valida que la distribución tenga forma correcta y que la cantidad
 * real de asientos (celdas no nulas, sin duplicados) coincida
 * exactamente con `capacidadTotal` — evita que un tipo de vehículo
 * quede con un mapa de asientos que miente sobre cuántos puestos
 * vende de verdad.
 */
export function validarDistribucionAsientos(
  distribucion: unknown,
  capacidadTotal: number,
): { ok: true } | { ok: false; motivo: string } {
  if (
    typeof distribucion !== 'object' ||
    distribucion === null ||
    !Array.isArray((distribucion as DistribucionAsientos).pisos) ||
    (distribucion as DistribucionAsientos).pisos.length === 0
  ) {
    return {
      ok: false,
      motivo: 'La distribución de asientos debe tener al menos un piso con filas.',
    };
  }

  const numeros = new Set<string>();
  for (const piso of (distribucion as DistribucionAsientos).pisos) {
    if (typeof piso.nombre !== 'string' || !piso.nombre.trim()) {
      return { ok: false, motivo: 'Cada piso necesita un nombre.' };
    }
    if (!Array.isArray(piso.filas)) {
      return { ok: false, motivo: `El piso "${piso.nombre}" no tiene filas.` };
    }
    for (const fila of piso.filas) {
      if (!Array.isArray(fila.celdas)) {
        return {
          ok: false,
          motivo: `Una fila del piso "${piso.nombre}" no tiene celdas válidas.`,
        };
      }
      for (const celda of fila.celdas) {
        if (celda === null) continue;
        // Zona VIP de asientos (17-ago-2026) -- hallazgo real
        // encontrado al construir esta función: esta validación solo
        // aceptaba el formato viejo (string), rechazando el formato
        // nuevo con etiquetas ({numero, etiquetas}) que el resto del
        // sistema (interpretarCelda, el mapa de asientos, el cálculo
        // del checkout) ya soporta desde el 05-ago-2026 -- ninguna
        // cooperativa podía crear un asiento VIP real hasta ahora, ni
        // siquiera por la API directamente. Corregido: acepta ambos
        // formatos, mismo tipo `Celda` real ya compartido.
        const esFormatoNuevo = typeof celda === 'object' && celda !== null;
        const numero = esFormatoNuevo ? (celda as { numero: string }).numero : celda;
        const etiquetas = esFormatoNuevo ? (celda as { etiquetas?: string[] }).etiquetas : undefined;

        if (typeof numero !== 'string' || !numero.trim()) {
          return {
            ok: false,
            motivo: `Un asiento del piso "${piso.nombre}" tiene un número inválido.`,
          };
        }
        if (etiquetas !== undefined) {
          if (!Array.isArray(etiquetas) || etiquetas.some((e) => !ETIQUETAS_VALIDAS.includes(e as never))) {
            return {
              ok: false,
              motivo: `El asiento "${numero}" tiene una etiqueta inválida -- válidas: ${ETIQUETAS_VALIDAS.join(', ')}.`,
            };
          }
        }
        if (numeros.has(numero)) {
          return {
            ok: false,
            motivo: `El número de asiento "${numero}" está repetido — cada asiento debe ser único en todo el vehículo.`,
          };
        }
        numeros.add(numero);
      }
    }
  }

  if (numeros.size !== capacidadTotal) {
    return {
      ok: false,
      motivo: `La distribución tiene ${numeros.size} asientos, pero la capacidad declarada es ${capacidadTotal} — deben coincidir exactamente.`,
    };
  }

  return { ok: true };
}

/**
 * Ítem 11, Fase 2 (04-ago-2026) -- catálogo cerrado de amenidades,
 * decisión del director (30-jul-2026, sección 3.2 del documento maestro).
 */
export type Amenidad =
  | 'wifi'
  | 'aire_acondicionado'
  | 'bano_a_bordo'
  | 'cargadores'
  | 'asientos_reclinables'
  | 'tv';

export interface DatosNuevoTipoVehiculo {
  nombre: string;
  categoria?: 'bus' | 'buseta' | 'van' | 'auto';
  capacidadTotal: number;
  distribucionAsientos?: unknown;
  amenidades?: Amenidad[];
}

export interface DatosEditarTipoVehiculo {
  nombre?: string;
  categoria?: 'bus' | 'buseta' | 'van' | 'auto';
  capacidadTotal?: number;
  distribucionAsientos?: unknown;
  activo?: boolean;
  amenidades?: Amenidad[];
}

export interface DatosEditarRuta {
  nombre?: string;
  precioBaseReferencia?: number;
  activa?: boolean;
}

export interface DatosNuevaUnidad {
  tipoVehiculoId: string;
  placa: string;
  identificadorOperativo: string;
}

export interface DatosNuevaRuta {
  origenPuntoOperacionId: string;
  destinoPuntoOperacionId: string;
  precioBaseReferencia: number;
  nombre?: string;
}

/**
 * Paradas intermedias de una ruta -- RF-COOP-002. Cada parada tiene su
 * propio precio real (`tarifaDesdeOrigen`), decidido a mano por la
 * cooperativa -- nunca un porcentaje ni una formula automatica. Un
 * mismo destino final (ej. Quito) puede tener varias paradas propias
 * (Quitumbe, luego la terminal propia de la cooperativa), no solo una
 * por ciudad.
 */
export interface DatosNuevaParada {
  rutaId: string;
  puntoOperacionId: string;
  orden: number;
  tarifaDesdeOrigen: number;
  tiempoEstimadoDesdeOrigenMinutos?: number;
}

export interface DatosEditarParada {
  orden?: number;
  tarifaDesdeOrigen?: number;
  tiempoEstimadoDesdeOrigenMinutos?: number;
}

export interface ParadaResumen {
  id: string;
  orden: number;
  tarifaDesdeOrigen: number;
  tiempoEstimadoDesdeOrigenMinutos: number | null;
  puntoOperacionId: string;
  puntoOperacionNombre: string;
  puntoOperacionCiudad: string;
}

export interface DatosNuevoViaje {
  rutaId: string;
  unidadId: string;
  fechaSalida: string;
  horaSalidaProgramada: string;
  horaLlegadaEstimada?: string;
  recargoVip?: number;
  precioBase: number;
}

export interface DatosNuevoUsuarioStaff {
  correo: string;
  password: string;
  nombreCompleto: string;
  rol: 'vendedor' | 'admin_cooperativa';
}

export interface DatosNuevoConductor {
  nombreCompleto: string;
  cedula: string;
  licenciaNumero?: string;
  licenciaCategoria?: string;
  telefono?: string;
}

/**
 * Carga masiva (RF-COOP, extensión pedida por el director tras
 * identificar que las cooperativas reales necesitan cargar rutas,
 * horarios, unidades y conductores de una sola vez, no uno por uno).
 *
 * Cada item de tiposVehiculo/conductores/unidades/rutas lleva un `ref`
 * — una etiqueta temporal elegida libremente por quien arma el JSON
 * (ej. "bus-vip-1"), que sirve para que otros items del MISMO paquete
 * lo referencien antes de que exista un ID real (ej. una unidad
 * referenciando su tipoVehiculoRef). También se puede usar directamente
 * un ID real ya existente en vez de un ref, para reutilizar recursos
 * creados en una importación anterior.
 */
export interface ItemImportTipoVehiculo {
  ref?: string;
  nombre: string;
  capacidadTotal: number;
  distribucionAsientos?: unknown;
}

export interface ItemImportConductor {
  ref?: string;
  nombreCompleto: string;
  cedula: string;
  licenciaNumero?: string;
  licenciaCategoria?: string;
  telefono?: string;
}

export interface ItemImportUnidad {
  ref?: string;
  tipoVehiculoRef: string;
  placa: string;
  identificadorOperativo: string;
}

export interface ItemImportRuta {
  ref?: string;
  origenPuntoOperacionId: string;
  destinoPuntoOperacionId: string;
  precioBaseReferencia: number;
  nombre?: string;
}

/** diasSemana: 0=domingo … 6=sábado. horaSalida formato "HH:MM" (24h, hora local Ecuador). */
export interface ItemImportHorario {
  rutaRef: string;
  /**
   * 04-ago-2026 -- unificación del ítem 8 con el generador recurrente
   * del ítem 7: antes este item traía `unidadRef` (una unidad
   * específica, fija para siempre) y `conductorRef` -- ninguno de los
   * dos existe en `horarios_ruta` (solo guarda un TIPO de vehículo,
   * no una unidad puntual), así que nunca se persistían de verdad, se
   * usaban solo para el generador de una sola vez que ahora se elimina.
   * Sin `tipoVehiculoRef`, un horario creado por carga masiva nunca
   * podría generar viajes automáticos después -- sería un callejón sin
   * salida silencioso (decisión del director, 04-ago-2026).
   */
  tipoVehiculoRef: string;
  horaSalida: string;
  diasSemana: number[];
}

export interface DatosImportacion {
  tiposVehiculo?: ItemImportTipoVehiculo[];
  conductores?: ItemImportConductor[];
  unidades?: ItemImportUnidad[];
  rutas?: ItemImportRuta[];
  horarios?: ItemImportHorario[];
  /** Si se incluyen ambas fechas, además de crear los horarios_ruta, se generan las filas de viajes concretas en ese rango. */
  generarViajesDesde?: string;
  generarViajesHasta?: string;
}

export interface ResultadoImportacion {
  tiposVehiculoCreados: number;
  conductoresCreados: number;
  unidadesCreadas: number;
  rutasCreadas: number;
  horariosCreados: number;
  viajesGenerados: number;
}

/**
 * 04-ago-2026 -- lo que el repositorio devuelve de verdad. La
 * generación de viajes ya NO ocurre aquí (se movió a
 * GeneradorViajesService, mismo mecanismo que el cron del ítem 7) --
 * el repositorio solo crea entidades y devuelve los ids de los
 * horarios nuevos, para que el service dispare la generación después.
 */
export interface ResultadoImportacionRepo
  extends Omit<ResultadoImportacion, 'viajesGenerados'> {
  horarioIds: string[];
}

export interface FilaVentaDelDia {
  rutaNombre: string;
  vendedorNombre: string | null;
  totalBoletos: number;
  totalVentas: number;
}

export interface ResultadoValidacionQr {
  valido: boolean;
  mensaje: string;
  pasajeroNombre?: string;
  /** RF-MENOR — presente solo si el pasajero de este boleto es menor de edad. */
  menor?: {
    boletoId: string;
    tipoAcompanamiento: 'con_padre_madre_tutor' | 'con_autorizacion';
    adultoAcompananteNombre: string | null;
    adultoResponsableNombre: string | null;
    adultoResponsableDocumento: string | null;
    adultoResponsableTelefono: string | null;
    documentoAutorizacionUrl: string | null;
    yaVerificado: boolean;
  };
  /**
   * Wallet/cashback Fase 1 (13-ago-2026) -- presentes solo si valido es
   * true. compradorUsuarioId es null para una compra de invitado (el
   * invitado no participa de cashback, mismo criterio que ClickBus).
   */
  compraId?: string;
  precioPagado?: number;
  compradorUsuarioId?: string | null;
  /** Programa de referidos (13-ago-2026) -- id real del boleto validado. */
  boletoId?: string;
  /**
   * Discapacidad, captura real (13-ago-2026) -- presente solo si el
   * pasajero de este boleto tiene tarifa de discapacidad. El personal
   * en el andén ve el número declarado para comparar con el carné o
   * cédula físicos -- nunca se verifica automáticamente.
   */
  documentoDiscapacidad?: { numeroDeclarado: string | null };
}

export interface RutaResumen {
  id: string;
  nombre: string | null;
  origenCiudad: string;
  destinoCiudad: string;
  precioBaseReferencia: number;
}

export interface TipoVehiculoResumen {
  id: string;
  nombre: string;
  categoria: string | null;
  capacidadTotal: number;
  amenidades: Amenidad[];
}

export interface UnidadResumen {
  id: string;
  placa: string;
  identificadorOperativo: string;
  tipoVehiculoId: string;
  tipoVehiculoNombre: string;
  activo: boolean;
}

export interface ViajeResumen {
  id: string;
  rutaNombre: string;
  origenCiudad: string;
  destinoCiudad: string;
  fechaSalida: string;
  horaSalidaProgramada: string;
  precioBase: number;
  estado: string;
  unidadPlaca: string;
  tipoVehiculoNombre: string;
}

export interface UsuarioStaffResumen {
  id: string;
  correo: string;
  nombreCompleto: string;
  rol: 'vendedor' | 'admin_cooperativa';
  activo: boolean;
}

export interface ConductorResumen {
  id: string;
  nombreCompleto: string;
  cedula: string;
  licenciaNumero: string | null;
  licenciaCategoria: string | null;
  telefono: string | null;
}

export interface PasajeroDeViaje {
  numeroAsiento: string;
  nombreCompleto: string;
  documento: string;
  tipoTarifa: string;
  esMenorEdad: boolean;
  estadoBoleto: string;
}

/**
 * Ítem 10, Fase 2 (04-ago-2026) — actualización periódica obligatoria
 * de datos de cooperativa. Decisión confirmada por el director: 6 meses
 * sin confirmar = advertencia (no bloqueante); 12 meses de silencio
 * total = se bloquea SOLO creación de horarios recurrentes nuevos y
 * carga masiva -- nunca venta, validación de boletos, ni confirmación
 * de pagos, bajo ninguna circunstancia.
 */
export const MESES_ADVERTENCIA_DATOS_COOPERATIVA = 6;
export const MESES_BLOQUEO_DATOS_COOPERATIVA = 12;

export type EstadoActualizacionDatos =
  | { estado: 'al_dia' }
  | { estado: 'advertencia'; mesesSinConfirmar: number }
  | { estado: 'bloqueado'; mesesSinConfirmar: number };

/**
 * Referencia = la confirmación más reciente, o la fecha de afiliación
 * si nunca se ha confirmado nada. Sin ninguna de las dos (caso raro,
 * cooperativa muy vieja sin fechaAfiliacion registrada), no se puede
 * evaluar -- se trata como al_dia en vez de penalizar por un hueco de
 * datos que no es culpa de la cooperativa.
 */
export function calcularEstadoActualizacionDatos(
  ultimaConfirmacion: Date | null,
  fechaAfiliacion: Date | null,
  ahora: Date = new Date(),
): EstadoActualizacionDatos {
  const referencia = ultimaConfirmacion ?? fechaAfiliacion;
  if (!referencia) return { estado: 'al_dia' };

  const msPorMes = 1000 * 60 * 60 * 24 * 30.44; // promedio real de días por mes, no un mes fijo de 30
  const mesesTranscurridos = (ahora.getTime() - referencia.getTime()) / msPorMes;

  if (mesesTranscurridos >= MESES_BLOQUEO_DATOS_COOPERATIVA) {
    return { estado: 'bloqueado', mesesSinConfirmar: Math.floor(mesesTranscurridos) };
  }
  if (mesesTranscurridos >= MESES_ADVERTENCIA_DATOS_COOPERATIVA) {
    return { estado: 'advertencia', mesesSinConfirmar: Math.floor(mesesTranscurridos) };
  }
  return { estado: 'al_dia' };
}

export interface DatosLegalesCooperativa {
  razonSocial: string;
  ruc: string;
  direccionLegal: string | null;
  contactoNombre: string | null;
  contactoCorreo: string | null;
  contactoTelefono: string | null;
}

export interface PanelEmpresaRepositorio {
  crearTipoVehiculo(
    cooperativaId: string,
    datos: DatosNuevoTipoVehiculo,
  ): Promise<{ id: string }>;
  /**
   * Cooperativas proponen sus propios puntos de operación (13-ago-2026)
   * -- inserta directo en 'pendiente_revision', cooperativaId siempre
   * viene del token autenticado (nunca del cuerpo de la petición) --
   * una cooperativa nunca puede proponer a nombre de otra.
   */
  proponerPuntoOperacion(
    cooperativaId: string,
    datos: {
      tipo: 'oficina_agencia' | 'parada_intermedia';
      nombre: string;
      ciudad: string;
      provincia: string;
    },
  ): Promise<{ id: string }>;
  /** Tipos de vehículo de la cooperativa — se necesita antes de poder crear una unidad. */
  listarTiposVehiculo(cooperativaId: string): Promise<TipoVehiculoResumen[]>;
  editarTipoVehiculo(
    cooperativaId: string,
    tipoVehiculoId: string,
    datos: DatosEditarTipoVehiculo,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;
  crearUnidad(
    cooperativaId: string,
    datos: DatosNuevaUnidad,
  ): Promise<{ id: string }>;
  /** Unidades (buses) de la cooperativa, con el nombre de su tipo ya resuelto. */
  listarUnidades(cooperativaId: string): Promise<UnidadResumen[]>;

  /**
   * Activar/desactivar una unidad — hallazgo real 22-jul-2026: la
   * columna `activo` existía desde el esquema original, pero no había
   * forma de cambiarla ni de verla, así que una unidad en
   * mantenimiento/retirada seguía apareciendo como opción normal al
   * crear un viaje o cambiar la unidad de uno. No borra nada — los
   * viajes históricos con esa unidad no se ven afectados.
   */
  actualizarEstadoUnidad(
    cooperativaId: string,
    unidadId: string,
    activo: boolean,
  ): Promise<void>;
  crearRuta(
    cooperativaId: string,
    datos: DatosNuevaRuta,
  ): Promise<{ id: string }>;
  /** Rutas de la cooperativa, para elegir al armar un viaje o solo para revisar lo que ya existe. */
  listarRutas(cooperativaId: string): Promise<RutaResumen[]>;
  /** Paradas intermedias de una ruta -- RF-COOP-002. */
  agregarParada(cooperativaId: string, datos: DatosNuevaParada): Promise<{ id: string }>;
  listarParadas(cooperativaId: string, rutaId: string): Promise<ParadaResumen[]>;
  editarParada(
    cooperativaId: string,
    paradaId: string,
    datos: DatosEditarParada,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;
  eliminarParada(cooperativaId: string, paradaId: string): Promise<{ ok: true } | { ok: false; motivo: string }>;
  editarRuta(
    cooperativaId: string,
    rutaId: string,
    datos: DatosEditarRuta,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;
  crearViaje(
    cooperativaId: string,
    datos: DatosNuevoViaje,
  ): Promise<{ id: string }>;
  /** Viajes programados de la cooperativa — el mismo listado que RF-BUS termina mostrando al pasajero, pero visto desde adentro. */
  listarViajes(cooperativaId: string): Promise<ViajeResumen[]>;

  /**
   * Cancelar un viaje completo — hallazgo real 22-jul-2026: antes no
   * existía ninguna forma de hacerlo (ej. si el bus se daña). Cancela
   * el viaje Y cascada automáticamente a cancelar todos los boletos ya
   * vendidos de ese viaje — un pasajero no debería tener que darse
   * cuenta solo de que su viaje ya no existe.
   *
   * 03-ago-2026 -- extendido para generar crédito automático (mismo
   * mecanismo que reprogramación) por cada boleto cancelado, monto
   * igual al precio pagado -- decisión del director: cancelar por
   * causa operativa (no por el pasajero) debe compensar, no dejar al
   * pasajero sin nada.
   */
  cancelarViaje(
    cooperativaId: string,
    viajeId: string,
  ): Promise<
    { ok: true; boletosCancelados: number } | { ok: false; motivo: string }
  >;

  /**
   * Horarios recurrentes (plantilla) — ítem 7, RF-COOP-002.
   */
  crearHorarioRuta(
    cooperativaId: string,
    datos: DatosNuevoHorarioRuta,
  ): Promise<{ id: string }>;
  listarHorariosRuta(
    cooperativaId: string,
    rutaId?: string,
  ): Promise<HorarioRutaResumen[]>;
  actualizarEstadoHorarioRuta(
    cooperativaId: string,
    horarioId: string,
    activo: boolean,
  ): Promise<void>;

  /**
   * Cancelación/suspensión masiva por ruta y rango de fechas — ítem 7.
   * Solo toca viajes en estado 'programado'; el resto (ya cancelados,
   * completados, etc) se cuenta en viajesSinCambios sin tocarlos.
   */
  listarViajesProgramadosEnRango(
    cooperativaId: string,
    rutaId: string,
    fechaInicio: string,
    fechaFin: string,
  ): Promise<string[]>;

  /**
   * Cambiar la unidad asignada a un viaje ya programado — investigado y
   * confirmado el 22-jul-2026: es el patrón real que usan las
   * plataformas más grandes del sector cuando un bus se daña
   * ("vehículo de reemplazo" — FlixBus), y en Ecuador tiene además
   * respaldo legal real: la ANT sanciona la INTERRUPCIÓN del servicio
   * (infracción administrativa muy grave, LOTTTSV) — reemplazar la
   * unidad en vez de cancelar el viaje evita esa sanción. No toca
   * boletos ni asientos para nada — el viaje sigue siendo el mismo
   * viaje. Solo se permite si la unidad nueva tiene capacidad igual o
   * mayor a la actual, para no invalidar ningún asiento ya vendido.
   */
  cambiarUnidadViaje(
    cooperativaId: string,
    viajeId: string,
    nuevaUnidadId: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;

  /**
   * Editar hora y/o precio de un viaje — hallazgo real 22-jul-2026:
   * antes no existía ninguna forma de corregir un error de captura
   * (hora mal puesta, precio equivocado) sin cancelar y volver a
   * crear el viaje entero. Solo se permite si TODAVÍA no se ha
   * vendido ningún boleto — sin sistema de notificaciones, cambiar la
   * hora/precio de un viaje que un pasajero ya compró lo dejaría sin
   * enterarse del cambio, lo cual es peor que no permitirlo.
   */
  editarViaje(
    cooperativaId: string,
    viajeId: string,
    datos: { horaSalidaProgramada?: string; precioBase?: number },
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;

  /**
   * Lista de pasajeros de un viaje concreto ("manifiesto") — hallazgo
   * real 22-jul-2026: hoy la cooperativa puede ver cuántos boletos se
   * vendieron en total (dashboard), pero no QUIÉN va a abordar un viaje
   * específico, con qué asiento, ni si ya se validó su boleto. Sin esto,
   * el personal en el terminal no tiene ninguna lista real de a quién
   * esperar.
   */
  listarPasajerosDeViaje(
    cooperativaId: string,
    viajeId: string,
  ): Promise<PasajeroDeViaje[]>;
  crearUsuarioStaff(
    cooperativaId: string,
    datos: DatosNuevoUsuarioStaff,
  ): Promise<{ usuarioId: string }>;
  /** "Personal" (22-jul-2026) — antes se podía crear staff, pero no había forma de VER quién ya estaba registrado. */
  listarUsuariosStaff(cooperativaId: string): Promise<UsuarioStaffResumen[]>;
  crearConductor(
    cooperativaId: string,
    datos: DatosNuevoConductor,
  ): Promise<{ id: string }>;
  listarConductores(cooperativaId: string): Promise<ConductorResumen[]>;

  /** Carga masiva — ver comentario de DatosImportacion arriba. */
  importarDatos(
    cooperativaId: string,
    datos: DatosImportacion,
  ): Promise<ResultadoImportacionRepo>;

  /** RF-COOP-004 — dashboard de ventas del día, tenant-scoped de verdad. */
  dashboardVentasDelDia(cooperativaId: string): Promise<FilaVentaDelDia[]>;

  /** Perfil visual de la cooperativa — hoy solo el logo (22-jul-2026). */
  obtenerPerfil(cooperativaId: string): Promise<{ logoUrl: string | null }>;
  actualizarPerfil(
    cooperativaId: string,
    datos: { logoUrl: string | null },
  ): Promise<void>;

  /** IVA de la cooperativa — ya incluido en el precio del boleto por defecto (15%), configurable. */
  obtenerConfiguracionFiscal(cooperativaId: string): Promise<{
    ivaPorcentaje: number;
    ivaVisibleEnBoleto: boolean;
    ivaSigueTasaNacional: boolean;
  }>;
  actualizarConfiguracionFiscal(
    cooperativaId: string,
    datos: {
      ivaPorcentaje: number;
      ivaVisibleEnBoleto: boolean;
      ivaSigueTasaNacional: boolean;
    },
  ): Promise<void>;

  /** Corrección real 18-ago-2026 -- recargo VIP como política fija de la cooperativa. */
  obtenerConfiguracionVip(cooperativaId: string): Promise<{ recargoVipDefault: number }>;
  actualizarConfiguracionVip(cooperativaId: string, recargoVipDefault: number): Promise<void>;

  /**
   * Reprogramación con crédito (Fase C, 28-jul-2026) — horas mínimas
   * antes de la salida para poder reprogramar. Cada cooperativa
   * configura la suya; null = usa el valor de reserva conservador de
   * la capa de aplicación.
   */
  obtenerHorasLimiteReprogramacion(cooperativaId: string): Promise<number | null>;
  actualizarHorasLimiteReprogramacion(
    cooperativaId: string,
    horas: number,
  ): Promise<void>;

  /**
   * Política de cancelación/reprogramación por cooperativa (29-jul-2026,
   * hallazgo real de negocio): Transportes Occidental (Machala) no
   * permite cambios ni devoluciones. Se configuran por separado --
   * cancelar es una venta perdida para la cooperativa, reprogramar no.
   */
  obtenerPoliticaCancelacionReprogramacion(cooperativaId: string): Promise<{
    permiteCancelacion: boolean;
    horasLimiteCancelacion: number | null;
    permiteReprogramacion: boolean;
    horasLimiteReprogramacion: number | null;
  }>;
  actualizarPoliticaCancelacionReprogramacion(
    cooperativaId: string,
    datos: {
      permiteCancelacion?: boolean;
      horasLimiteCancelacion?: number;
      permiteReprogramacion?: boolean;
      horasLimiteReprogramacion?: number;
    },
  ): Promise<void>;

  /**
   * Métodos de pago manuales (29-jul-2026) -- mientras no hay pasarela
   * real conectada, cada cooperativa configura los que ya usa hoy en
   * Ecuador (transferencia, efectivo, DeUna, PayPhone) con sus propios
   * datos para recibir el pago.
   */
  listarMetodosPago(cooperativaId: string): Promise<MetodoPagoCooperativa[]>;
  guardarMetodoPago(
    cooperativaId: string,
    tipo: TipoMetodoPago,
    datosCuenta: Record<string, string>,
    activo: boolean,
    entidadFinanciera: EntidadFinanciera | null,
  ): Promise<{ id: string }>;
  eliminarMetodoPago(cooperativaId: string, metodoPagoId: string): Promise<void>;

  /**
   * Credenciales API — Modelo B (02-ago-2026). `rotarCredencialApi`
   * revoca la credencial existente y crea una nueva conservando su
   * webhookUrl -- la llave vieja deja de funcionar en el mismo momento
   * en que se genera la nueva, no hay ventana donde ambas sirvan.
   */
  listarCredencialesApi(cooperativaId: string): Promise<CredencialApiCooperativa[]>;
  crearCredencialApi(
    cooperativaId: string,
    webhookUrl: string | null,
  ): Promise<CredencialApiRecienCreada>;
  rotarCredencialApi(
    cooperativaId: string,
    credencialId: string,
  ): Promise<CredencialApiRecienCreada>;
  revocarCredencialApi(cooperativaId: string, credencialId: string): Promise<void>;
  actualizarWebhookCredencialApi(
    cooperativaId: string,
    credencialId: string,
    webhookUrl: string | null,
  ): Promise<void>;

  /** RF-COOP-006 — validación de boleto por QR en abordaje. */
  validarBoletoPorQr(
    cooperativaId: string,
    codigoQr: string,
    validadoPorUsuarioId: string,
  ): Promise<ResultadoValidacionQr>;

  /** RF-MENOR-004 — verificación de documentos del menor, en ventanilla/abordaje. */
  verificarMenor(
    cooperativaId: string,
    boletoId: string,
    verificadoPorUsuarioId: string,
    documentoIdentidadVerificado: boolean,
    documentoAutorizacionVerificado: boolean,
  ): Promise<void>;

  /**
   * Ítem 10, Fase 2 (04-ago-2026) -- actualización periódica
   * obligatoria de datos de cooperativa.
   */
  obtenerEstadoActualizacionDatos(cooperativaId: string): Promise<{
    ultimaConfirmacion: Date | null;
    fechaAfiliacion: Date | null;
    datosActuales: DatosLegalesCooperativa;
  }>;

  /**
   * Actualiza solo los campos enviados (revisar y dejar igual también
   * es válido) y SIEMPRE marca datosActualizadosEn = ahora,
   * independientemente de si algo cambió de verdad.
   */
  confirmarDatosCooperativa(
    cooperativaId: string,
    datos: Partial<DatosLegalesCooperativa>,
  ): Promise<void>;
}
