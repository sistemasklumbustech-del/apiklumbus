import { IsString, MinLength } from 'class-validator';

export class RestablecerPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  passwordNueva!: string;
}
