import { IsObject } from 'class-validator';

/** Solicitud de factura del pasaje (29-jul-2026) -- puente con la cooperativa. */
export class SolicitarFacturaDto {
  @IsObject()
  datosTributarios!: Record<string, string>;
}
