import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Cooperativas proponen sus propios puntos de operación (13-ago-2026)
 * -- solo oficina_agencia/parada_intermedia, terminal_terrestre sigue
 * siendo exclusivo del admin (infraestructura pública compartida).
 */
export class ProponerPuntoOperacionDto {
  @IsIn(['oficina_agencia', 'parada_intermedia'])
  tipo!: 'oficina_agencia' | 'parada_intermedia';

  @IsString()
  @MinLength(3)
  nombre!: string;

  @IsString()
  ciudad!: string;

  @IsString()
  provincia!: string;
}

export class CrearTipoVehiculoDto {
  @IsString()
  @MinLength(2)
  nombre!: string;

  /** 29-jul-2026 -- categoría estructurada, separada del nombre libre. */
  @IsOptional()
  @IsIn(['bus', 'buseta', 'van', 'auto'])
  categoria?: 'bus' | 'buseta' | 'van' | 'auto';

  @IsInt()
  @Min(1)
  capacidadTotal!: number;

  @IsOptional()
  distribucionAsientos?: unknown = {};

  /** Ítem 11 (04-ago-2026) -- catálogo cerrado, sección 3.2 del documento maestro. */
  @IsOptional()
  @IsArray()
  @IsIn(['wifi', 'aire_acondicionado', 'bano_a_bordo', 'cargadores', 'asientos_reclinables', 'tv'], {
    each: true,
  })
  amenidades?: ('wifi' | 'aire_acondicionado' | 'bano_a_bordo' | 'cargadores' | 'asientos_reclinables' | 'tv')[];
}

export class CrearUnidadDto {
  @IsString()
  tipoVehiculoId!: string;

  @IsString()
  @MinLength(3)
  placa!: string;

  @IsString()
  @MinLength(1)
  identificadorOperativo!: string;
}

export class CrearRutaDto {
  @IsString()
  origenPuntoOperacionId!: string;

  @IsString()
  destinoPuntoOperacionId!: string;

  @IsNumber()
  @Min(0)
  precioBaseReferencia!: number;

  @IsOptional()
  @IsString()
  nombre?: string;
}

/** Parada intermedia de una ruta -- RF-COOP-002. El precio (tarifaDesdeOrigen)
 * lo decide la cooperativa a mano, no una formula automatica. */
export class CrearParadaDto {
  @IsString()
  rutaId!: string;

  @IsString()
  puntoOperacionId!: string;

  @IsInt()
  @Min(1)
  orden!: number;

  @IsNumber()
  @Min(0)
  tarifaDesdeOrigen!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  tiempoEstimadoDesdeOrigenMinutos?: number;
}

export class EditarParadaDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  orden?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tarifaDesdeOrigen?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  tiempoEstimadoDesdeOrigenMinutos?: number;
}

export class CrearViajeDto {
  @IsString()
  rutaId!: string;

  @IsString()
  unidadId!: string;

  /** Formato YYYY-MM-DD. */
  @IsISO8601()
  fechaSalida!: string;

  /** Fecha y hora completa con zona horaria, ej. 2026-08-01T10:00:00-05:00. */
  @IsISO8601()
  horaSalidaProgramada!: string;

  /**
   * Hallazgo real del director (16-ago-2026, comparando con
   * plataformas profesionales): este campo nunca existió en toda la
   * historia del sistema -- ningún viaje real tenía hora de llegada
   * estimada, así que la pantalla de resultados nunca la podía
   * mostrar. Opcional a propósito (una cooperativa puede no saberla
   * con precisión al crear el viaje), pero ahora sí se puede capturar.
   */
  @IsOptional()
  @IsISO8601()
  horaLlegadaEstimada?: string;

  /**
   * Zona VIP de asientos (17-ago-2026, orden real del director): monto
   * FIJO adicional que se cobra sobre los asientos con etiqueta 'vip'
   * en la distribución de asientos del tipo de vehículo -- configurable
   * por la cooperativa en CADA viaje que crea, nunca un valor de
   * plataforma. Opcional, 0 por defecto si no se envía.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  recargoVip?: number;

  @IsNumber()
  @Min(0)
  precioBase!: number;

  /** Opcional: no bloquea publicar el viaje, se puede asignar despues. */
  @IsOptional()
  @IsUUID()
  conductorId?: string;
}

