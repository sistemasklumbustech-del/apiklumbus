import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Filtros de la pantalla de auditoría (RF-021); los mismos sirven para exportar. */
export class ConsultarAuditoriaDto {
  /** Valor del enum accion_auditoria; si no existe, simplemente no devuelve filas. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  accion?: string;

  @IsOptional()
  @IsIn(['usuario', 'sistema'])
  origen?: 'usuario' | 'sistema';

  @IsOptional()
  @IsIn(['exito', 'fallo'])
  resultado?: 'exito' | 'fallo';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  busqueda?: string;

  @IsOptional()
  @IsString()
  @MaxLength(45)
  ip?: string;

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
