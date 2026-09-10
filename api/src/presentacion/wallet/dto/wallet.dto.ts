import { IsNumber, Max, Min } from 'class-validator';

export class ActualizarCashbackPorcentajeDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  porcentaje!: number;
}
