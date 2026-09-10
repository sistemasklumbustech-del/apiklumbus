import { IsEmail, IsString, MinLength } from 'class-validator';

/** Cambio de correo (29-jul-2026, hallazgo real del usuario). */
export class SolicitarCambioCorreoDto {
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  correoNuevo!: string;

  @IsString()
  @MinLength(1, { message: 'Debes indicar tu contraseña actual.' })
  passwordActual!: string;
}

export class ConfirmarCambioCorreoDto {
  @IsString()
  token!: string;
}
