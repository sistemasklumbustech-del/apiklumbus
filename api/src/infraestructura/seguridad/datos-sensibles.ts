import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Cifrado de datos sensibles en la base (12-oct-2026): AES-256-GCM a nivel de columna.
 *
 * Protege estos datos si alguien consigue una copia de la base o un respaldo: sin la clave del
 * servidor, solo ve texto cifrado. Hoy se usa para:
 *  - el número de cuenta de cobro de una cooperativa (`cuentas_cobro_cooperativa.numero_cuenta`);
 *  - el número de documento de discapacidad de un pasajero (`pasajeros_compra.numero_documento_discapacidad`),
 *    que es un dato de salud.
 *
 * Formato guardado: `enc:v1:` + base64(iv 12 bytes | etiqueta 16 bytes | texto cifrado).
 *
 * - La clave sale de `TOTP_CIFRADO_CLAVE` (la misma variable que ya exige el 2FA, así que no hace
 *   falta configurar nada nuevo en el servidor), pero se deriva con HKDF para esta finalidad: no es
 *   la misma clave que cifra los secretos del 2FA ni los de los webhooks.
 * - El "contexto" (qué columna es) va como dato autenticado: un valor cifrado en una columna no se
 *   puede copiar a otra y que descifre bien.
 * - `v1` deja lugar a rotar la clave más adelante.
 * - Un valor sin el prefijo se devuelve tal cual al leer: son datos guardados antes de esta función,
 *   que el script `cifrar-datos-sensibles` cifra después del despliegue. Así no hay que parar nada.
 */
const PREFIJO = 'enc:v1:';
const LARGO_IV = 12;
const LARGO_ETIQUETA = 16;

export const CONTEXTO_NUMERO_CUENTA_COBRO = 'cuentas_cobro_cooperativa.numero_cuenta';
export const CONTEXTO_DOCUMENTO_DISCAPACIDAD = 'pasajeros_compra.numero_documento_discapacidad';

function obtenerClave(): Buffer {
  const maestra = process.env.TOTP_CIFRADO_CLAVE;
  if (!maestra) {
    throw new Error(
      'Falta la variable de entorno TOTP_CIFRADO_CLAVE: sin ella no se pueden cifrar ni leer los datos sensibles.',
    );
  }
  return Buffer.from(hkdfSync('sha256', maestra, 'klumbus-datos-sensibles', 'cifrado-de-columnas-v1', 32));
}

export function estaCifrado(valor: string): boolean {
  return valor.startsWith(PREFIJO);
}

/** Cifra un texto. Si ya está cifrado, lo devuelve igual (no se cifra dos veces). */
export function cifrarDato(texto: string, contexto: string): string {
  if (estaCifrado(texto)) return texto;
  const iv = randomBytes(LARGO_IV);
  const cifrador = createCipheriv('aes-256-gcm', obtenerClave(), iv);
  cifrador.setAAD(Buffer.from(contexto, 'utf8'));
  const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  return PREFIJO + Buffer.concat([iv, cifrador.getAuthTag(), cifrado]).toString('base64');
}

/**
 * Descifra un valor guardado. Uno sin prefijo es un dato anterior al cifrado y se devuelve tal cual.
 * Si el valor fue alterado o pertenece a otro contexto, lanza un error en vez de devolver basura.
 */
export function descifrarDato(valor: string, contexto: string): string {
  if (!estaCifrado(valor)) return valor;
  const bytes = Buffer.from(valor.slice(PREFIJO.length), 'base64');
  const iv = bytes.subarray(0, LARGO_IV);
  const etiqueta = bytes.subarray(LARGO_IV, LARGO_IV + LARGO_ETIQUETA);
  const cifrado = bytes.subarray(LARGO_IV + LARGO_ETIQUETA);
  const descifrador = createDecipheriv('aes-256-gcm', obtenerClave(), iv);
  descifrador.setAAD(Buffer.from(contexto, 'utf8'));
  descifrador.setAuthTag(etiqueta);
  return Buffer.concat([descifrador.update(cifrado), descifrador.final()]).toString('utf8');
}

/** Versiones tolerantes a null, para columnas opcionales. */
export const cifrarDatoOpcional = (texto: string | null | undefined, contexto: string): string | null =>
  texto === null || texto === undefined || texto === '' ? (texto ?? null) : cifrarDato(texto, contexto);

export const descifrarDatoOpcional = (valor: string | null | undefined, contexto: string): string | null =>
  valor === null || valor === undefined || valor === '' ? (valor ?? null) : descifrarDato(valor, contexto);
