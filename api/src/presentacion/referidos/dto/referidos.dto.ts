import { IsNumber, Min } from 'class-validator';

export class ActualizarConfiguracionReferidosDto {
  @IsNumber()
  @Min(0)
  creditoReferidor!: number;

  @IsNumber()
  @Min(0)
  descuentoReferido!: number;
}
