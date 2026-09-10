import { IsISO8601, IsUUID } from 'class-validator';

export class GenerarLiquidacionDto {
  @IsUUID()
  cooperativaId!: string;

  @IsISO8601()
  periodoInicio!: string;

  @IsISO8601()
  periodoFin!: string;
}
