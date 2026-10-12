import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

/**
 * Archivos privados con enlaces firmados (12-oct-2026).
 *
 * Los comprobantes de pago tienen datos de personas (nombres, cuentas, montos) y hasta hoy se
 * guardaban en una carpeta pública: quien tuviera la URL los abría. Ahora:
 *  - se guardan fuera de la carpeta pública (`uploads-privados`);
 *  - en la base queda una referencia estable (`privado://comprobantes-pago/<uuid>.webp`), que
 *    no es una URL y no sirve para abrir nada;
 *  - al responder a quien YA tiene derecho a verlos (el comprador, la cooperativa dueña o un
 *    admin), la API cambia la referencia por un enlace firmado que vence a los 30 minutos;
 *  - cualquier otra cosa (sin firma, firma alterada, enlace vencido) recibe 403.
 *
 * No hay un permiso nuevo que calcular: el enlace se firma solo en las respuestas que ya
 * mostraban el comprobante a la persona correcta.
 */
export const CARPETAS_PRIVADAS = ['comprobantes-pago'] as const;
export const TTL_ENLACE_SEGUNDOS = 1800;

const PREFIJO = 'privado://';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const NOMBRE_VALIDO = new RegExp(`^${UUID}\\.(webp|pdf)$`);

/** Forma exacta de una referencia que el cliente puede mandar de vuelta (por ejemplo, en una venta de ventanilla). */
export const REFERENCIA_PRIVADA_VALIDA = new RegExp(`^privado:\\/\\/(${CARPETAS_PRIVADAS.join('|')})\\/${UUID}\\.(webp|pdf)$`);

export function carpetaPrivada(): string {
  return process.env.ARCHIVOS_PRIVADOS_DIR ?? join(process.cwd(), 'uploads-privados');
}

export function crearReferencia(carpeta: string, nombreArchivo: string): string {
  return `${PREFIJO}${carpeta}/${nombreArchivo}`;
}

export function esReferenciaPrivada(valor: string | null | undefined): valor is string {
  return typeof valor === 'string' && valor.startsWith(PREFIJO);
}

export function nombreDeArchivoPrivadoValido(carpeta: string, nombre: string): boolean {
  return (CARPETAS_PRIVADAS as readonly string[]).includes(carpeta) && NOMBRE_VALIDO.test(nombre);
}

export function leerReferencia(referencia: string): { carpeta: string; nombre: string } | null {
  if (!REFERENCIA_PRIVADA_VALIDA.test(referencia)) return null;
  const [carpeta, nombre] = referencia.slice(PREFIJO.length).split('/');
  return { carpeta, nombre };
}

function clave(): Buffer {
  const maestra = process.env.JWT_SECRET;
  if (!maestra) throw new Error('Falta JWT_SECRET: sin ella no se pueden firmar los enlaces de archivos privados.');
  return Buffer.from(hkdfSync('sha256', maestra, 'klumbus-archivos-privados', 'enlaces-firmados-v1', 32));
}

function firmar(carpeta: string, nombre: string, vence: number): string {
  return createHmac('sha256', clave()).update(`${carpeta}/${nombre}.${vence}`).digest('hex');
}

function baseDeLaApi(): string {
  return (process.env.URL_API_PUBLICA ?? 'https://api.klumbus.tech').replace(/\/$/, '');
}

/** Enlace firmado y temporal para una referencia privada. */
export function urlFirmada(referencia: string, ahoraSegundos: number = Math.floor(Date.now() / 1000)): string {
  const partes = leerReferencia(referencia);
  if (!partes) throw new Error('Referencia de archivo privado inválida.');
  const vence = ahoraSegundos + TTL_ENLACE_SEGUNDOS;
  return `${baseDeLaApi()}/archivos-privados/${partes.carpeta}/${partes.nombre}?vence=${vence}&firma=${firmar(partes.carpeta, partes.nombre, vence)}`;
}

/**
 * Lo que se le muestra a quien consulta: si lo guardado es una referencia privada, un enlace
 * firmado; si es una URL de antes de este cambio, se devuelve igual. Nunca lanza: un valor raro
 * se muestra como vacío en vez de romper un listado entero.
 */
export function aUrlVisible(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  if (!esReferenciaPrivada(valor)) return valor;
  try {
    return urlFirmada(valor);
  } catch {
    return null;
  }
}

export type ResultadoEnlace = 'valido' | 'vencido' | 'invalido';

export function verificarEnlace(
  carpeta: string,
  nombre: string,
  vence: string | undefined,
  firma: string | undefined,
  ahoraSegundos: number = Math.floor(Date.now() / 1000),
): ResultadoEnlace {
  if (!nombreDeArchivoPrivadoValido(carpeta, nombre) || !vence || !firma || !/^\d{1,12}$/.test(vence)) return 'invalido';
  const esperada = Buffer.from(firmar(carpeta, nombre, Number(vence)));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return 'invalido';
  return Number(vence) < ahoraSegundos ? 'vencido' : 'valido';
}
