import { IsString, MinLength } from 'class-validator';

import { ContrasenaNoComun } from '../validadores/contrasena-no-comun';
export class CambiarPasswordDto {
  @IsString()
  passwordActual!: string;

  @IsString()
  @MinLength(8, {
    message: 'La nueva contraseña debe tener al menos 8 caracteres.',
  })
  @ContrasenaNoComun()
  passwordNueva!: string;
}
