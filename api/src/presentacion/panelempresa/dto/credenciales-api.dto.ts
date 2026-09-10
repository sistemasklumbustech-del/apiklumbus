import { IsOptional, IsUrl, IsString } from 'class-validator';

/**
 * Credenciales API — Modelo B (02-ago-2026). webhookUrl es opcional al
 * crear -- una cooperativa puede generar su credencial antes de tener
 * listo su endpoint receptor, y configurarlo después.
 */
export class CrearCredencialApiDto {
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'webhookUrl debe ser una URL válida.' })
  webhookUrl?: string;
}

export class ActualizarWebhookCredencialApiDto {
  // Se acepta cadena vacía a propósito (mismo patrón que ActualizarPerfilDto
  // con logoUrl) -- el controller la convierte a null para "quitar el webhook".
  @IsOptional()
  @IsString()
  webhookUrl?: string;
}