export class CrearUsuarioStaffDto {
  @IsEmail()
  correo!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(3)
  nombreCompleto!: string;

  @IsIn(['vendedor', 'admin_cooperativa'])
  rol!: 'vendedor' | 'admin_cooperativa';
}

export class CrearConductorDto {
  @IsString()
  @MinLength(3)
  nombreCompleto!: string;

  @IsString()
  @MinLength(5)
  cedula!: string;

  @IsOptional() @IsString() licenciaNumero?: string;
  @IsOptional() @IsString() licenciaCategoria?: string;
  @IsOptional() @IsString() telefono?: string;
}

/**
 * Carga masiva — validación deliberadamente ligera (no valida cada
 * campo anidado uno por uno): es un payload de importación flexible por
 * diseño, y el repositorio ya rechaza con un mensaje claro cualquier
 * `ref` mal formado o inexistente al momento de insertar (ver
 * panel-empresa.repositorio.drizzle.ts).
 */
/**
 * Clases de item para la carga masiva (RF-COOP-IMPORT). Antes estas
 * llegaban como `unknown[]` sin validar la forma de cada fila, lo que
 * obligaba a un `dto as any` en el controlador para poder pasarlas al
 * servicio — TypeScript no detectaba si una fila venía incompleta o mal
 * tipada, y class-validator tampoco la rechazaba. Hallazgo real de
 * auditoría (28-jul-2026), corregido con @ValidateNested + DTOs propios
 * por cada tipo de fila, coincidiendo exactamente con los Item Import*
 * de dominio/panelempresa/panel-empresa.ports.ts.
 */
export class ItemImportTipoVehiculoDto {
  @IsOptional() @IsString() ref?: string;
  @IsString() nombre!: string;
  @IsInt() capacidadTotal!: number;
  @IsOptional() distribucionAsientos?: unknown;
}

export class ItemImportConductorDto {
  @IsOptional() @IsString() ref?: string;
  @IsString() nombreCompleto!: string;
  @IsString() cedula!: string;
  @IsOptional() @IsString() licenciaNumero?: string;
  @IsOptional() @IsString() licenciaCategoria?: string;
  @IsOptional() @IsString() telefono?: string;
}

export class ItemImportUnidadDto {
  @IsOptional() @IsString() ref?: string;
  @IsString() tipoVehiculoRef!: string;
  @IsString() placa!: string;
  @IsString() identificadorOperativo!: string;
}

export class ItemImportRutaDto {
  @IsOptional() @IsString() ref?: string;
  @IsString() origenPuntoOperacionId!: string;
  @IsString() destinoPuntoOperacionId!: string;
  @IsNumber() precioBaseReferencia!: number;
  @IsOptional() @IsString() nombre?: string;
}

export class ItemImportHorarioDto {
  @IsString() rutaRef!: string;
  /** 04-ago-2026 -- reemplaza a unidadRef/conductorRef, ver comentario en panel-empresa.ports.ts. */
  @IsString() tipoVehiculoRef!: string;
  @IsString() horaSalida!: string;
  @IsArray() @IsInt({ each: true }) diasSemana!: number[];
}

export class ImportarDatosDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemImportTipoVehiculoDto)
  tiposVehiculo?: ItemImportTipoVehiculoDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemImportConductorDto)
  conductores?: ItemImportConductorDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemImportUnidadDto)
  unidades?: ItemImportUnidadDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemImportRutaDto)
  rutas?: ItemImportRutaDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemImportHorarioDto)
  horarios?: ItemImportHorarioDto[];

  @IsOptional() @IsISO8601() generarViajesDesde?: string;
  @IsOptional() @IsISO8601() generarViajesHasta?: string;
}

/** Perfil visual de la cooperativa — hoy solo el logo (22-jul-2026). */
export class ActualizarPerfilDto {
  // Sin @IsUrl() a propósito: una cadena vacía significa "quitar el
  // logo" (ver panel-empresa.controller.ts), y @IsUrl() la rechazaría
  // como formato inválido. La validación real de "sí es una URL" pasa
  // solo cuando el valor no está vacío, en el propio controlador.
  @IsOptional()
  @IsString()
  logoUrl?: string;
}

/** Cambio de unidad en un viaje ya programado — hallazgo cerrado 22-jul-2026. */
export class CambiarUnidadViajeDto {
  @IsString()
  nuevaUnidadId!: string;
}

