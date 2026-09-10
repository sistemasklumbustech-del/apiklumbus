const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');

async function run(db, sql, label) {
  try {
    return await db.query(sql);
  } catch (err) {
    console.error(`❌ Falló [${label}]:`, err.message);
    throw err;
  }
}

async function main() {
  const db = new PGlite();
  const migrationsDir = require('path').join(__dirname, 'migrations');
  const migrationFile = fs.readdirSync(migrationsDir).find((f) => f.endsWith('.sql'));
  const migrationSql = fs.readFileSync(require('path').join(migrationsDir, migrationFile), 'utf-8');
  const statements = migrationSql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statements) await db.exec(s);
  console.log('✅ Migración aplicada.\n');

  // Otorgar privilegios al rol de aplicación (paso de migración manual
  // real que también documentamos en el README — drizzle-kit no genera
  // GRANTs automáticamente para los roles que define).
  await db.exec(`GRANT USAGE ON SCHEMA public TO ticketya_app;`);
  await db.exec(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ticketya_app;`,
  );
  console.log('✅ Privilegios otorgados a ticketya_app.\n');

  // Insertar dos cooperativas distintas como superusuario (dueño de tabla).
  const coopA = await run(
    db,
    `INSERT INTO cooperativas (ruc, razon_social, nombre_comercial, estado, modelo_integracion)
     VALUES ('0190123456001', 'Coop Machala S.A.', 'Coop Machala', 'aprobada', 'modelo_a')
     RETURNING id;`,
    'insert coopA',
  );
  const coopB = await run(
    db,
    `INSERT INTO cooperativas (ruc, razon_social, nombre_comercial, estado, modelo_integracion)
     VALUES ('0190654321001', 'Coop Loja S.A.', 'Coop Loja', 'aprobada', 'modelo_a')
     RETURNING id;`,
    'insert coopB',
  );
  const coopAId = coopA.rows[0].id;
  const coopBId = coopB.rows[0].id;
  console.log(`Cooperativa A: ${coopAId}`);
  console.log(`Cooperativa B: ${coopBId}\n`);

  // Insertar un tipo_vehiculo para CADA cooperativa, actuando como
  // ticketya_app con la variable de sesión correcta para cada una — así
  // el propio INSERT también queda sujeto al WITH CHECK de la política.
  await db.exec(`SET ROLE ticketya_app;`);

  await db.exec(`SET app.current_cooperativa_id = '${coopAId}';`);
  await db.exec(
    `INSERT INTO tipos_vehiculo (cooperativa_id, nombre, capacidad_total, distribucion_asientos)
     VALUES ('${coopAId}', 'Bus estándar 2+2', 40, '{"layout":"2+2"}');`,
  );

  await db.exec(`SET app.current_cooperativa_id = '${coopBId}';`);
  await db.exec(
    `INSERT INTO tipos_vehiculo (cooperativa_id, nombre, capacidad_total, distribucion_asientos)
     VALUES ('${coopBId}', 'Buseta 2+1', 30, '{"layout":"2+1"}');`,
  );
  console.log('✅ Se insertó un tipo_vehiculo para cada cooperativa (bajo RLS).\n');

  // --- LA PRUEBA REAL ---
  // Conectados como cooperativa A, ¿cuántas filas de tipos_vehiculo veo?
  await db.exec(`SET app.current_cooperativa_id = '${coopAId}';`);
  const vistaDesdeA = await db.query(`SELECT nombre, cooperativa_id FROM tipos_vehiculo;`);
  console.log(`Filas visibles conectado como Cooperativa A: ${vistaDesdeA.rows.length}`);
  console.log(vistaDesdeA.rows);

  // Conectados como cooperativa B, ¿cuántas veo?
  await db.exec(`SET app.current_cooperativa_id = '${coopBId}';`);
  const vistaDesdeB = await db.query(`SELECT nombre, cooperativa_id FROM tipos_vehiculo;`);
  console.log(`\nFilas visibles conectado como Cooperativa B: ${vistaDesdeB.rows.length}`);
  console.log(vistaDesdeB.rows);

  // Sin ninguna cooperativa seteada (conexión "huérfana"), no debería ver nada.
  await db.exec(`RESET app.current_cooperativa_id;`);
  const vistaSinTenant = await db.query(`SELECT nombre FROM tipos_vehiculo;`);
  console.log(`\nFilas visibles SIN cooperativa_id seteado: ${vistaSinTenant.rows.length}`);

  // --- VEREDICTO ---
  const ok =
    vistaDesdeA.rows.length === 1 &&
    vistaDesdeA.rows[0].cooperativa_id === coopAId &&
    vistaDesdeB.rows.length === 1 &&
    vistaDesdeB.rows[0].cooperativa_id === coopBId &&
    vistaSinTenant.rows.length === 0;

  console.log(
    ok
      ? '\n✅ AISLAMIENTO MULTI-TENANT VERIFICADO: cada cooperativa ve solo su propia fila, y una conexión sin tenant seteado no ve nada.'
      : '\n❌ FALLO DE AISLAMIENTO — revisar política RLS.',
  );
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
