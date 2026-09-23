/**
 * Dominio de administracion de plataforma -- RF-ADMIN.
 */

export interface DatosNuevaCooperativa {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  modeloIntegracion: 'modelo_a' | 'modelo_b';
  contactoNombre?: string;
  contactoCorreo?: string;
  contactoTelefono?: string;
}

export interface DatosPrimerUsuarioCooperativa {
  correo: string;
  password: string;
  nombreCompleto: string;
}

export interface DatosNuevoPuntoOperacion {
  tipo: 'terminal_terrestre' | 'oficina_agencia' | 'parada_intermedia';
  nombre: string;
  ciudad: string;
  provincia: string;
  cooperativaPropietariaId?: string;
  tasaMonto?: number;
  /** Vacío real de diseño encontrado el 29-jul-2026 -- terminales no tenían logo, cooperativas sí. */
  logoUrl?: string;
  /**
   * Coordenadas reales (17-ago-2026) -- la columna ya existía en el
   * esquema, nunca se pudo escribir desde ningún formulario.
   */
  latitud?: number;
  longitud?: number;
}

export interface FilaVentaNacional {
  cooperativaNombre: string;
  totalVentas: number;
  totalBoletos: number;
}

/**
 * 27-jul-2026 -- controla como se muestra el IVA del pasaje al pasajero
 * en el checkout, sin afectar el valor real guardado internamente. Ver
 * comentario completo en packages/db/schema/configuracion.ts.
 */
export type ModoIvaBoleto = 'calculado' | 'cero' | 'oculto';

/**
 * Ítem 9, Fase 2 (04-ago-2026) -- división de admin_plataforma en
 * super_admin + admin_plataforma, matriz de permisos en sección 3.8
 * del documento maestro.
 */
export interface DatosNuevoAdministrador {
  correo: string;
  password: string;
  nombreCompleto: string;
  rol: 'admin_plataforma' | 'super_admin';
}

export interface FiltrosAdministradores {
  rol?: 'admin_plataforma' | 'super_admin';
  activo?: boolean;
  busqueda?: string;
  pagina: number;
  limite: number;
}

export interface ResultadoAdministradores {
  filas: AdministradorResumen[];
  total: number;
  pagina: number;
  limite: number;
}

export interface AdministradorResumen {
  id: string;
  correo: string;
  nombreCompleto: string;
  rol: 'admin_plataforma' | 'super_admin';
  activo: boolean;
  creadoEn: string;
}

/**
 * 02-ago-2026 -- RF-ADMIN, sección 3.13 del documento maestro: conteo
 * de usuarios registrados por rol, para el admin de plataforma. Solo
 * cuenta usuarios con activo=true (decisión de diseño: un usuario
 * inactivo no debe pesar en "cuántos usuarios hay" operativamente).
 */
export interface FilaConteoUsuariosPorRol {
  rol: string;
  cantidad: number;
}

/**
 * RF-017 -- una fila por boleto, con el estado crudo de cada pieza que
 * debería estar consistente entre sí (pago, tasa de terminal,
 * comprobante tributario). Sin `discrepancias` todavía -- eso lo calcula
 * `calcularDiscrepancias` (conciliacion.util.ts), una función de dominio
 * pura, no este repositorio: la regla de qué combinación de estados
 * cuenta como problema es una decisión de negocio, no un detalle de
 * cómo se consultó la base de datos (Arquitectura Técnica 2.1).
 */
export interface FilaConciliacionCruda {
  boletoId: string;
  codigoQr: string;
  estadoBoleto: string;
  compraId: string;
  cooperativaNombre: string;
  creadoEn: string;
  estadoPago: string | null;
  montoPago: number | null;
  estadoRegistroTasa: string | null;
  codigoTasa: string | null;
  estadosComprobanteElectronico: string[] | null;
}

export interface FilaConciliacion extends FilaConciliacionCruda {
  discrepancias: string[];
}

/** Filtros que sí se aplican en SQL (repositorio) -- ver conciliacion() más abajo. */
export interface FiltrosConciliacionSql {
  desde?: string;
  hasta?: string;
  cooperativaId?: string;
  busqueda?: string;
}

/** Filtros completos que recibe el servicio -- soloDiscrepancias/pagina/limite se resuelven ahí, no en SQL. */
export interface FiltrosConciliacion extends FiltrosConciliacionSql {
  soloDiscrepancias?: boolean;
  pagina: number;
  limite: number;
}

