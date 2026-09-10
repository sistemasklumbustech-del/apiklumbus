/**
 * Conexión real a Postgres, usando el esquema compartido de
 * @columbus/db. Este es el único lugar del backend que debería
 * instanciar el cliente de Drizzle directamente (Arquitectura Técnica
 * 4.3): el resto del backend debe recibir este cliente por inyección de
 * dependencias (ver DatabaseModule), nunca crear su propia conexión.
 */
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@columbus/db';

export type DrizzleDb = NodePgDatabase<typeof schema>;

export function crearConexionBaseDeDatos(connectionString: string): {
  db: DrizzleDb;
  pool: Pool;
} {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
