import { ArgumentsHost, BadRequestException, Catch, Logger } from '@nestjs/common';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { DrizzleQueryError } from 'drizzle-orm';

/**
 * Códigos de error de Postgres que significan "el dato que mandó el cliente no tiene el formato
 * de la columna", no "falló el servidor":
 *  - 22P02: texto inválido para el tipo (un id que no es UUID, un valor que no existe en un enum, un número mal escrito)
 *  - 22007 / 22008: fecha u hora inválida
 */
const CODIGOS_DE_FORMATO_INVALIDO = new Set(['22P02', '22007', '22008']);

export function esErrorDeFormato(excepcion: unknown): boolean {
  if (!(excepcion instanceof DrizzleQueryError)) return false;
  const codigo = (excepcion.cause as { code?: string } | undefined)?.code;
  return codigo !== undefined && CODIGOS_DE_FORMATO_INVALIDO.has(codigo);
}

/**
 * Filtro global de excepciones (12-oct-2026). Es el filtro de Sentry de siempre con una excepción:
 * un dato mal formado que llega hasta la base (por ejemplo `/viajes/abc/paradas`) se responde 400,
 * como corresponde, en vez de 500. Un 500 daba a entender que el servidor falló, llenaba Sentry de
 * avisos falsos y escondía los errores reales. Cualquier otro error sigue igual: 500 y a Sentry.
 *
 * El caso se deja en el log como aviso para que no pase inadvertido si un día es un bug nuestro.
 */
@Catch()
export class FiltroExcepciones extends SentryGlobalFilter {
  private readonly bitacora = new Logger('FormatoInvalido');

  override catch(excepcion: unknown, host: ArgumentsHost): void {
    if (esErrorDeFormato(excepcion)) {
      const peticion = host.switchToHttp().getRequest<{ method?: string; url?: string }>();
      this.bitacora.warn(`${peticion.method ?? ''} ${peticion.url ?? ''}: ${(excepcion as DrizzleQueryError).cause?.message ?? ''}`);
      return super.catch(new BadRequestException('Uno de los datos enviados no tiene un formato válido.'), host);
    }
    return super.catch(excepcion, host);
  }
}
