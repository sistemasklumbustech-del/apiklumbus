/**
 * Reclamos del pasajero (RF-019, 23-sep-2026). Ver el comentario completo
 * del diseño en packages/db/schema/reclamos.ts (db/schema/reclamos.ts).
 */
export type TipoReclamo = 'cobro_reembolso' | 'servicio_viaje' | 'boleto_qr';

export type EstadoReclamo =
  'abierto' | 'en_revision' | 'resuelto' | 'rechazado';

export const ETIQUETA_TIPO_RECLAMO: Record<TipoReclamo, string> = {
  cobro_reembolso: 'Cobro o reembolso',
  servicio_viaje: 'Servicio del viaje',
  boleto_qr: 'Boleto o código QR',
};

/** Reclamo tal como lo ve el pasajero que lo creó. */
export interface ReclamoDePasajero {
  id: string;
  boletoId: string;
  tipo: TipoReclamo;
  descripcion: string;
  estado: EstadoReclamo;
  respuesta: string | null;
  montoReconocido: number | null;
  cooperativaNombre: string;
  origenCiudad: string;
  destinoCiudad: string;
  fechaSalida: string;
  creadoEn: string;
  resueltoEn: string | null;
}

/** Reclamo tal como lo ve la cooperativa que debe resolverlo. */
export interface ReclamoDeCooperativa {
  id: string;
  boletoId: string;
  tipo: TipoReclamo;
  descripcion: string;
  estado: EstadoReclamo;
  respuesta: string | null;
  montoReconocido: number | null;
  /** Precio pagado por el boleto -- tope para el monto que se reconoce. */
  montoBoleto: number;
  pasajeroNombre: string;
  pasajeroCorreo: string | null;
  pasajeroTelefono: string | null;
  origenCiudad: string;
  destinoCiudad: string;
  fechaSalida: string;
  creadoEn: string;
  resueltoEn: string | null;
}

export interface FiltrosReclamosPasajero {
  estado?: EstadoReclamo;
  pagina: number;
  limite: number;
}

export interface FiltrosReclamosCooperativa {
  estado?: EstadoReclamo;
  tipo?: TipoReclamo;
  busqueda?: string;
  /** YYYY-MM-DD, hora de Ecuador. */
  desde?: string;
  hasta?: string;
  pagina: number;
  limite: number;
}

export interface ResultadoReclamos<T> {
  filas: T[];
  total: number;
  pagina: number;
  limite: number;
}

export interface ResumenReclamosCooperativa {
  abiertos: number;
  enRevision: number;
  resueltos: number;
  rechazados: number;
}

export interface BoletoParaReclamo {
  cooperativaId: string;
  cooperativaNombre: string;
  origenCiudad: string;
  destinoCiudad: string;
  fechaSalida: string;
}

export interface DatosNuevoReclamo {
  boletoId: string;
  cooperativaId: string;
  pasajeroUsuarioId: string;
  tipo: TipoReclamo;
  descripcion: string;
}

export interface DatosResolucionReclamo {
  estadoFinal: 'resuelto' | 'rechazado';
  respuesta: string;
  montoReconocido: number | null;
  gestionadoPorUsuarioId: string;
}

export interface ReclamosRepositorio {
  /** Solo si el boleto lo compró ese usuario -- la pertenencia real se valida acá. */
  obtenerBoletoDeUsuario(
    boletoId: string,
    usuarioId: string,
  ): Promise<BoletoParaReclamo | null>;

  existeReclamoActivo(boletoId: string, tipo: TipoReclamo): Promise<boolean>;

  crear(datos: DatosNuevoReclamo): Promise<{ id: string }>;

  listarDePasajero(
    usuarioId: string,
    filtros: FiltrosReclamosPasajero,
  ): Promise<ResultadoReclamos<ReclamoDePasajero>>;

  listarDeCooperativa(
    cooperativaId: string,
    filtros: FiltrosReclamosCooperativa,
  ): Promise<ResultadoReclamos<ReclamoDeCooperativa>>;

  obtenerDeCooperativa(
    cooperativaId: string,
    reclamoId: string,
  ): Promise<ReclamoDeCooperativa | null>;

  resumenDeCooperativa(
    cooperativaId: string,
  ): Promise<ResumenReclamosCooperativa>;

  /** abierto -> en_revision. false si el reclamo no existe o ya no está 'abierto'. */
  marcarEnRevision(
    cooperativaId: string,
    reclamoId: string,
    usuarioId: string,
  ): Promise<boolean>;

  /** abierto|en_revision -> estado final, de forma atómica. false si ya estaba resuelto. */
  resolver(
    cooperativaId: string,
    reclamoId: string,
    datos: DatosResolucionReclamo,
  ): Promise<boolean>;

  /** Correos que deben enterarse de un reclamo nuevo: contacto de la cooperativa y sus administradores. */
  correosDeCooperativa(cooperativaId: string): Promise<string[]>;

  correoDePasajero(usuarioId: string): Promise<string | null>;

  /** Para el correo de resolución: a quién avisar y sobre qué reclamo. */
  datosParaAvisoResolucion(reclamoId: string): Promise<{
    pasajeroUsuarioId: string;
    cooperativaNombre: string;
    origenCiudad: string;
    destinoCiudad: string;
  } | null>;
}