export interface ResultadoConciliacion {
  filas: FilaConciliacion[];
  total: number;
  /** Del conjunto ya filtrado por fecha/cooperativa/búsqueda, antes de aplicar soloDiscrepancias. */
  totalConDiscrepancias: number;
  pagina: number;
  limite: number;
}

/**
 * Búsqueda paginada de cooperativas para la tabla de gestión (22-sep-2026)
 * -- distinta de listarCooperativas() (abajo), que se deja intacta
 * porque la usan los selectores de cooperativa de Conciliación y
 * Liquidaciones: esos necesitan la lista completa sin paginar (no
 * tendría sentido un <select> paginado), mientras que la tabla de
 * gestión sí necesita filtrar y paginar de verdad.
 */
export interface CooperativaDetalle {
  id: string;
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  estado: string;
  contactoNombre: string | null;
  contactoCorreo: string | null;
  contactoTelefono: string | null;
  fechaAfiliacion: string | null;
}

export interface FiltrosCooperativas {
  estado?: string;
  busqueda?: string;
  pagina: number;
  limite: number;
}

export interface ResultadoCooperativas {
  filas: CooperativaDetalle[];
  total: number;
  pagina: number;
  limite: number;
}

/**
 * Paginación real (23-sep-2026) -- antes listarPuntosOperacion devolvía
 * todos los puntos de una sola vez. Único consumidor: la tabla de
 * gestión de /admin/puntos-operacion (la cola de propuestas
 * pendientes tiene su propio endpoint, corto por diseño).
 */
export interface PuntoOperacionAdmin {
  id: string;
  tipo: string;
  nombre: string;
  ciudad: string;
  provincia: string;
  tasaMonto: number | null;
  logoUrl: string | null;
  latitud: number | null;
  longitud: number | null;
  cooperativaPropietariaNombre: string | null;
}

export interface FiltrosPuntosOperacion {
  tipo?: string;
  busqueda?: string;
  pagina: number;
  limite: number;
}

export interface ResultadoPuntosOperacion {
  filas: PuntoOperacionAdmin[];
  total: number;
  pagina: number;
  limite: number;
}

export interface AdminRepositorio {
  crearCooperativaConPrimerUsuarioAtomico(
    datosCooperativa: DatosNuevaCooperativa,
    datosUsuario: DatosPrimerUsuarioCooperativa,
  ): Promise<{ cooperativaId: string; usuarioId: string }>;

  listarCooperativas(): Promise<
    { id: string; nombreComercial: string; estado: string }[]
  >;

  buscarCooperativas(
    filtros: FiltrosCooperativas,
  ): Promise<ResultadoCooperativas>;

  listarPuntosOperacion(
    filtros: FiltrosPuntosOperacion,
  ): Promise<ResultadoPuntosOperacion>;

  crearPuntoOperacion(
    datos: DatosNuevoPuntoOperacion,
  ): Promise<{ puntoOperacionId: string }>;

  actualizarPuntoOperacion(
    id: string,
    datos: Partial<DatosNuevoPuntoOperacion>,
  ): Promise<void>;

  /**
   * Cooperativas proponen sus propios puntos de operación (13-ago-2026)
   * -- crea directo en 'pendiente_revision', mismo estilo que
   * crearPuntoOperacion pero sin permitir 'terminal_terrestre' (se
   * valida en la capa de aplicación, antes de llegar aquí -- este
   * método confía en que ya se validó).
   */
  proponerPuntoOperacion(datos: {
    tipo: 'oficina_agencia' | 'parada_intermedia';
    nombre: string;
    ciudad: string;
    provincia: string;
    cooperativaPropietariaId: string;
  }): Promise<{ puntoOperacionId: string }>;

  listarPuntosOperacionPendientes(): Promise<
    {
      id: string;
      tipo: string;
      nombre: string;
      ciudad: string;
      provincia: string;
      cooperativaPropietariaId: string | null;
      cooperativaPropietariaNombre: string | null;
      creadoEn: Date;
    }[]
  >;

