/**
 * Dominio comercial y monetizacion publicitaria -- RF-COMM.
 * Bloque 1: espacios publicitarios + planes comerciales.
 * Bloque 2: leads de anunciantes + campanas + moderacion.
 * Bloque 3: servir campanas activas a la landing + metricas.
 */

export interface DatosNuevoEspacioPublicitario {
  nombre: string;
  descripcion?: string;
  anchoPx: number;
  altoPx: number;
  ubicacion: string;
  permiteRotacion?: boolean;
}

export interface EspacioPublicitarioResumen {
  id: string;
  nombre: string;
  descripcion: string | null;
  anchoPx: number | null;
  altoPx: number | null;
  ubicacion: string;
  permiteRotacion: boolean;
  activo: boolean;
}

export type NombrePlanComercial = 'basico' | 'destacado' | 'premium';

export interface DatosNuevoPlanComercial {
  nombre: NombrePlanComercial;
  precioMensual?: number;
  duracionDiasDefault?: number;
  formatosPermitidos: unknown;
}

export interface PlanComercialResumen {
  id: string;
  nombre: string;
  precioMensual: number | null;
  duracionDiasDefault: number | null;
  formatosPermitidos: unknown;
  activo: boolean;
}

export type EstadoLead = 'nuevo' | 'contactado' | 'cerrado';

/** RF-COMM-003 -- captacion de leads, formulario publico sin login. */
export interface DatosNuevoLead {
  nombreEmpresa: string;
  contactoNombre?: string;
  contactoCorreo: string;
  contactoTelefono?: string;
  mensaje?: string;
}

export interface LeadResumen {
  id: string;
  nombreEmpresa: string;
  contactoNombre: string | null;
  contactoCorreo: string;
  contactoTelefono: string | null;
  mensaje: string | null;
  estado: EstadoLead;
  notasSeguimiento: string | null;
  creadoEn: Date;
}

export type FormatoCreatividad = 'imagen_texto' | 'imagen_texto_video';

/** RF-COMM-004 -- campana publicitaria concreta. Nace en 'pendiente_revision', nunca 'activa' directamente. */
export interface DatosNuevaCampana {
  espacioPublicitarioId: string;
  planComercialId: string;
  leadAnuncianteId?: string;
  nombreAnunciante: string;
  formato: FormatoCreatividad;
  archivoUrl: string;
  /** Formato YYYY-MM-DD. */
  fechaInicio: string;
  fechaFin: string;
}

export interface CampanaResumen {
  id: string;
  espacioPublicitarioId: string;
  espacioNombre: string;
  planNombre: string;
  nombreAnunciante: string;
  formato: string;
  archivoUrl: string;
  fechaInicio: string;
  fechaFin: string;
  estado: string;
  aprobadoPorUsuarioId: string | null;
  aprobadoEn: Date | null;
}

/** RF-COMM-005 -- lo que la landing publica necesita para renderizar un anuncio, sin exponer nada mas. */
export interface CampanaActiva {
  campanaId: string;
  nombreAnunciante: string;
  formato: string;
  archivoUrl: string;
  anchoPx: number | null;
  altoPx: number | null;
}

export interface MetricaDia {
  fecha: string;
  impresiones: number;
  clics: number;
}

export interface ComercialRepositorio {
  crearEspacioPublicitario(
    datos: DatosNuevoEspacioPublicitario,
  ): Promise<{ id: string }>;
  listarEspaciosPublicitarios(): Promise<EspacioPublicitarioResumen[]>;

  crearPlanComercial(datos: DatosNuevoPlanComercial): Promise<{ id: string }>;
  listarPlanesComerciales(): Promise<PlanComercialResumen[]>;

  /** RF-COMM-003 -- publico, sin login. */
  crearLead(datos: DatosNuevoLead): Promise<{ id: string }>;
  listarLeads(): Promise<LeadResumen[]>;
  actualizarEstadoLead(
    id: string,
    datos: { estado?: EstadoLead; notasSeguimiento?: string },
  ): Promise<void>;

  /** RF-COMM-004/007 -- moderacion obligatoria: nunca pasa a 'activa' sin aprobacion explicita. */
  crearCampana(datos: DatosNuevaCampana): Promise<{ id: string }>;
  listarCampanas(): Promise<CampanaResumen[]>;
  aprobarCampana(
    campanaId: string,
    usuarioId: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;
  rechazarCampana(
    campanaId: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;

  /**
   * RF-COMM-005 -- solo campanas con estado='activa' Y hoy dentro de su
   * vigencia (fechaInicio/fechaFin), para el espacio pedido. Publico,
   * sin login -- es lo que alimenta la landing en vivo.
   */
  listarCampanasActivas(ubicacion: string): Promise<CampanaActiva[]>;

  /**
   * Solo incrementa si la campana existe y sigue 'activa' -- protege
   * contra inflar metricas de campanas vencidas/rechazadas con un ID
   * inventado o viejo.
   */
  registrarImpresion(campanaId: string): Promise<void>;
  registrarClic(campanaId: string): Promise<void>;

  obtenerMetricasCampana(campanaId: string): Promise<MetricaDia[]>;
}
