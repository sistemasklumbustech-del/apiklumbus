import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

const ESTADOS = ['abierto', 'en_revision', 'resuelto', 'rechazado'] as const;
const TIPOS = ['cobro_reembolso', 'servicio_viaje', 'boleto_qr'] as const;

/** El pasajero crea un reclamo sobre un boleto suyo. */
export class CrearReclamoDto {
  @IsUUID()
  boletoId!: string;

  @IsIn(TIPOS)
  tipo!: (typeof TIPOS)[number];

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  descripcion!: string;
}

/** "Mis reclamos" del pasajero, paginado. */
export class ConsultarMisReclamosDto {
  @IsOptional()
  @IsIn(ESTADOS)
  estado?: (typeof ESTADOS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite?: number;
}

/** Bandeja de reclamos de la cooperativa: filtros y paginación real. */
export class ConsultarReclamosCoopDto {
  @IsOptional()
  @IsIn(ESTADOS)
  estado?: (typeof ESTADOS)[number];

  @IsOptional()
  @IsIn(TIPOS)
  tipo?: (typeof TIPOS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  busqueda?: string;

  /** YYYY-MM-DD, hora de Ecuador. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'desde debe tener formato YYYY-MM-DD.',
  })
  desde?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'hasta debe tener formato YYYY-MM-DD.',
  })
  hasta?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;
}

/** La cooperativa resuelve: procede (a favor del pasajero) o no procede, siempre con respuesta. */
export class ResolverReclamoDto {
  @IsIn(['procede', 'no_procede'])
  decision!: 'procede' | 'no_procede';

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  respuesta!: string;

  /** Solo para reclamos de cobro/reembolso que proceden. Es informativo: la devolución es fuera del sistema. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  montoReconocido?: number;
}
