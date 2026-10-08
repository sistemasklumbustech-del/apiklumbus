import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Paginación y vista de GET /coop/ventas-por-confirmar. */
export class ConsultarVentasPorConfirmarDto {
  @IsOptional()
  @IsIn(['por_confirmar', 'confirmadas'])
  vista?: 'por_confirmar' | 'confirmadas';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite?: number;
}
