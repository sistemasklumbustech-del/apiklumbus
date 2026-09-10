import { IsNumber, Min } from 'class-validator';

export class ActualizarPrecioViajeDto {
  @IsNumber()
  @Min(0)
  precioBase!: number;
}
