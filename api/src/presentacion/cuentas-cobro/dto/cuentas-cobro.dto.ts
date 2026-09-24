import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ENTIDADES = [
  'banco_pichincha',
  'banco_guayaquil',
  'banco_pacifico',
  'produbanco',
  'banco_bolivariano',
  'banco_internacional',
  'diners_club',
  'banco_ruminahui',
  'coop_jep',
  'coop_jardin_azuayo',
  'otro',
] as const;

export class RegistrarCuentaCobroDto {
  @IsIn(ENTIDADES)
  entidadFinanciera!: (typeof ENTIDADES)[number];

  @IsIn(['ahorros', 'corriente'])
  tipoCuenta!: 'ahorros' | 'corriente';

  @IsString()
  @Matches(/^[\d\s-]{6,34}$/, {
    message: 'El número de cuenta solo lleva dígitos.',
  })
  numeroCuenta!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(150)
  titularNombre!: string;

  @IsIn(['cedula', 'ruc'])
  titularTipoIdentificacion!: 'cedula' | 'ruc';

  @IsString()
  @MaxLength(13)
  titularIdentificacion!: string;

  @IsEmail()
  @MaxLength(150)
  correoNotificacion!: string;
}

export class ConsultarCuentasCobroDto {
  @IsOptional()
  @IsIn(['pendiente_verificacion', 'verificada', 'rechazada'])
  estado?: 'pendiente_verificacion' | 'verificada' | 'rechazada';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  busqueda?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limite?: number;
}

export class RechazarCuentaCobroDto {
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  motivo!: string;
}
