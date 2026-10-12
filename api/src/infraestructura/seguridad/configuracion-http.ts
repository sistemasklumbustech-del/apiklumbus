import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * Seguridad HTTP de la API (12-oct-2026): cabeceras de seguridad y CORS con lista de orígenes.
 *
 * Antes el CORS reflejaba cualquier origen con credenciales y la API no enviaba ninguna cabecera
 * de seguridad (ni HSTS, ni X-Content-Type-Options, etc.).
 */

/** Sitio web de Klumbus. Orígenes extra (por ejemplo una vista previa) se agregan con CORS_ORIGENES, separados por coma. */
const ORIGENES_POR_DEFECTO = ['https://klumbustech.com', 'https://www.klumbustech.com'];

const ORIGEN_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

type Entorno = Record<string, string | undefined>;

export function origenesPermitidos(env: Entorno = process.env): string[] {
  const extra = (env.CORS_ORIGENES ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter((o) => o !== '');
  return [...ORIGENES_POR_DEFECTO, ...extra];
}

/**
 * Las peticiones sin cabecera Origin (la app móvil, los sistemas de las cooperativas por la API
 * externa, curl) no son del navegador y CORS no aplica: se dejan pasar. Un navegador siempre
 * manda Origin, y solo se acepta el de la lista (más localhost fuera de producción).
 */
export function origenPermitido(origen: string | undefined, env: Entorno = process.env): boolean {
  if (!origen) return true;
  if (origenesPermitidos(env).includes(origen)) return true;
  return env.NODE_ENV !== 'production' && ORIGEN_LOCAL.test(origen);
}

export function aplicarSeguridadHttp(app: NestExpressApplication): void {
  app.use(
    helmet({
      // La API solo entrega JSON y archivos: no debe poder cargar ni ser incrustada en nada.
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      // 180 días. Sin includeSubDomains: no se conoce el estado de HTTPS de otros subdominios.
      strictTransportSecurity: { maxAge: 15_552_000, includeSubDomains: false },
      // El sitio web (otro origen) muestra las imágenes de /uploads: el valor por defecto
      // ("same-origin") las rompería.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.enableCors({
    origin: (origen: string | undefined, devolver: (error: Error | null, permitido?: boolean) => void) =>
      devolver(null, origenPermitido(origen)),
    credentials: true,
  });
}
