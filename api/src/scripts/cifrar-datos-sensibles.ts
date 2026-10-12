import { Client } from 'pg';
import {
  CONTEXTO_DOCUMENTO_DISCAPACIDAD,
  CONTEXTO_NUMERO_CUENTA_COBRO,
  cifrarDato,
} from '../infraestructura/seguridad/datos-sensibles';

/**
 * Cifra los datos sensibles que se guardaron antes de existir el cifrado (12-oct-2026).
 *
 * Se ejecuta después de cada despliegue (ver .github/workflows/deploy.yml) y es seguro repetirlo:
 * solo toca los valores que todavía están en texto plano y no cifra dos veces. Mientras corre, la
 * aplicación ya lee los dos formatos, así que no hay que detener nada.
 *
 *   DATABASE_URL_MIGRACIONES=... TOTP_CIFRADO_CLAVE=... node dist/scripts/cifrar-datos-sensibles.js
 */
const COLUMNAS = [
  { tabla: 'cuentas_cobro_cooperativa', columna: 'numero_cuenta', contexto: CONTEXTO_NUMERO_CUENTA_COBRO },
  { tabla: 'pasajeros_compra', columna: 'numero_documento_discapacidad', contexto: CONTEXTO_DOCUMENTO_DISCAPACIDAD },
] as const;

const LOTE = 500;

/** Devuelve cuántos valores se cifraron en cada columna ("tabla.columna"). */
export async function cifrarDatosExistentes(pg: Client): Promise<Record<string, number>> {
  const resultado: Record<string, number> = {};
  for (const { tabla, columna, contexto } of COLUMNAS) {
    let total = 0;
    for (;;) {
      const pendientes = await pg.query<{ id: string; valor: string }>(
        `SELECT id, "${columna}" AS valor FROM "${tabla}"
         WHERE "${columna}" IS NOT NULL AND "${columna}" <> '' AND "${columna}" NOT LIKE 'enc:v1:%'
         LIMIT ${LOTE}`,
      );
      if (pendientes.rows.length === 0) break;
      await pg.query('BEGIN');
      try {
        for (const fila of pendientes.rows) {
          // El valor anterior va en la condición: si alguien lo cambió mientras tanto, no se pisa.
          const r = await pg.query(`UPDATE "${tabla}" SET "${columna}" = $1 WHERE id = $2 AND "${columna}" = $3`, [
            cifrarDato(fila.valor, contexto),
            fila.id,
            fila.valor,
          ]);
          total += r.rowCount ?? 0;
        }
        await pg.query('COMMIT');
      } catch (error) {
        await pg.query('ROLLBACK');
        throw error;
      }
    }
    resultado[`${tabla}.${columna}`] = total;
  }
  return resultado;
}

async function principal(): Promise<void> {
  // En el servidor la clave está en el .env de la API; si no existe el archivo, se usa el entorno.
  try {
    (process as unknown as { loadEnvFile?: (ruta?: string) => void }).loadEnvFile?.('.env');
  } catch {
    // sin .env: se sigue con las variables del entorno
  }
  const url = process.env.DATABASE_URL_MIGRACIONES ?? process.env.DATABASE_URL_PUBLICO;
  if (!url) throw new Error('Falta DATABASE_URL_MIGRACIONES (o DATABASE_URL_PUBLICO).');
  if (!process.env.TOTP_CIFRADO_CLAVE) throw new Error('Falta TOTP_CIFRADO_CLAVE: sin ella no se puede cifrar.');

  const pg = new Client({ connectionString: url });
  await pg.connect();
  try {
    const cifrados = await cifrarDatosExistentes(pg);
    for (const [columna, cantidad] of Object.entries(cifrados)) {
      console.log(`${columna}: ${cantidad} valor(es) cifrado(s)`);
    }
  } finally {
    await pg.end();
  }
}

if (require.main === module) {
  principal().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
