/**
 * Notificaciones programadas — RF-NOTIF-002/003 (03-ago-2026), Ítem 5
 * de la hoja de ruta Fase 2. Dos disparadores distintos:
 *
 * 1) Recordatorio de viaje próximo -- disparo programado (cron), no
 *    reacción a una acción del usuario. Se registra en `notificaciones`
 *    ANTES de intentar enviar (mismo patrón que notificarCompraConfirmada
 *    en CompraRepositorio), para que la propia tabla sirva de control de
 *    idempotencia: un viaje+compra que ya tiene una fila con
 *    tipo='recordatorio_viaje' no se vuelve a recordar, sin importar si
 *    esa fila quedó 'enviado' o 'fallido'.
 *
 * 2) Aviso de cambio operativo -- disparo síncrono, enganchado justo en
 *    el momento real donde ocurre el cambio (cambiarUnidadViaje en
 *    PanelEmpresaService), no detectado después por un cron.
 *
 * Fase 8, items 32-33 (11-ago-2026) -- 2 disparadores nuevos, mismo
 * patron de idempotencia por fila que el recordatorio de viaje:
 *
 * 3) Aviso de llegada -- disparo programado (cron), ventana movil corta
 *    (minutos, no horas) antes de horaLlegadaEstimada.
 *
 * 4) Solicitud de calificacion -- disparo programado (cron), viajes con
 *    estado 'finalizado' y un colchon de tiempo despues de la llegada
 *    estimada, para no interrumpir al pasajero apenas bajando del bus.
 */
export interface RecordatorioPendiente {
  viajeId: string;
  compraId: string;
  telefono: string | null;
  origenCiudad: string;
  destinoCiudad: string;
  fechaSalida: string;
  horaSalidaProgramada: string;
}

export interface CompraAfectadaPorViaje {
  compraId: string;
  telefono: string | null;
}

export interface AvisoLlegadaPendiente {
  viajeId: string;
  compraId: string;
  telefono: string | null;
  destinoCiudad: string;
}

export interface SolicitudCalificacionPendiente {
  viajeId: string;
  compraId: string;
  telefono: string | null;
  destinoCiudad: string;
}

export interface NotificacionesProgramadasRepositorio {
  /**
   * Viajes 'programado' cuya salida cae dentro de las próximas
   * `horasAntes` horas, con boletos activos vendidos, que todavía no
   * tienen ninguna fila de recordatorio registrada para esa compra.
   */
  listarRecordatoriosPendientes(horasAntes: number): Promise<RecordatorioPendiente[]>;
  /** Inserta la fila de control ANTES de enviar -- devuelve su id para marcarla después. */
  registrarRecordatorio(
    viajeId: string,
    compraId: string,
    telefono: string | null,
  ): Promise<{ id: string }>;
  /** Compras con boletos activos en un viaje -- para el aviso de cambio operativo. */
  listarComprasAfectadasPorViaje(
    cooperativaId: string,
    viajeId: string,
  ): Promise<CompraAfectadaPorViaje[]>;
  registrarAvisoCambioOperativo(
    viajeId: string,
    compraId: string,
    telefono: string | null,
  ): Promise<{ id: string }>;
  /**
   * Fase 8, item 32 (11-ago-2026) -- viajes cuya hora_llegada_estimada
   * cae dentro de los proximos `minutosAntes` minutos, con boletos
   * 'usado' (el pasajero abordo de verdad), sin aviso de llegada ya
   * registrado. Solo considera viajes no cancelados y con
   * hora_llegada_estimada no nula (muchos viajes viejos no la tienen).
   */
  listarAvisosLlegadaPendientes(minutosAntes: number): Promise<AvisoLlegadaPendiente[]>;
  registrarAvisoLlegada(
    viajeId: string,
    compraId: string,
    telefono: string | null,
  ): Promise<{ id: string }>;
  /**
   * Fase 8, item 33 (11-ago-2026) -- viajes 'finalizado' cuya
   * hora_llegada_estimada ya paso hace al menos `minutosDespuesDeLlegada`
   * minutos, con boletos 'usado' (evita pedirle calificar a alguien que
   * nunca abordo), sin solicitud de calificacion ya registrada.
   */
  listarViajesCompletadosPendientesDeCalificacion(
    minutosDespuesDeLlegada: number,
  ): Promise<SolicitudCalificacionPendiente[]>;
  registrarSolicitudCalificacion(
    viajeId: string,
    compraId: string,
    telefono: string | null,
  ): Promise<{ id: string }>;
  marcarNotificacionEnviada(id: string): Promise<void>;
  marcarNotificacionFallida(id: string, error: string): Promise<void>;
}
