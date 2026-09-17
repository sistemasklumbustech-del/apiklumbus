/**
 * Interfaces (puertos) del dominio de Términos y Condiciones — RF-024.
 * Mismo criterio que el resto del proyecto: el dominio no conoce
 * Drizzle, solo esta forma mínima.
 */
export interface VersionTerminos {
  id: string;
  version: string;
  contenido: string;
  vigenteDesde: Date;
}

export interface DatosAceptacionTerminos {
  terminosVersionId: string;
  usuarioId?: string;
  compraId?: string;
  direccionIp?: string;
}

export interface TerminosRepositorio {
  /** La versión vigente en este momento -- null si todavía no se publicó ninguna. */
  obtenerVigente(): Promise<VersionTerminos | null>;
  registrarAceptacion(datos: DatosAceptacionTerminos): Promise<void>;
}
