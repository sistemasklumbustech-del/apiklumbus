import { Client } from 'pg';
import { copyFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CARPETAS_PRIVADAS,
  carpetaPrivada,
  crearReferencia,
  nombreDeArchivoPrivadoValido,
} from '../infraestructura/seguridad/archivos-privados';

/**
 * Pasa a la carpeta privada los comprobantes que se subieron cuando eran públicos (12-oct-2026).
 *
 * Para cada archivo de `uploads/comprobantes-pago`:
 *   1. lo mueve a `uploads-privados/comprobantes-pago` (y deja de ser público);
 *   2. cambia en `pagos.comprobante_url` la URL pública por la referencia privada.
 *
 * Se ejecuta después de cada despliegue y es seguro repetirlo: si una corrida se corta entre el
 * paso 1 y el 2, la siguiente termina el trabajo. No toca nada que ya sea privado.
 *
 *   DATABASE_URL_MIGRACIONES=... node dist/scripts/migrar-archivos-privados.js
 */
export interface ResultadoMigracion {
  archivosMovidos: number;
  referenciasActualizadas: number;
}

type Consulta = Pick<Client, 'query'>;

async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}

async function mover(origen: string, destino: string): Promise<void> {
  // Copiar y borrar en vez de renombrar: la carpeta privada puede estar en otro disco.
  await copyFile(origen, destino);
  await unlink(origen);
}

export async function migrarArchivosPrivados(
  pg: Consulta,
  carpetaPublica: string = join(process.cwd(), 'uploads'),
  carpetaDestino: string = carpetaPrivada(),
): Promise<ResultadoMigracion> {
  const resultado: ResultadoMigracion = { archivosMovidos: 0, referenciasActualizadas: 0 };

  for (const carpeta of CARPETAS_PRIVADAS) {
    const origen = join(carpetaPublica, carpeta);
    const destino = join(carpetaDestino, carpeta);
    await mkdir(destino, { recursive: true });

    // 1. Mover lo que todavía está en la carpeta pública.
    let nombres: string[] = [];
    try {
      nombres = await readdir(origen);
    } catch {
      // la carpeta pública no existe: no hay nada que mover
    }
    for (const nombre of nombres.filter((n) => nombreDeArchivoPrivadoValido(carpeta, n))) {
      await mover(join(origen, nombre), join(destino, nombre));
      resultado.archivosMovidos += 1;
    }

    // 2. Cambiar las URLs públicas por la referencia, de todo archivo que ya esté en la carpeta privada
    //    (incluye lo que una corrida anterior movió pero no alcanzó a actualizar en la base).
    const filas = await pg.query<{ id: string; comprobante_url: string }>(
      `SELECT id, comprobante_url FROM pagos WHERE comprobante_url LIKE $1`,
      [`%/uploads/${carpeta}/%`],
    );
    for (const fila of filas.rows) {
      const nombre = fila.comprobante_url.split('/').pop() ?? '';
      if (!nombreDeArchivoPrivadoValido(carpeta, nombre) || !(await existe(join(destino, nombre)))) continue;
      const r = await pg.query(`UPDATE pagos SET comprobante_url = $1 WHERE id = $2 AND comprobante_url = $3`, [
        crearReferencia(carpeta, nombre),
        fila.id,
        fila.comprobante_url,
      ]);
      resultado.referenciasActualizadas += r.rowCount ?? 0;
    }
  }
  return resultado;
}

async function principal(): Promise<void> {
  try {
    (process as unknown as { loadEnvFile?: (ruta?: string) => void }).loadEnvFile?.('.env');
  } catch {
    // sin .env: se sigue con las variables del entorno
  }
  const url = process.env.DATABASE_URL_MIGRACIONES ?? process.env.DATABASE_URL_PUBLICO;
  if (!url) throw new Error('Falta DATABASE_URL_MIGRACIONES (o DATABASE_URL_PUBLICO).');

  const pg = new Client({ connectionString: url });
  await pg.connect();
  try {
    const r = await migrarArchivosPrivados(pg);
    console.log(`Archivos movidos a la carpeta privada: ${r.archivosMovidos}`);
    console.log(`Referencias actualizadas en la base: ${r.referenciasActualizadas}`);
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
