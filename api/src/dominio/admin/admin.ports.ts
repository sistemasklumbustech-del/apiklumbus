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

export interface AdminRepositorio {
  crearCooperativaConPrimerUsuarioAtomico(
    datosCooperativa: DatosNuevaCooperativa,
    datosUsuario: DatosPrimerUsuarioCooperativa,
  ): Promise<{ cooperativaId: string; usuarioId: string }>;

  listarCooperativas(): Promise<
    { id: string; nombreComercial: string; estado: string }[]
  >;

  listarPuntosOperacion(): Promise<
    {
      id: string;
      tipo: string;
      nombre: string;
      ciudad: string;
      provincia: string;
      tasaMonto: number | null;
      cooperativaPropietariaNombre: string | null;
    }[]
  >;

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
  obtenerContactoSoporte(): Promise<{ correo: string | null; telefono: string | null }>;
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
  actualizarCargoPlataforma(nuevoMonto: number, usuarioId: string): Promise<void>;

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
  actualizarModoIvaBoleto(modo: ModoIvaBoleto, usuarioId: string): Promise<void>;

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
  listarAdministradores(): Promise<AdministradorResumen[]>;
  eliminarAdministrador(id: string, eliminadoPorUsuarioId: string): Promise<void>;

  /**
   * Baja lógica (`estado = 'dada_de_baja'`), NO eliminación física --
   * decisión del director tras el hallazgo de que un DELETE en cascada
   * real tocaría boletos/pagos/liquidaciones, registros históricos que
   * no se deben destruir. Exclusivo de super_admin.
   */
  eliminarCooperativa(id: string, eliminadoPorUsuarioId: string): Promise<void>;
}
