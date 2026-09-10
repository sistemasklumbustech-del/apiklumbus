import { IsString, Length, MinLength } from 'class-validator';

/**
 * Ítem 19, Fase 3 (05-ago-2026) -- usado en 2 endpoints: confirmar la
 * configuración inicial de 2FA, y verificar el código en un login
 * normal (cuando 2FA ya está activo). Mismo formato exacto en ambos
 * casos -- código TOTP de 6 dígitos.
 */
export class Codigo2faDto {
  @IsString()
  @MinLength(1)
  tokenTemporal!: string;

  @IsString()
  @Length(6, 6)
  codigo!: string;
}
