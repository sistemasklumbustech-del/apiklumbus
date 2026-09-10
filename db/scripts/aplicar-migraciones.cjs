#!/usr/bin/env node
/**
 * Aplicador automático de migraciones — reemplaza el proceso manual
 * (`psql -f archivo.sql`, uno por uno, a mano) que se usó para aplicar
 * las correcciones del 28-jul-2026. Ese proceso manual es exactamente
 * el tipo de paso humano que causó el bug original de este proyecto
 * (una columna agregada a mano en pgAdmin, nunca migrada de verdad).
 *
 * Qué hace:
 *   1. Se conecta a la base de datos (necesita una conexión con
 *      privilegios de superusuario o equivalente — crear roles, tablas,
 *      políticas — NUNCA la conexión normal de la aplicación en
 *      producción, que corre con privilegios limitados a propósito).
 *   2. Lleva un registro de qué migraciones ya se aplicaron, en una
 *      tabla propia (`_migraciones_aplicadas`), para que correr este
 *      script muchas veces sea seguro — no vuelve a aplicar lo que ya
 *      está.
 *   3. Aplica, en orden, las migraciones nuevas que falten:
 *      primero las de packages/db/migrations/*.sql (esquema),
 *      después las de packages/db/migrations/manual/*.sql (roles,
 *      permisos, RLS), en el orden de dependencia real: 004, 001, 002,
 *      003, 005 — no alfabético.
 *
 * Uso:
 *   DATABASE_URL_MIGRACIONES=postgresql://postgres:contrasena@host:5432/basededatos \
 *     node packages/db/scripts/aplicar-migraciones.cjs
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const URL_MIGRACIONES = process.env.DATABASE_URL_MIGRACIONES;

if (!URL_MIGRACIONES) {
  console.error(
    '❌ Falta la variable de entorno DATABASE_URL_MIGRACIONES. ' +
      'Debe apuntar a un usuario con privilegios suficientes para crear ' +
      'roles, tablas y políticas (normalmente el superusuario de Postgres) ' +
      '— nunca la conexión normal de la aplicación.',
  );
  process.exit(1);
}

const DIR_MIGRACIONES = path.join(__dirname, '..', 'migrations');
const DIR_MANUAL = path.join(DIR_MIGRACIONES, 'manual');

// Orden real de dependencia de las migraciones manuales — no alfabético.
// Ver comentarios dentro de cada archivo en packages/db/migrations/manual/
// para el porqué de este orden específico.
const ORDEN_MANUAL = [
  '004_habilitar_login_roles.sql',
  '001_bypass_rls_admin.sql',
  '002_grants_app_role.sql',
  '003_auditoria_inmutable.sql',
  '005_grants_banners_y_default_privileges.sql',
];

function dividirEnSentencias(sql) {
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function asegurarTablaControl(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migraciones_aplicadas (
      nombre text PRIMARY KEY,
      aplicado_en timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function yaAplicada(client, nombre) {
  const r = await client.query(
    'SELECT 1 FROM _migraciones_aplicadas WHERE nombre = $1',
    [nombre],
  );
  return r.rows.length > 0;
}

const SOLO_MARCAR = process.argv.includes('--marcar-como-aplicadas');

async function marcarSinAplicar(client, nombre) {
  const yaEsta = await yaAplicada(client, nombre);
  if (yaEsta) {
    console.log(`⏭️  ${nombre} — ya estaba registrada.`);
    return;
  }
  await client.query(
    'INSERT INTO _migraciones_aplicadas (nombre) VALUES ($1)',
    [nombre],
  );
  console.log(`📝 ${nombre} — registrada como ya aplicada (no se ejecutó).`);
}

async function aplicarArchivo(client, rutaCompleta, nombreParaRegistro) {
  const yaEsta = await yaAplicada(client, nombreParaRegistro);
  if (yaEsta) {
    console.log(`⏭️  ${nombreParaRegistro} — ya aplicada, se omite.`);
    return;
  }

  const contenido = fs.readFileSync(rutaCompleta, 'utf-8');
  const sentencias = dividirEnSentencias(contenido);

  console.log(`▶️  Aplicando ${nombreParaRegistro} (${sentencias.length} sentencias)...`);
  await client.query('BEGIN');
  try {
    for (const sentencia of sentencias) {
      await client.query(sentencia);
    }
    await client.query(
      'INSERT INTO _migraciones_aplicadas (nombre) VALUES ($1)',
      [nombreParaRegistro],
    );
    await client.query('COMMIT');
    console.log(`✅ ${nombreParaRegistro} aplicada correctamente.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`❌ Falló ${nombreParaRegistro}:`, err.message);
    throw err;
  }
}

async function main() {
  const client = new Client({ connectionString: URL_MIGRACIONES });
  await client.connect();

  try {
    await asegurarTablaControl(client);

    const migracionesEsquema = fs
      .readdirSync(DIR_MIGRACIONES)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const nombre of migracionesEsquema) {
      if (SOLO_MARCAR) {
        await marcarSinAplicar(client, nombre);
      } else {
        await aplicarArchivo(client, path.join(DIR_MIGRACIONES, nombre), nombre);
      }
    }

    for (const nombre of ORDEN_MANUAL) {
      const ruta = path.join(DIR_MANUAL, nombre);
      if (!fs.existsSync(ruta)) {
        console.log(`⚠️  ${nombre} no existe en manual/, se omite.`);
        continue;
      }
      if (SOLO_MARCAR) {
        await marcarSinAplicar(client, `manual/${nombre}`);
      } else {
        await aplicarArchivo(client, ruta, `manual/${nombre}`);
      }
    }

    console.log('\n✅ Todas las migraciones están al día.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\n❌ El proceso de migración falló. No se hicieron cambios parciales (cada archivo corre en su propia transacción).');
  console.error(err);
  process.exit(1);
});
