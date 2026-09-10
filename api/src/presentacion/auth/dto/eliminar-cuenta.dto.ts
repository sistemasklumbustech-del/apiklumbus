import { IsOptional, IsString } from 'class-validator';

/**
 * Ítem 17, Fase 3 (05-ago-2026) -- ambos opcionales a nivel de
 * validación de forma porque cuál se exige depende de si la cuenta
 * tiene contraseña o no (login externo) -- esa decisión la toma el
 * service, que sí conoce el usuario real.
 */
export class EliminarCuentaDto {
  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  frase?: string;
}
