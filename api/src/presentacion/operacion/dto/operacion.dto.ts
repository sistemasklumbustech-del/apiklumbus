import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Filtros del panel operativo (RF-022); los mismos sirven para resumen, listado y exportación. */
export class FiltrosOperacionDto {
  /** YYYY-MM-DD, hora de Ecuador. Sin fechas, se usa el día de hoy. */
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
  @IsUUID()
  rutaId?: string;

  @IsOptional()
  @IsIn(['programado', 'en_curso', 'finalizado', 'cancelado'])
  estado?: 'programado' | 'en_curso' | 'finalizado' | 'cancelado';
}

export class ConsultarViajesOperacionDto extends FiltrosOperacionDto {
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

export class OpcionesRutasDto {
  @IsOptional()
  @IsUUID()
  cooperativaId?: string;
}
