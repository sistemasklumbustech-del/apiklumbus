/**
 * Cambio automático del estado de los viajes (24-sep-2026). Ver la
 * migración 0050 y EstadoViajesService para las reglas completas.
 */
export type EstadoViajeAutomatico =
  'programado' | 'en_curso' | 'finalizado' | 'cancelado';

export interface ViajeCambiado {
  viajeId: string;
  cooperativaId: string;
  anterior: EstadoViajeAutomatico;
  nuevo: EstadoViajeAutomatico;
  ruta: string;
  horaSalida: string;
}

export interface ViajePorConsultar {
  viajeId: string;
  cooperativaId: string;
  cooperativaNombre: string;
  ruta: string;
  horaSalida: string;
  placa: string;
}

export interface EstadoViajesRepositorio {
  /**
   * programado -> en_curso: pasaron `minutosEspera` desde la hora de
   * salida y el viaje vendió al menos un boleto.
   */
  iniciarViajesConVentas(minutosEspera: number): Promise<ViajeCambiado[]>;

  /**
   * programado -> cancelado: pasaron `minutosEspera` desde la hora de
   * salida y el viaje no vendió nada (ni boletos, ni asientos reservados
   * pendientes de confirmar el pago).
   */
  cancelarViajesSinVentas(minutosEspera: number): Promise<ViajeCambiado[]>;

  /**
   * en_curso -> finalizado, sin que nadie lo confirme: la llegada
   * estimada pasó hace más de `horas` horas. Evita que un viaje quede
   * "en curso" para siempre si la cooperativa no responde.
   */
  finalizarViajesVencidos(horas: number): Promise<ViajeCambiado[]>;

  /**
   * Viajes en curso cuya hora estimada de llegada ya pasó (hace menos de
   * 24 h) y a los que todavía no se les preguntó si el bus llegó.
   */
  viajesParaConsultarLlegada(): Promise<ViajePorConsultar[]>;

  marcarLlegadaConsultada(viajeId: string): Promise<void>;

  /** en_curso -> finalizado por confirmación de la cooperativa. false si no existe, no es suyo o no está en curso. */
  confirmarLlegada(
    cooperativaId: string,
    viajeId: string,
  ): Promise<ViajeCambiado | null>;

  /** Correos que deben recibir la pregunta de llegada: contacto de la cooperativa y sus administradores. */
  correosDeCooperativa(cooperativaId: string): Promise<string[]>;
}
