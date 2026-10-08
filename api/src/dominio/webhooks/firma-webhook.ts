import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Firma de los webhooks de Klumbus (07-oct-2026).
 *
 * Cada envío lleva tres cabeceras:
 *   X-Klumbus-Event-Id   identificador único del evento (el mismo en los reintentos)
 *   X-Klumbus-Timestamp  segundos desde 1970, al momento de enviar
 *   X-Klumbus-Signature  "v1=" + HMAC-SHA256(secreto, `${timestamp}.${cuerpo}`) en hexadecimal
 *
 * El `cuerpo` es el texto JSON exacto que se recibió, sin reformatear. Incluir
 * el timestamp en lo firmado impide reutilizar un envío antiguo (replay): quien
 * recibe rechaza los que tengan más de unos minutos de diferencia.
 */
export const CABECERA_EVENTO_ID = 'X-Klumbus-Event-Id';
export const CABECERA_TIMESTAMP = 'X-Klumbus-Timestamp';
export const CABECERA_FIRMA = 'X-Klumbus-Signature';
export const TOLERANCIA_SEGUNDOS_POR_DEFECTO = 300;

const PREFIJO_SECRETO = 'whsec_';

export function generarSecretoWebhook(): string {
  return `${PREFIJO_SECRETO}${randomBytes(24).toString('hex')}`;
}

export function firmarWebhook(secreto: string, timestampSegundos: number, cuerpo: string): string {
  const hmac = createHmac('sha256', secreto).update(`${timestampSegundos}.${cuerpo}`).digest('hex');
  return `v1=${hmac}`;
}

export type ResultadoVerificacion = 'valida' | 'firma_invalida' | 'timestamp_fuera_de_rango' | 'cabeceras_faltantes';

/**
 * Lo que debe hacer quien recibe el webhook. Está aquí para que el equipo de
 * Klumbus y las pruebas usen exactamente la misma regla que se documenta.
 */
export function verificarFirmaWebhook(
  secreto: string,
  cabeceras: { timestamp?: string; firma?: string },
  cuerpo: string,
  opciones: { toleranciaSegundos?: number; ahoraSegundos?: number } = {},
): ResultadoVerificacion {
  if (!cabeceras.timestamp || !cabeceras.firma) return 'cabeceras_faltantes';
  const timestamp = Number(cabeceras.timestamp);
  if (!Number.isInteger(timestamp)) return 'firma_invalida';

  const ahora = opciones.ahoraSegundos ?? Math.floor(Date.now() / 1000);
  const tolerancia = opciones.toleranciaSegundos ?? TOLERANCIA_SEGUNDOS_POR_DEFECTO;
  if (Math.abs(ahora - timestamp) > tolerancia) return 'timestamp_fuera_de_rango';

  const esperada = Buffer.from(firmarWebhook(secreto, timestamp, cuerpo));
  const recibida = Buffer.from(cabeceras.firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return 'firma_invalida';
  return 'valida';
}
