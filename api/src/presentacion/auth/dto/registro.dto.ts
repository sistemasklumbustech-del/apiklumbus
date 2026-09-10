import { IsEmail, IsString, MinLength, IsOptional, Matches } from 'class-validator';

/**
 * Validación real de registro (29-jul-2026, hallazgo del usuario):
 * antes `nombreCompleto` era un solo campo libre, y `cedula`/`telefono`
 * aceptaban cualquier texto sin validar cantidad de dígitos.
 *
 * - Cédula ecuatoriana: exactamente 10 dígitos numéricos.
 * - WhatsApp/celular: exactamente 10 dígitos numéricos (formato móvil
 *   ecuatoriano, ej. 0991234567).
 */
export class RegistroDto {
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  correo!: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  password!: string;

  @IsString()
  @MinLength(2, { message: 'El nombre es demasiado corto.' })
  nombres!: string;

  @IsString()
  @MinLength(2, { message: 'El apellido es demasiado corto.' })
  apellidos!: string;

  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'La cédula debe tener exactamente 10 dígitos.' })
  cedula?: string;

  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'El WhatsApp debe tener exactamente 10 dígitos.' })
  telefono?: string;

  /**
   * Programa de referidos "Invita y Gana" (13-ago-2026) -- reutiliza
   * el código de pasajero existente (`COL-XXXXXX`) como código de
   * referido, no crea un sistema de códigos aparte.
   */
  @IsOptional()
  @IsString()
  codigoReferido?: string;
}
