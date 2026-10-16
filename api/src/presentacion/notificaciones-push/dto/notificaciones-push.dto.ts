import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class RegistrarDispositivoDto {
  /** Token de Expo (`ExponentPushToken[...]`); el servicio valida el formato. */
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  @IsIn(['android', 'ios'])
  plataforma!: 'android' | 'ios';
}

export class BajaDispositivoDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}
