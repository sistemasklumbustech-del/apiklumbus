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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CrearEspacioPublicitarioDto {
  @IsString()
  @MinLength(2)
  nombre!: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsInt()
  @Min(1)
  anchoPx!: number;

  @IsInt()
  @Min(1)
  altoPx!: number;

  @IsString()
  ubicacion!: string;

  @IsOptional()
  @IsBoolean()
  permiteRotacion?: boolean;
}

export class CrearPlanComercialDto {
  @IsIn(['basico', 'destacado', 'premium'])
  nombre!: 'basico' | 'destacado' | 'premium';

  @IsOptional()
  @IsNumber()
  @Min(0)
  precioMensual?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  duracionDiasDefault?: number;

  @IsArray()
  formatosPermitidos!: string[];
}

export class CrearLeadDto {
  @IsString()
  @MinLength(2)
  nombreEmpresa!: string;

  @IsOptional()
  @IsString()
  contactoNombre?: string;

  @IsEmail()
  contactoCorreo!: string;

  @IsOptional()
  @IsString()
  contactoTelefono?: string;

  @IsOptional()
  @IsString()
  mensaje?: string;
}

/** Paginación real (22-sep-2026) -- antes GET /admin/leads devolvía todos los leads sin filtros. */
export class ConsultarLeadsDto {
  @IsOptional()
  @IsIn(['nuevo', 'contactado', 'cerrado'])
  estado?: 'nuevo' | 'contactado' | 'cerrado';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  busqueda?: string;

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

export class ActualizarEstadoLeadDto {
  @IsOptional()
  @IsIn(['nuevo', 'contactado', 'cerrado'])
  estado?: 'nuevo' | 'contactado' | 'cerrado';

  @IsOptional()
  @IsString()
  notasSeguimiento?: string;
}

export class CrearCampanaDto {
  @IsString()
  espacioPublicitarioId!: string;

  @IsString()
  planComercialId!: string;

  @IsOptional()
  @IsString()
  leadAnuncianteId?: string;

  @IsString()
  @MinLength(2)
  nombreAnunciante!: string;

  @IsIn(['imagen_texto', 'imagen_texto_video'])
  formato!: 'imagen_texto' | 'imagen_texto_video';

  @IsString()
  archivoUrl!: string;

  @IsISO8601()
  fechaInicio!: string;

  @IsISO8601()
  fechaFin!: string;
}

export class ListarActivasDto {
  @IsString()
  @MinLength(1)
  ubicacion!: string;
}
