import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ActualizarPrecioViajeDto {
  @IsNumber()
  @Min(0)
  precioBase!: number;
}

/**
 * Confirmación de una venta (07-oct-2026): el sistema propio de la cooperativa
 * reporta la factura que emitió y el código de tasa que obtuvo del SIAT 3000
 * para una compra hecha en Klumbus. Con eso Klumbus completa la compra y puede
 * mostrarle al pasajero su QR del terminal.
 */
export class ConfirmarVentaDto {
  /** Secuencial de la factura (9 dígitos), el mismo que se envió al SIAT 3000. */
  @Matches(/^\d{9}$/, { message: 'numeroFactura debe tener 9 dígitos.' })
  numeroFactura!: string;

  @IsOptional()
  @Matches(/^\d{49}$/, { message: 'claveAcceso debe tener 49 dígitos.' })
  claveAcceso?: string;

  @IsOptional()
  @IsString()
  @MaxLength(49)
  numeroAutorizacion?: string;

  /** Enlace al PDF o RIDE de la factura, si el sistema de la cooperativa lo publica. */
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  urlFactura?: string;

  /** Código de tasa del SIAT 3000 (20 dígitos): es el contenido del QR del torniquete. */
  @Matches(/^\d{20}$/, { message: 'codigoTasa debe tener 20 dígitos.' })
  codigoTasa!: string;
}

/**
 * Crear o actualizar un viaje desde el sistema de la cooperativa (07-oct-2026).
 * El identificador del viaje en SU sistema va en la ruta (`PUT /viajes/:referencia`),
 * así que enviar lo mismo dos veces no duplica nada.
 */
export class GuardarViajeDto {
  @IsUUID()
  rutaId!: string;

  @IsUUID()
  unidadId!: string;

  /** ISO 8601 con zona horaria, por ejemplo 2026-12-01T08:00:00-05:00. */
  @IsISO8601({ strict: true })
  horaSalidaProgramada!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  horaLlegadaEstimada?: string;

  @IsNumber()
  @Min(0)
  precioBase!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  recargoVip?: number;
}

export class AsientoOcupadoDto {
  @IsString()
  @MaxLength(10)
  numero!: string;

  /** Boleto o venta de la cooperativa que ocupa el asiento (para reconciliar). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referencia?: string;
}

export class OcuparAsientosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => AsientoOcupadoDto)
  asientos!: AsientoOcupadoDto[];
}

export class LiberarAsientosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(10, { each: true })
  asientos!: string[];
}
