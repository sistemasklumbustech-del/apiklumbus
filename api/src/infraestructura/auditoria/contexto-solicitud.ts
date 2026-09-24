import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Datos de la solicitud HTTP en curso (RF-021, auditoría completa): la IP
 * real del cliente y su navegador. Se guardan en un AsyncLocalStorage que
 * llena un middleware (ver main.ts) para que cualquier punto donde se
 * registre una auditoría -- servicios, repositorios, transacciones -- los
 * pueda leer sin tener que pasar la IP como parámetro por todas las capas.
 *
 * Fuera de una solicitud HTTP (tareas programadas, pruebas) el almacén
 * está vacío y IP/navegador quedan en null.
 */
export interface ContextoSolicitud {
  ip?: string;
  userAgent?: string;
}

export const almacenContexto = new AsyncLocalStorage<ContextoSolicitud>();

export function ipActual(): string | null {
  return almacenContexto.getStore()?.ip?.slice(0, 45) ?? null;
}

export function userAgentActual(): string | null {
  return almacenContexto.getStore()?.userAgent?.slice(0, 300) ?? null;
}
