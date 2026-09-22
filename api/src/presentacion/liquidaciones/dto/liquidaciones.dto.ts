import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GenerarLiquidacionDto {
  @IsUUID()
  cooperativaId!: string;

  @IsISO8601()
  periodoInicio!: string;

  @IsISO8601()
  periodoFin!: string;
}

/**
 * Paginación real (22-sep-2026) -- antes GET /admin/liquidaciones (y su
 * espejo GET /coop/liquidaciones) devolvía todo el historial de una
 * sola vez, con el único filtro opcional de cooperativaId. cooperativaId
 * es obligatorio del lado de la cooperativa (siempre la propia, forzado
 * por el controller) y opcional del lado admin.
 */
export class ConsultarLiquidacionesDto {
  @IsOptional()
  @IsUUID()
  cooperativaId?: string;

  @IsOptional()
  @IsIn(['pendiente', 'pagada'])
  estado?: 'pendiente' | 'pagada';

  /** Sobre periodo_inicio, YYYY-MM-DD. */
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

/** Mismo filtro que ConsultarLiquidacionesDto, sin cooperativaId -- del lado cooperativa siempre es la propia. */
export class ConsultarMisLiquidacionesDto {
  @IsOptional()
  @IsIn(['pendiente', 'pagada'])
  estado?: 'pendiente' | 'pagada';

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