  /** Mismo patrón exacto que aprobarCampana/rechazarCampana -- ok:false con motivo si ya no está pendiente. */
  aprobarPuntoOperacion(
    id: string,
    usuarioId: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;

  rechazarPuntoOperacion(
    id: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;

  /**
   * Contacto de soporte global de la plataforma (13-ago-2026) --
   * decisión real del director, investigada contra FlixBus (mismo
   * modelo: soporte centralizado en la marca de la plataforma, no en
   * cada operador). Mismo patrón exacto que obtenerCargoPlataforma /
   * actualizarCargoPlataforma.
   */
  obtenerContactoSoporte(): Promise<{
    correo: string | null;
    telefono: string | null;
  }>;
  actualizarContactoSoporte(
    datos: { correo: string | null; telefono: string | null },
    usuarioId: string,
  ): Promise<void>;

  dashboardNacional(): Promise<FilaVentaNacional[]>;

  obtenerIvaNacional(): Promise<number>;

  actualizarYPropagarIvaNacional(
    nuevoPorcentaje: number,
    usuarioId: string,
  ): Promise<{ cooperativasActualizadas: number }>;

  obtenerCargoPlataforma(): Promise<number>;
  /** 04-ago-2026 -- usuarioId nuevo, para la auditoría (accion='cambio_comision', exclusivo de super_admin). */
  actualizarCargoPlataforma(
    nuevoMonto: number,
    usuarioId: string,
  ): Promise<void>;

  listarBannersPropios(): Promise<
    {
      id: string;
      titulo: string;
      imagenUrl: string;
      enlaceUrl: string;
      activo: boolean;
      orden: number;
    }[]
  >;
  crearBannerPropio(datos: {
    titulo: string;
    imagenUrl: string;
    enlaceUrl: string;
    orden?: number;
  }): Promise<{ id: string }>;
  actualizarBannerPropio(
    id: string,
    datos: { activo?: boolean; orden?: number },
  ): Promise<void>;
  eliminarBannerPropio(id: string): Promise<void>;

  /** 27-jul-2026 -- editable desde el Panel Admin, sin tocar codigo. */
  obtenerModoIvaBoleto(): Promise<ModoIvaBoleto>;
  /** 04-ago-2026 -- usuarioId nuevo, para la auditoría (accion='cambio_modo_iva_boleto', exclusivo de super_admin). */
  actualizarModoIvaBoleto(
    modo: ModoIvaBoleto,
    usuarioId: string,
  ): Promise<void>;

  /** 02-ago-2026 -- RF-ADMIN sección 3.13, contador de usuarios por rol. */
  contarUsuariosPorRol(): Promise<FilaConteoUsuariosPorRol[]>;

  /**
   * Ítem 9, Fase 2 (04-ago-2026) -- exclusivo de super_admin. Registra
   * auditoría (accion='creacion_administrador'/'eliminacion_administrador').
   */
  crearAdministrador(
    datos: DatosNuevoAdministrador,
    creadoPorUsuarioId: string,
  ): Promise<{ id: string }>;
  /** Compartido -- ver un admin de menor rango no es tan sensible como crearlo o eliminarlo. */
  listarAdministradores(
    filtros: FiltrosAdministradores,
  ): Promise<ResultadoAdministradores>;
  eliminarAdministrador(
    id: string,
    eliminadoPorUsuarioId: string,
  ): Promise<void>;

  /**
   * Baja lógica (`estado = 'dada_de_baja'`), NO eliminación física --
   * decisión del director tras el hallazgo de que un DELETE en cascada
   * real tocaría boletos/pagos/liquidaciones, registros históricos que
   * no se deben destruir. Exclusivo de super_admin.
   */
  eliminarCooperativa(id: string, eliminadoPorUsuarioId: string): Promise<void>;

  /**
   * Suspender o reactivar una cooperativa (RF-035). Suspendida = no
   * aparece en búsquedas ni puede vender (ver el gate en
   * busqueda.service.ts y validarYCalcularAsientos), pero conserva
   * todo su historial. Una cooperativa dada de baja no se reactiva
   * por acá (la baja es irreversible). Deja registro en auditoría.
   */
  cambiarEstadoCooperativa(
    id: string,
    nuevoEstado: 'aprobada' | 'suspendida',
    usuarioId: string,
    motivo?: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;

  /** RF-017 -- filas crudas por boleto, ya acotadas por los filtros SQL. */
  conciliacion(
    filtros: FiltrosConciliacionSql,
  ): Promise<FilaConciliacionCruda[]>;
}
