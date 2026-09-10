const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');

async function main() {
  const db = new PGlite();
  const migrationsDir = require('path').join(__dirname, 'migrations');
  const migrationFile = fs.readdirSync(migrationsDir).find((f) => f.endsWith('.sql'));
  const sql = fs.readFileSync(require('path').join(migrationsDir, migrationFile), 'utf-8');

  // drizzle-kit separa statements con '--> statement-breakpoint'
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Ejecutando ${statements.length} statements contra Postgres embebido (pglite)...`);

  for (let i = 0; i < statements.length; i++) {
    try {
      await db.exec(statements[i]);
    } catch (err) {
      console.error(`\n❌ ERROR en statement #${i}:`);
      console.error(statements[i].slice(0, 300));
      console.error('---');
      console.error(err.message);
      process.exit(1);
    }
  }

  console.log('✅ Los 574 líneas / ' + statements.length + ' statements se ejecutaron sin errores.');

  // Verificación adicional: contar tablas reales creadas
  const res = await db.query(
    `SELECT count(*)::int as n FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  console.log(`Tablas reales creadas en el esquema public: ${res.rows[0].n}`);

  const resPolicies = await db.query(`SELECT count(*)::int as n FROM pg_policies`);
  console.log(`Políticas RLS reales creadas: ${resPolicies.rows[0].n}`);

  const resRoles = await db.query(
    `SELECT rolname FROM pg_roles WHERE rolname IN ('ticketya_app', 'ticketya_platform_admin')`,
  );
  console.log(`Roles creados: ${resRoles.rows.map((r) => r.rolname).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
