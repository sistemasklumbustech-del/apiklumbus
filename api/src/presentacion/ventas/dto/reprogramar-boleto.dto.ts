import { IsUUID, IsString, MinLength } from 'class-validator';

/** Reprogramación con crédito (Fase C, 29-jul-2026). */
export class ReprogramarBoletoDto {
  @IsUUID()
  nuevoViajeId!: string;

  @IsString()
  @MinLength(1)
  nuevoNumeroAsiento!: string;
}
