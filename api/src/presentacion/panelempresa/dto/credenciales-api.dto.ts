import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Credenciales API — Modelo B (02-ago-2026). webhookUrl es opcional al
 * crear -- una cooperativa puede generar su credencial antes de tener
 * listo su endpoint receptor, y configurarlo después.
 */
export class CrearCredencialApiDto {
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'webhookUrl debe ser una URL válida.' })
  webhookUrl?: string;
}

export class ActualizarWebhookCredencialApiDto {
  // Se acepta cadena vacía a propósito (mismo patrón que ActualizarPerfilDto
  // con logoUrl) -- el controller la convierte a null para "quitar el webhook".
  @IsOptional()
  @IsString()
  webhookUrl?: string;
}

/** Paginación real (23-sep-2026) -- GET /coop/credenciales-api. */
export class ConsultarCredencialesApiDto {
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
