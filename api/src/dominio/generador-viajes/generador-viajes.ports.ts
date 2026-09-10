/**
 * Generador de viajes desde plantillas (horarios_ruta) — ítem 7, Fase 2
 * (03-ago-2026), RF-COOP-002. Distinto del generador de una sola vez que
 * ya existe dentro de `importarDatos` (carga masiva): ese es para
 * configuración inicial vía planilla, este es un cron continuo que
 * mantiene la agenda cubierta hacia adelante, respetando ediciones
 * manuales para siempre (nunca hace UPDATE, solo INSERT si la
 * combinación horario+fecha no existe todavía).
 *
 * Límite conocido, documentado a propósito (no resuelto en esta
 * entrega): elige "la primera unidad activa disponible de ese tipo"
 * sin revisar si esa unidad ya está asignada a otro viaje simultáneo --
 * mismo criterio de "cableado ahora, ajuste fino cuando aparezca el
 * caso real" ya usado en Modelo B.
 */

export interface HorarioActivoParaGenerar {
  id: string;
  cooperativaId: string;
  rutaId: string;
  horaSalida: string;
  diasSemana: number[];
  tipoVehiculoPredeterminadoId: string;
  precioBaseReferencia: number;
}

export interface GeneradorViajesRepositorio {
  listarHorariosActivos(): Promise<HorarioActivoParaGenerar[]>;

  /**
   * 04-ago-2026 -- ítem 8, usado por la carga masiva (importarDatos)
   * para generar viajes de los horarios que acaba de crear, con el
   * mismo mecanismo que el cron diario -- sin esto, la carga masiva
   * necesitaría su propio camino paralelo (lo que ya se eliminó).
   */
  listarHorariosPorId(horarioIds: string[]): Promise<HorarioActivoParaGenerar[]>;

  existeViajeParaHorarioYFecha(horarioId: string, fecha: string): Promise<boolean>;

  /** null si no hay ninguna unidad activa de ese tipo para esa cooperativa -- el generador se salta ese día y lo reporta. */
  buscarUnidadDisponible(
    cooperativaId: string,
    tipoVehiculoId: string,
  ): Promise<{ unidadId: string } | null>;

  crearViajeDesdeHorario(datos: {
    cooperativaId: string;
    rutaId: string;
    unidadId: string;
    horarioRutaOrigenId: string;
    fechaSalida: string;
    horaSalidaProgramada: string;
    precioBase: number;
  }): Promise<void>;
}
