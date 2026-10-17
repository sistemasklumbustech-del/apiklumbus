import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Inicio de sesión con Google o Apple desde la app: el token de identidad que entregó el proveedor. */
export class LoginSocialDto {
  @IsIn(['google', 'apple'])
  proveedor!: 'google' | 'apple';

  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  idToken!: string;

  /** Valor aleatorio que la app mandó al proveedor; evita reusar un token de otro intento. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nonce?: string;

  /** Apple solo entrega el nombre la primera vez y fuera del token, así que lo manda la app. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nombre?: string;

  /** Solo se exige al crear una cuenta nueva (el mensaje real lo da TerminosService). */
  @IsOptional()
  @IsBoolean()
  aceptoTerminos?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  codigoReferido?: string;
}
