/**
 * Panel operativo de la plataforma (RF-022): vista de toda la operación --
 * viajes, ocupación, ventas y alertas -- de todas las cooperativas, con
 * filtros y exportación. Solo lectura, solo para administradores de
 * plataforma.
 */
export type EstadoViaje =
  'programado' | 'en_curso' | 'finalizado' | 'cancelado';

export interface FiltrosOperacion {
  /** YYYY-MM-DD, hora de Ecuador. Si faltan, se usa el día de hoy. */
  desde?: string;
  hasta?: string;
  cooperativaId?: string;
  rutaId?: string;
  estado?: EstadoViaje;
}

export interface FiltrosViajesOperacion extends FiltrosOperacion {
  pagina: number;
  limite: number;
}

export interface ResumenOperacion {
  totalViajes: number;
  viajesPorEstado: Record<EstadoViaje, number>;
  boletosVendidos: number;
  boletosCancelados: number;
  ingresos: number;
  /** Boletos vendidos / capacidad de los viajes no cancelados, en porcentaje (0-100). */
  ocupacionPromedio: number;
}

export interface ViajeOperacion {
  viajeId: string;
  fechaSalida: string;
  horaSalida: string;
  cooperativa: string;
  ruta: string;
  placa: string;
  estado: EstadoViaje;
  capacidad: number;
  vendidos: number;
  ocupacion: number;
  ingresos: number;
}

export interface ResultadoViajesOperacion {
  filas: ViajeOperacion[];
  total: number;
  pagina: number;
  limite: number;
}

export interface RutaOperacion {
  rutaId: string;
  cooperativa: string;
  ruta: string;
  viajes: number;
  vendidos: number;
  capacidad: number;
  ocupacion: number;
  ingresos: number;
}

export interface ViajeEnAlerta {
  viajeId: string;
  cooperativa: string;
  ruta: string;
  horaSalida: string;
  ocupacion: number;
  /** Minutos de atraso sobre la hora programada (solo en viajes atrasados). */
  minutosAtraso?: number;
}

export interface AlertasOperacion {
  pagosPendientes: { cantidad: number; masAntiguoHoras: number | null };
  reclamos: { abiertos: number; enRevision: number };
  viajesAtrasados: ViajeEnAlerta[];
  viajesBajaOcupacion: ViajeEnAlerta[];
}

export interface OpcionRuta {
  id: string;
  nombre: string;
}

export interface OperacionRepositorio {
  resumen(filtros: FiltrosOperacion): Promise<ResumenOperacion>;
  listarViajes(
    filtros: FiltrosViajesOperacion,
  ): Promise<ResultadoViajesOperacion>;
  viajesParaExportar(
    filtros: FiltrosOperacion,
    maximo: number,
  ): Promise<ViajeOperacion[]>;
  rutasDestacadas(
    filtros: FiltrosOperacion,
    maximo: number,
  ): Promise<RutaOperacion[]>;
  alertas(): Promise<AlertasOperacion>;
  opcionesRutas(cooperativaId?: string): Promise<OpcionRuta[]>;
}
