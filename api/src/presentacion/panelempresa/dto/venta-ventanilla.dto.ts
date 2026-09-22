import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PasajeroCheckoutDto } from '../../ventas/dto/crear-compra.dto';

/** RF-003 -- desglose real antes de vender, sin crear ninguna compra. */
export class CotizarVentanillaDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PasajeroCheckoutDto)
  pasajeros!: PasajeroCheckoutDto[];
}

/**
 * Venta presencial en ventanilla (17-sep-2026) -- el vendedor ya
 * bloqueó el/los asiento(s) con su propia cuenta (mismo endpoint que
 * usa cualquier pasajero) antes de llamar esto. Confirma al instante,
 * sin paso de comprobante -- el vendedor ya tiene el dinero en mano.
 */
export class VenderEnVentanillaDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PasajeroCheckoutDto)
  pasajeros!: PasajeroCheckoutDto[];

  @IsIn(['efectivo', 'tarjeta_fisica', 'transferencia_bancaria'])
  tipoMetodoPago!: 'efectivo' | 'tarjeta_fisica' | 'transferencia_bancaria';

  /** Opcional -- solo si el cliente quiere recibir también su boleto por correo/WhatsApp. */
  @IsOptional()
  @IsString()
  @Matches(/^09\d{8}$/, { message: 'El telefono debe ser un numero movil ecuatoriano valido (10 digitos, empieza con 09).' })
  telefonoContacto?: string;

  @IsOptional()
  @IsString()
  correoContacto?: string;

  /** Respaldo opcional para "transferencia" (22-sep-2026) -- nunca bloquea la venta, ver comentario en checkout.service.ts. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenciaTransferencia?: string;

  /** URL ya subida vía POST /coop/ventanilla/comprobante. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comprobanteUrl?: string;
}
