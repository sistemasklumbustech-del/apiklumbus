import { IsString, MinLength } from 'class-validator';

import { ContrasenaNoComun } from '../validadores/contrasena-no-comun';
export class RestablecerPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  @ContrasenaNoComun()
  passwordNueva!: string;
}
