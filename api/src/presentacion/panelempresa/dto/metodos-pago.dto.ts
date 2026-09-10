import { IsIn, IsBoolean, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import type { EntidadFinanciera } from '../../../dominio/panelempresa/panel-empresa.ports';

/**
 * Métodos de pago manuales (29-jul-2026) — mientras no hay pasarela
 * real conectada, cada cooperativa configura los que ya usa hoy en
 * Ecuador con sus propios datos para recibir el pago.
 */
export class GuardarMetodoPagoDto {
  @IsIn(['transferencia_bancaria', 'efectivo', 'deuna', 'payphone', 'tarjeta_pasarela'])
  tipo!: 'transferencia_bancaria' | 'efectivo' | 'deuna' | 'payphone' | 'tarjeta_pasarela';

  @IsObject()
  datosCuenta!: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  /**
   * Ítem 21/22 (06-ago-2026) -- catálogo cerrado, obligatorio solo
   * cuando tipo = 'transferencia_bancaria' (la regla real vive en el
   * service, no aquí -- el DTO solo valida la FORMA, no las reglas de
   * negocio que dependen de otro campo).
   */
  @IsOptional()
  @IsIn([
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
  ])
  entidadFinanciera?: EntidadFinanciera;
}

export class SubirComprobanteDto {
  @IsUUID()
  compraId!: string;
}

export class ConfirmarPagoManualDto {
  @IsOptional()
  @IsString()
  motivo?: string;
}

/** Solicitud de factura del pasaje (29-jul-2026) -- la cooperativa la marca emitida, con link opcional. */
export class MarcarFacturaEmitidaDto {
  @IsOptional()
  @IsString()
  urlFactura?: string;
}
