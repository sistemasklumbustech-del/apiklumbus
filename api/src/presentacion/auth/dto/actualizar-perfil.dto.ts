import { IsOptional, IsString, MinLength, Matches } from 'class-validator';

/** Perfil de usuario (22-jul-2026). Todos opcionales — solo se actualiza lo que se envía. */
export class ActualizarPerfilDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'El nombre completo es demasiado corto.' })
  nombreCompleto?: string;

  /** 29-jul-2026 -- misma validación que en el registro: exactamente 10 dígitos. */
  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'El WhatsApp debe tener exactamente 10 dígitos.' })
  telefono?: string;

  @IsOptional()
  @IsString()
  fotoUrl?: string;
}