/** Historial de ventas (una fila por boleto) -- filtros y paginacion, todos opcionales. */
export class ConsultarVentasDto {
  /** Fecha de venta desde, YYYY-MM-DD (hora de Ecuador). */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "desde debe tener formato YYYY-MM-DD." })
  desde?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "hasta debe tener formato YYYY-MM-DD." })
  hasta?: string;

  @IsOptional()
  @IsIn(["en_linea", "ventanilla"])
  canal?: "en_linea" | "ventanilla";

  @IsOptional()
  @IsIn(["vigente", "usado", "cancelado"])
  estadoBoleto?: "vigente" | "usado" | "cancelado";

  @IsOptional()
  @IsString()
  @MaxLength(100)
  busqueda?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limite?: number;
}

/**
 * Paginación real (22-sep-2026) -- antes GET /coop/viajes devolvía
 * TODOS los viajes de la cooperativa en una sola llamada, sin ningún
 * filtro. Mismo patrón que ConsultarVentasDto.
 */
export class ConsultarViajesDto {
  /** Fecha de salida desde, YYYY-MM-DD. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "desde debe tener formato YYYY-MM-DD.",
  })
  desde?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "hasta debe tener formato YYYY-MM-DD.",
  })
  hasta?: string;

  @IsOptional()
  @IsIn(["programado", "en_curso", "finalizado", "cancelado"])
  estado?: "programado" | "en_curso" | "finalizado" | "cancelado";

  @IsOptional()
  @IsUUID()
  rutaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  busqueda?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;
}

/** conductorId null = quitar el conductor asignado al viaje. */
export class AsignarConductorViajeDto {
  @IsOptional()
  @IsUUID()
  conductorId?: string | null;
}

/** Editar hora/precio de un viaje sin boletos vendidos — hallazgo cerrado 22-jul-2026. */
export class EditarViajeDto {
  @IsOptional()
  @IsISO8601()
  horaSalidaProgramada?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  precioBase?: number;
}

/** Activar/desactivar una unidad — hallazgo cerrado 22-jul-2026. */
export class ActualizarEstadoUnidadDto {
  @IsBoolean()
  activo!: boolean;
}

export class ValidarQrDto {
  @IsString()
  codigoQr!: string;
}

/** RF-MENOR-004 — verificación de documentos del menor en abordaje (22-jul-2026). */
export class VerificarMenorDto {
  @IsString()
  boletoId!: string;

  @IsBoolean()
  documentoIdentidadVerificado!: boolean;

  @IsBoolean()
  documentoAutorizacionVerificado!: boolean;
}

/** Reprogramación con crédito (Fase C, 28-jul-2026) — horas mínimas antes de la salida. */
export class ActualizarHorasLimiteReprogramacionDto {
  @IsInt()
  @Min(0)
  @Max(720) // 30 días como tope razonable, evita valores absurdos por error de tipeo
  horas!: number;
}

/**
 * Política de cancelación/reprogramación (29-jul-2026, hallazgo real):
 * todos los campos opcionales -- solo se actualiza lo que se envía.
 */
export class ActualizarPoliticaCancelacionReprogramacionDto {
  @IsOptional()
  @IsBoolean()
  permiteCancelacion?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  horasLimiteCancelacion?: number;

  @IsOptional()
  @IsBoolean()
  permiteReprogramacion?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  horasLimiteReprogramacion?: number;
}

/** IVA de la cooperativa — ya incluido en el precio del boleto por defecto (15%), configurable, ver 21-jul-2026. */
/** Recargo VIP por defecto de la cooperativa -- corrección real 18-ago-2026, ver cooperativas.recargoVipDefault. */
export class ActualizarConfiguracionVipDto {
  @IsNumber()
  @Min(0)
  recargoVipDefault!: number;
}

export class ActualizarConfiguracionFiscalDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  ivaPorcentaje!: number;

  @IsBoolean()
  ivaVisibleEnBoleto!: boolean;

  // true = seguir el IVA nacional automáticamente (el panel de admin lo
  // actualiza solo). false = quedarme con el valor que acabo de fijar
  // manualmente, sin que las actualizaciones nacionales me lo cambien.
  @IsBoolean()
  ivaSigueTasaNacional!: boolean;
}

