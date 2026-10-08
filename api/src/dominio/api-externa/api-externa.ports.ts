/**
 * API externa — Modelo B (03-ago-2026), cierre del ítem 4 de la hoja de
 * ruta Fase 2. Dos piezas distintas y complementarias al webhook (que
 * ya cubre el aviso de venta, push nuestro → cooperativa):
 *
 * 1) RECEPCIÓN (RF-API-002) — la cooperativa nos empuja cambios de
 *    disponibilidad/precio de SUS PROPIOS viajes. Alcance de esta
 *    primera entrega: precio (`precioBase`). El estado real de
 *    asientos ocupados/disponibles vive en `viaje_asientos` y refleja
 *    reservas reales del sistema propio de Columbus -- dejarlo
 *    editable directamente por una API externa abriría una vía de
 *    corromper reservas ya confirmadas sin una estrategia de conflicto
 *    definida. Eso queda para cuando exista la primera integración
 *    real y se pueda diseñar esa estrategia con datos reales, no
 *    hipotéticos -- mismo criterio que "el conector a la medida espera
 *    a una cooperativa real", ya aplicado en el resto de esta sección.
 *
 * 2) RECONCILIACIÓN (RF-API-004) — la cooperativa consulta activamente
 *    el estado de entrega de los webhooks que le enviamos, para poder
 *    verificar manualmente si algo se perdió, sin depender al 100% del
 *    reintento automático.
 *
 * Ambas piezas se autentican con la llave API de la cooperativa
 * (ApiKeyGuard), no con sesión JWT de admin_cooperativa -- están
 * pensadas para que el sistema propio de la cooperativa llame directo,
 * sin un usuario logueado en el navegador de por medio.
 */

export interface EventoWebhookResumen {
  id: string;
  evento: string;
  estadoEntrega: string;
  intentos: number;
  ultimoIntentoEn: string | null;
  ultimaRespuesta: string | null;
  creadoEn: string;
}

export interface ApiExternaRepositorio extends ApiExternaViajesRepositorio {
  /**
   * Bypass RLS a propósito -- todavía no sabemos a qué cooperativa
   * pertenece la petición, eso es justo lo que este método resuelve.
   * El prefijo es el mecanismo de lookup rápido (texto plano, único);
   * el hash es lo que realmente verifica el secreto.
   */
  validarCredencial(
    apiKeyPrefix: string,
    secreto: string,
  ): Promise<{ cooperativaId: string } | null>;

  actualizarPrecioViaje(
    cooperativaId: string,
    viajeId: string,
    precioBase: number,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;

  /**
   * Ítem 16, Fase 2 (05-ago-2026) -- seguimiento GPS en vivo, "cableado"
   * genérico. Mismo criterio de autenticación que actualizarPrecioViaje:
   * el sistema propio de la cooperativa (o el hardware GPS conectado a
   * él) llama esto directo con su llave API, sin sesión de usuario.
   * Última posición conocida -- cada llamada sobrescribe la anterior,
   * no se guarda un historial de todo el trayecto.
   */
  actualizarUbicacionViaje(
    cooperativaId: string,
    viajeId: string,
    latitud: number,
    longitud: number,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;

  listarEventosWebhook(
    cooperativaId: string,
    desde?: string,
    hasta?: string,
  ): Promise<EventoWebhookResumen[]>;
}

/**
 * Fase B (07-oct-2026) -- viajes y asientos desde el sistema de la
 * cooperativa. Klumbus define el contrato; cada cooperativa lo adapta a su
 * sistema. La cooperativa sigue siendo la dueña de sus datos: Klumbus no
 * deja que esta vía toque una venta ya hecha en Klumbus.
 */
export interface CatalogoCooperativa {
  rutas: {
    id: string;
    nombre: string | null;
    origen: { id: string; nombre: string; ciudad: string };
    destino: { id: string; nombre: string; ciudad: string };
    precioBaseReferencia: number;
    activa: boolean;
  }[];
  unidades: {
    id: string;
    placa: string;
    identificadorOperativo: string;
    tipoVehiculo: string;
    capacidadTotal: number;
    activo: boolean;
  }[];
}

export interface DatosViajeExterno {
  rutaId: string;
  unidadId: string;
  fechaSalida: string; // yyyy-MM-dd, hora de Ecuador
  horaSalidaProgramada: string; // ISO 8601
  horaLlegadaEstimada?: string;
  precioBase: number;
  recargoVip?: number;
}

export type ResultadoGuardarViaje =
  | { ok: true; id: string; creado: boolean }
  | { ok: false; codigo: 'ruta_invalida' | 'unidad_invalida' | 'viaje_no_programado' | 'viaje_con_ventas'; motivo: string };

export type ResultadoAsientoExterno =
  | { numero: string; resultado: 'ocupado' | 'ya_ocupado' | 'liberado' | 'sin_cambios' }
  | {
      numero: string;
      resultado: 'inexistente' | 'conflicto';
      motivo: 'asiento_inexistente' | 'vendido_en_klumbus' | 'pago_en_revision' | 'en_proceso_de_compra' | 'no_es_de_la_cooperativa';
      /** Si el conflicto es un asiento en proceso de compra, cuándo vence ese bloqueo y se puede reintentar. */
      expiraEn?: string;
    };

export type EstadoAsientoExterno = 'vendido_klumbus' | 'pago_en_revision' | 'en_compra' | 'ocupado_cooperativa';

export interface AsientosDeViajeExterno {
  viajeId: string;
  capacidadTotal: number;
  /** Números de asiento válidos para la unidad de este viaje. */
  numerosValidos: string[];
  /** Solo los asientos que no están libres; el resto está disponible. */
  noDisponibles: { numero: string; estado: EstadoAsientoExterno; referencia: string | null; expiraEn: string | null }[];
}

export interface ApiExternaViajesRepositorio {
  catalogo(cooperativaId: string): Promise<CatalogoCooperativa>;
  guardarViaje(
    cooperativaId: string,
    referenciaExterna: string,
    datos: DatosViajeExterno,
  ): Promise<ResultadoGuardarViaje>;
  /** null si el viaje no existe para esta cooperativa. */
  asientosDeViaje(cooperativaId: string, viajeId: string): Promise<AsientosDeViajeExterno | null>;
  ocuparAsientos(
    cooperativaId: string,
    viajeId: string,
    asientos: { numero: string; referencia?: string }[],
  ): Promise<{ ok: true; resultados: ResultadoAsientoExterno[] } | { ok: false; motivo: string } | null>;
  liberarAsientos(
    cooperativaId: string,
    viajeId: string,
    numeros: string[],
  ): Promise<{ ok: true; resultados: ResultadoAsientoExterno[] } | null>;
}
