import { IsNumber, IsOptional, IsString, IsUrl, Matches, MaxLength, Min } from 'class-validator';

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
