import * as Sentry from '@sentry/nestjs';

/**
 * Monitoreo de errores en producción (RF-OPS, 28-jul-2026).
 *
 * Antes de esto, si algo fallaba de verdad en producción, la única
 * forma de enterarse era que un cliente escribiera quejándose. Con
 * esto, cualquier error no controlado en el backend se reporta solo,
 * en tiempo real, sin que nadie tenga que estar mirando logs.
 *
 * Si SENTRY_DSN no está configurado (por ejemplo, en desarrollo local
 * o en pruebas), Sentry simplemente no envía nada — no rompe la app,
 * no hace falta desactivarlo a mano en ningún entorno.
 *
 * Este archivo se importa PRIMERO en main.ts, antes que cualquier otro
 * módulo — es un requisito de Sentry para poder instrumentar todo
 * correctamente.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  // 10% de las peticiones para métricas de rendimiento — suficiente
  // para detectar tendencias sin gastar la cuota gratuita de Sentry de
  // golpe. Se puede subir más adelante si hace falta más detalle.
  tracesSampleRate: 0.1,
});
