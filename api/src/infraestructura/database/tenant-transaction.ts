import { sql } from 'drizzle-orm';
import type { DrizzleDb } from './database.provider';

/**
 * Ejecuta `fn` dentro de una transacción con
 * `app.current_cooperativa_id` seteado SOLO para esa transacción
 * (`set_config(..., true)` — el tercer argumento `true` es el
 * equivalente parametrizado de `SET LOCAL`, no `SET`).
 *
 * Por qué esto importa y no basta con un `SET` simple: node-postgres
 * reutiliza conexiones físicas entre distintas requests HTTP a través de
 * un pool. Si se hiciera un `SET app.current_cooperativa_id = 'X'` normal
 * (sin LOCAL) sobre una conexión del pool y esa conexión se devolviera
 * sin resetear la variable, la SIGUIENTE request que reutilice esa misma
 * conexión física heredaría por accidente el `cooperativa_id` de la
 * request anterior — una fuga de aislamiento multi-tenant real, no
 * teórica. `SET LOCAL` (vía `set_config(..., true)`) se descarta
 * automáticamente al hacer COMMIT o ROLLBACK de la transacción, así que
 * es imposible que sobreviva más allá de esta función.
 *
 * Se usa `set_config()` en vez de `SET LOCAL app.x = 'valor'` directo
 * porque `SET` no acepta parámetros bindeados de forma seria — armar esa
 * sentencia por concatenación de texto sería una vía de inyección SQL.
 * `set_config()` es una función normal de Postgres y sí acepta
 * parámetros bindeados como cualquier otra.
 */
export async function ejecutarComoCooperativa<T>(
  db: DrizzleDb,
  cooperativaId: string,
  fn: (tx: DrizzleDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_cooperativa_id', ${cooperativaId}, true)`,
    );
    return fn(tx);
  });
}
