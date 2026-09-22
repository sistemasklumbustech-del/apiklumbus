import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

class DatosCooperativaDto {
  @IsString()
  @MinLength(10)
  ruc!: string;

  @IsString()
  @MinLength(3)
  razonSocial!: string;

  @IsString()
  @MinLength(3)
  nombreComercial!: string;

  @IsIn(['modelo_a', 'modelo_b'])
  modeloIntegracion!: 'modelo_a' | 'modelo_b';

  @IsOptional() @IsString() contactoNombre?: string;
  @IsOptional() @IsEmail() contactoCorreo?: string;
  @IsOptional() @IsString() contactoTelefono?: string;
}

class DatosPrimerUsuarioDto {
  @IsEmail()
  correo!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(3)
  nombreCompleto!: string;
}

/** RF-035 -- suspender ('suspendida') o reactivar ('aprobada') una cooperativa. */
export class CambiarEstadoCooperativaDto {
  @IsIn(['aprobada', 'suspendida'])
  estado!: 'aprobada' | 'suspendida';

  @IsOptional()
  @IsString()
  motivo?: string;
}

export class CrearCooperativaDto {
  @ValidateNested()
  @Type(() => DatosCooperativaDto)
  cooperativa!: DatosCooperativaDto;

  @ValidateNested()
  @Type(() => DatosPrimerUsuarioDto)
  usuario!: DatosPrimerUsuarioDto;
}

export class CrearPuntoOperacionDto {
  @IsIn(['terminal_terrestre', 'oficina_agencia', 'parada_intermedia'])
  tipo!: 'terminal_terrestre' | 'oficina_agencia' | 'parada_intermedia';

  @IsString()
  @MinLength(3)
  nombre!: string;

  @IsString()
  ciudad!: string;

  @IsString()
  provincia!: string;

  @IsOptional()
  @IsString()
  cooperativaPropietariaId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tasaMonto?: number;
}

export class ActualizarPuntoOperacionDto {
  @IsOptional()
  @IsIn(['terminal_terrestre', 'oficina_agencia', 'parada_intermedia'])
  tipo?: 'terminal_terrestre' | 'oficina_agencia' | 'parada_intermedia';

  @IsOptional()
  @IsString()
  @MinLength(3)
  nombre?: string;

  @IsOptional()
  @IsString()
  ciudad?: string;

  @IsOptional()
  @IsString()
  provincia?: string;

  @IsOptional()
  @IsString()
  cooperativaPropietariaId?: string;

  /** Vacío real de diseño encontrado el 29-jul-2026 -- terminales no tenían logo, cooperativas sí. */
  @IsOptional()
  @IsString()
  logoUrl?: string;

  /**
   * Coordenadas reales (17-ago-2026) -- hallazgo real: la columna ya
   * existía en el esquema (tenancy.ts), pero nunca se pudo escribir
   * desde ningún formulario ni DTO -- "Ver trayecto en el mapa" nunca
   * funcionó para ninguna terminal por esto. Opcionales (no todas las
   * terminales existentes las tienen todavía), rango real de
   * coordenadas válidas (-90 a 90 latitud, -180 a 180 longitud).
   */
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tasaMonto?: number;
}

export class ActualizarIvaNacionalDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  ivaPorcentaje!: number;
}

export class CrearBannerPropioDto {
  @IsString()
  @MinLength(2)
  titulo!: string;

  @IsUrl()
  imagenUrl!: string;

  @IsUrl()
  enlaceUrl!: string;

  @IsOptional()
  @IsNumber()
  orden?: number;
}

export class ActualizarBannerPropioDto {
  @IsOptional()
  activo?: boolean;
  @IsOptional()
  @IsNumber()
  orden?: number;
}

export class ActualizarCargoPlataformaDto {
  @IsNumber()
  @Min(0)
  monto!: number;
}

/**
 * Contacto de soporte global de la plataforma (13-ago-2026). Ambos
 * opcionales -- se puede configurar solo uno de los 2, o ninguno
 * (para volver a ocultarlos sin tener que cambiar el otro).
 */
export class ActualizarContactoSoporteDto {
  @IsOptional()
  @IsEmail()
  correo?: string;

  @IsOptional()
  @IsString()
  telefono?: string;
}

/** 27-jul-2026 -- editable desde el Panel Admin. */
export class ActualizarModoIvaBoletoDto {
  @IsIn(['calculado', 'cero', 'oculto'])
  modo!: 'calculado' | 'cero' | 'oculto';
}

/**
 * Ítem 9, Fase 2 (04-ago-2026) -- solo super_admin puede crear otros
 * administradores (matriz de permisos, sección 3.8 del documento maestro).
 */
export class CrearAdministradorDto {
  @IsEmail()
  correo!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(3)
  nombreCompleto!: string;

  @IsIn(['admin_plataforma', 'super_admin'])
  rol!: 'admin_plataforma' | 'super_admin';
}

/**
 * RF-017, paginación real (22-sep-2026) -- antes este reporte traía
 * TODOS los boletos de toda la plataforma en una sola llamada, sin
 * ningún filtro server-side; con miles de boletos eso se vuelve lento
 * o directamente inviable. `soloDiscrepancias`/`pagina`/`limite` se
 * aplican en el servicio (después de calcularDiscrepancias, que es
 * lógica de negocio pura, no debe vivir en SQL -- ver conciliacion.util.ts);
 * `desde`/`hasta`/`cooperativaId`/`busqueda` sí se aplican en la
 * consulta SQL, para no traer de la base más de lo necesario.
 */
export class ConciliacionQueryDto {
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

  @IsOptional()
  @IsUUID()
  cooperativaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  busqueda?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  soloDiscrepancias?: boolean;

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
