import { IsString, MinLength } from 'class-validator';

/** Ítem 19, Fase 3 (05-ago-2026) -- paso 1: solo el token temporal, sin código todavía. */
export class TokenTemporal2faDto {
  @IsString()
  @MinLength(1)
  tokenTemporal!: string;
}
