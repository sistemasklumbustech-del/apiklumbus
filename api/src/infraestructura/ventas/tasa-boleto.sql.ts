import { sql, type SQL } from 'drizzle-orm';
import type { EstadoTasaBoleto } from '../../dominio/ventas/ventas.ports';

/**
 * Código de tasa del terminal (SIAT 3000) de un boleto, para mostrarlo al pasajero
 * (07-oct-2026). La tasa es una por compra y por cooperativa, no por pasajero: todos
 * los boletos de esa cooperativa en la compra comparten el mismo código, que es el
 * contenido del QR del torniquete del andén.
 *
 * Son dos subconsultas para usar dentro de un `select` de Drizzle. Hay que ejecutarlas
 * con la conexión que ve todas las cooperativas (la del pasajero no tiene permiso de
 * lectura sobre esas tablas por cooperativa).
 */
export function tasaDeBoleto(compraId: SQL | unknown, cooperativaId: SQL | unknown) {
  return {
    codigoTasa: sql<string | null>`(
      SELECT rt.codigo_tasa FROM registros_tasa_terminal rt
      WHERE rt.compra_id = ${compraId} AND rt.cooperativa_id = ${cooperativaId} AND rt.estado = 'exitosa'
      LIMIT 1
    )`,
    estadosTareasTasa: sql<string | null>`(
      SELECT string_agg(t.estado::text, ',') FROM tareas_postpago t
      WHERE t.compra_id = ${compraId} AND t.cooperativa_id = ${cooperativaId}
        AND t.tipo IN ('registro_tasa', 'confirmacion_cooperativa')
    )`,
  };
}

/**
 * - lista: ya hay código y se puede mostrar el QR.
 * - en_proceso: se está generando (o esperando a la cooperativa).
 * - en_revision: la tarea agotó sus intentos y una persona la está revisando.
 * - no_aplica: esa cooperativa no usa este flujo; no hay nada que esperar.
 */
export function resolverEstadoTasa(codigoTasa: string | null, estadosTareas: string | null): EstadoTasaBoleto {
  if (codigoTasa) return 'lista';
  if (!estadosTareas) return 'no_aplica';
  return estadosTareas.split(',').includes('agotada') ? 'en_revision' : 'en_proceso';
}
