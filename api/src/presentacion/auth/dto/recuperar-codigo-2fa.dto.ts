import { IsString, Length } from 'class-validator';

/** Ítem 19, Fase 3 (05-ago-2026) -- respaldo si el admin perdió su app autenticadora. 10 caracteres, mismo formato de generarCodigoRecuperacion. */
export class RecuperarCodigo2faDto {
  @IsString()
  tokenTemporal!: string;

  @IsString()
  @Length(10, 10)
  codigoRecuperacion!: string;
}
