#!/usr/bin/env node
/**
 * Respaldo de la base de datos (RF-OPS, Fase B pendiente, cerrada
 * 28-jul-2026). Genera un archivo comprimido con toda la base de
 * datos — esquema, datos, roles, políticas RLS — todo lo necesario
 * para reconstruir la base completa en otra máquina.
 *
 * No basta con que este script exista: el backup solo sirve si
 * alguna vez se probó restaurarlo. Ver
 * packages/db/scripts/restaurar-backup.cjs y
 * packages/db/scripts/verificar-backup.cjs — este último hace la
 * prueba completa (restaurar + correr las 88 pruebas reales) y es el
 * que se debe correr periódicamente, no solo confiar en que "debería
 * funcionar".
 *
 * Uso:
 *   DATABASE_URL_BACKUP=postgresql://postgres:contrasena@host:5432/basededatos \
 *     node packages/db/scripts/respaldar.cjs
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const URL_BACKUP = process.env.DATABASE_URL_BACKUP;

if (!URL_BACKUP) {
  console.error(
    '❌ Falta la variable de entorno DATABASE_URL_BACKUP. ' +
      'Debe apuntar a un usuario con permisos de lectura completos ' +
      '(normalmente el superusuario de Postgres).',
  );
  process.exit(1);
}

const DIR_BACKUPS = path.join(__dirname, '..', 'backups');
if (!fs.existsSync(DIR_BACKUPS)) {
  fs.mkdirSync(DIR_BACKUPS, { recursive: true });
}

const url = new URL(URL_BACKUP);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const nombreArchivo = `ticketya_backup_${timestamp}.dump`;
const rutaCompleta = path.join(DIR_BACKUPS, nombreArchivo);

console.log(`▶️  Respaldando ${url.pathname.slice(1)}@${url.hostname} → ${nombreArchivo}...`);

try {
  execFileSync(
    'pg_dump',
    [
      '-h', url.hostname,
      '-p', url.port || '5432',
      '-U', url.username,
      '-d', url.pathname.slice(1),
      '-F', 'c', // formato "custom" de Postgres: comprimido, y restaurable con pg_restore
      '-f', rutaCompleta,
    ],
    {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
      stdio: 'inherit',
    },
  );
  const tamano = (fs.statSync(rutaCompleta).size / 1024 / 1024).toFixed(2);
  console.log(`✅ Backup creado: ${rutaCompleta} (${tamano} MB)`);
} catch (err) {
  console.error('❌ Falló el backup:', err.message);
  process.exit(1);
}
