import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CalificarViajeDto {
  @IsUUID()
  boletoId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  puntuacion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentario?: string;
}

/** Reseñas de texto reales (13-ago-2026) -- paginación real, 10 por página (mismo criterio que Amazon). */
export class ListarResenasQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  porPagina?: number = 10;
}

/** "Mis boletos" con filtros y paginación (24-sep-2026). */
export class ConsultarMisBoletosDto {
  @IsOptional()
  @IsIn(['vigente', 'usado', 'cancelado'])
  estado?: 'vigente' | 'usado' | 'cancelado';

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
  @Max(50)
  limite?: number;
}
