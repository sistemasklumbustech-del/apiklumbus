import { IsOptional, IsString, Length } from 'class-validator';

/**
 * Ítem 6, Fase 2 (03-ago-2026). El límite de frecuencia (90 días) se
 * valida en el service, no aquí -- este DTO solo valida forma, no
 * reglas de negocio (Arquitectura Técnica, sección 2.1).
 */
export class ActualizarIdentidadDto {
  @IsOptional()
  @IsString()
  @Length(3, 200)
  nombreCompleto?: string;

  @IsOptional()
  @IsString()
  @Length(5, 20)
  cedula?: string;
}
