/**
 * Consulta de la auditoría (RF-021) para el panel de administración. La
 * escritura la hace AuditoriaRegistrador (infraestructura) y, en las
 * operaciones administrativas ya existentes, sus propios INSERT dentro
 * de la misma transacción.
 */
export interface FiltrosAuditoria {
  /** Valor del enum accion_auditoria. */
  accion?: string;
  origen?: 'usuario' | 'sistema';
  resultado?: 'exito' | 'fallo';
  /** Nombre o correo del usuario, tipo de entidad o texto del detalle. */
  busqueda?: string;
  ip?: string;
  /** YYYY-MM-DD, hora de Ecuador. */
  desde?: string;
  hasta?: string;
  pagina: number;
  limite: number;
}

export interface RegistroAuditoria {
  id: string;
  creadoEn: string;
  accion: string;
  origen: 'usuario' | 'sistema';
  resultado: 'exito' | 'fallo';
  usuarioId: string | null;
  usuarioNombre: string | null;
  usuarioCorreo: string | null;
  usuarioRol: string | null;
  entidadTipo: string;
  entidadId: string | null;
  direccionIp: string | null;
  detalle: unknown;
}

export interface ResultadoAuditoria {
  filas: RegistroAuditoria[];
  total: number;
  pagina: number;
  limite: number;
}

export interface AuditoriaConsultaRepositorio {
  listar(filtros: FiltrosAuditoria): Promise<ResultadoAuditoria>;
  /** Hasta `maximo` registros con los mismos filtros, sin paginar, para exportar. */
  listarParaExportar(
    filtros: Omit<FiltrosAuditoria, 'pagina' | 'limite'>,
    maximo: number,
  ): Promise<RegistroAuditoria[]>;
  /** Todas las acciones posibles (valores del enum), para el filtro de la pantalla. */
  listarAcciones(): Promise<string[]>;
}