/** Editar o desactivar un tipo de vehiculo. */
export class EditarTipoVehiculoDto {
  @IsOptional() @IsString() @MinLength(2) nombre?: string;
  @IsOptional() @IsIn(['bus', 'buseta', 'van', 'auto']) categoria?: 'bus' | 'buseta' | 'van' | 'auto';
  @IsOptional() @IsInt() @Min(1) capacidadTotal?: number;
  @IsOptional() distribucionAsientos?: unknown;
  @IsOptional() @IsBoolean() activo?: boolean;
  @IsOptional()
  @IsArray()
  @IsIn(['wifi', 'aire_acondicionado', 'bano_a_bordo', 'cargadores', 'asientos_reclinables', 'tv'], {
    each: true,
  })
  amenidades?: ('wifi' | 'aire_acondicionado' | 'bano_a_bordo' | 'cargadores' | 'asientos_reclinables' | 'tv')[];
}

/** Editar o desactivar una ruta. */
export class EditarRutaDto {
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsNumber() @Min(0) precioBaseReferencia?: number;
  @IsOptional() @IsBoolean() activa?: boolean;
}

/** Horario recurrente (plantilla) -- ítem 7, RF-COOP-002 (03-ago-2026). */
export class CrearHorarioRutaDto {
  @IsString()
  rutaId!: string;

  /** Formato "HH:MM" (24h, hora local Ecuador). */
  @IsString()
  horaSalida!: string;

  /** 0=domingo..6=sábado. */
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  diasSemana!: number[];

  @IsString()
  tipoVehiculoPredeterminadoId!: string;
}

export class ActualizarEstadoHorarioRutaDto {
  @IsBoolean()
  activo!: boolean;
}

/** Cancelación/suspensión masiva por ruta y rango de fechas -- ítem 7 (03-ago-2026). */
export class CancelarViajesMasivoDto {
  @IsISO8601()
  fechaInicio!: string;

  @IsISO8601()
  fechaFin!: string;
}

/**
 * Ítem 10, Fase 2 (04-ago-2026) -- actualización periódica obligatoria
 * de datos de cooperativa. Todos opcionales: revisar y dejar igual
 * también es una confirmación válida.
 */
export class ConfirmarDatosCooperativaDto {
  @IsOptional() @IsString() @MinLength(3) razonSocial?: string;
  @IsOptional() @IsString() @MinLength(10) ruc?: string;
  @IsOptional() @IsString() direccionLegal?: string;
  @IsOptional() @IsString() contactoNombre?: string;
  @IsOptional() @IsEmail() contactoCorreo?: string;
  @IsOptional() @IsString() contactoTelefono?: string;
}

/**
 * Paginación real (22-sep-2026) -- distinta de GET /coop/rutas (sin
 * filtros, se deja intacta porque la usan los selectores de Viajes).
 * Esta es para la tabla de gestión, en GET /coop/rutas/buscar.
 */
export class BuscarRutasDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  busqueda?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;
}

/**
 * Paginación real (22-sep-2026) -- distinta de GET /coop/unidades (sin
 * filtros, se deja intacta porque la usa el selector de unidad de
 * Viajes). Esta es para la tabla de gestión, en GET /coop/unidades/buscar.
 */
export class BuscarUnidadesDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  busqueda?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;
}

/**
 * Paginación real (22-sep-2026) -- único consumidor de este endpoint
 * (Personal), no hay ningún dropdown que necesite la lista completa.
 */
export class ConsultarUsuariosStaffDto {
  @IsOptional()
  @IsIn(['vendedor', 'admin_cooperativa'])
  rol?: 'vendedor' | 'admin_cooperativa';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  busqueda?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;
}

/**
 * Paginación real (22-sep-2026) -- distinta de GET /coop/conductores
 * (sin filtros, se deja intacta porque la usa el selector de
 * conductor de Viajes). Esta es para la tabla de gestión, en
 * GET /coop/conductores/buscar.
 */
export class BuscarConductoresDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  busqueda?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;
}

/** Rango del dashboard de ventas (23-sep-2026) -- sin rango = hoy. */
export class RangoDashboardDto {
  /** YYYY-MM-DD, hora de Ecuador. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'desde debe tener formato YYYY-MM-DD.',
  })
  desde?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'hasta debe tener formato YYYY-MM-DD.',
  })
  hasta?: string;
}
