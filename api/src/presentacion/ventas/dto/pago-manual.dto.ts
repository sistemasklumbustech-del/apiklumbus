import { IsArray, IsIn, ValidateNested, ArrayMinSize, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { PasajeroCheckoutDto } from './crear-compra.dto';

/** Métodos de pago manuales (29-jul-2026) — mientras no hay pasarela real conectada. */
export class IniciarPagoManualDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PasajeroCheckoutDto)
  pasajeros!: PasajeroCheckoutDto[];

  @IsIn(['transferencia_bancaria', 'efectivo', 'deuna', 'payphone'])
  tipoMetodoPago!: 'transferencia_bancaria' | 'efectivo' | 'deuna' | 'payphone';

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
