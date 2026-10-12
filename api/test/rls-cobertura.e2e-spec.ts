import { Client } from 'pg';

/**
 * Row-Level Security (12-oct-2026). La auditoría de seguridad encontró seis tablas con
 * `cooperativa_id` sin RLS (algunas, como `tareas_postpago`, se crearon después de fijar el
 * patrón y nadie se acordó). Esta prueba evita que vuelva a pasar: cualquier tabla nueva con
 * `cooperativa_id` debe nacer con RLS y con una política, o la prueba falla.
 */
describe('Row-Level Security: cobertura y aislamiento', () => {
  const sufijo = Date.now();
  const nombres = [`Coop RLS A ${sufijo}`, `Coop RLS B ${sufijo}`];
  let coopA: string;
  let coopB: string;

  const plataforma = () => new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });

  /** Ejecuta como el rol de la aplicación, con la cooperativa fijada (o sin ninguna), dentro de una transacción que se deshace. */
  async function comoApp<T>(cooperativaId: string | null, trabajo: (pg: Client) => Promise<T>): Promise<T> {
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    try {
      await pg.query('BEGIN');
      if (cooperativaId) await pg.query(`SELECT set_config('app.current_cooperativa_id', $1, true)`, [cooperativaId]);
      return await trabajo(pg);
    } finally {
      await pg.query('ROLLBACK').catch(() => undefined);
      await pg.end();
    }
  }

  beforeAll(async () => {
    const pg = plataforma();
    await pg.connect();
    try {
      const ids: string[] = [];
      for (const [i, nombre] of nombres.entries()) {
        const r = await pg.query(
          `INSERT INTO cooperativas (ruc, razon_social, nombre_comercial, modelo_integracion)
           VALUES ($1, $2, $3, 'modelo_a') RETURNING id`,
          [`09${String(sufijo).slice(-9)}${i}`.slice(0, 13), nombre, nombre],
        );
        ids.push(r.rows[0].id as string);
      }
      [coopA, coopB] = ids;
      await pg.query(
        `INSERT INTO metodos_pago_cooperativa (cooperativa_id, tipo, datos_cuenta, activo)
         VALUES ($1, 'transferencia_bancaria', '{"numero":"AAAA"}', true), ($2, 'transferencia_bancaria', '{"numero":"BBBB"}', true)`,
        [coopA, coopB],
      );
    } finally {
      await pg.end();
    }
  });

  afterAll(async () => {
    const pg = plataforma();
    await pg.connect();
    try {
      await pg.query('DELETE FROM metodos_pago_cooperativa WHERE cooperativa_id = ANY($1)', [[coopA, coopB]]);
      await pg.query('DELETE FROM cooperativas WHERE id = ANY($1)', [[coopA, coopB]]);
    } finally {
      await pg.end();
    }
  });

  it('toda tabla con cooperativa_id tiene RLS activo y al menos una política', async () => {
    const pg = plataforma();
    await pg.connect();
    try {
      const sinProteccion = await pg.query<{ tabla: string }>(`
        SELECT c.relname AS tabla
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN information_schema.columns k
          ON k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'cooperativa_id'
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND (NOT c.relrowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname))
        ORDER BY 1`);
      expect(sinProteccion.rows.map((f) => f.tabla)).toEqual([]);
    } finally {
      await pg.end();
    }
  });

  it('las tablas que pertenecen a una cooperativa a través de su padre también están protegidas', async () => {
    const pg = plataforma();
    await pg.connect();
    try {
      const protegidas = await pg.query<{ tabla: string }>(
        `SELECT c.relname AS tabla FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relrowsecurity AND c.relname = ANY($1) ORDER BY 1`,
        [['ajustes_liquidacion', 'horarios_ruta', 'ruta_paradas', 'solicitudes_factura_cooperativa']],
      );
      expect(protegidas.rows.map((f) => f.tabla)).toEqual([
        'ajustes_liquidacion',
        'horarios_ruta',
        'ruta_paradas',
        'solicitudes_factura_cooperativa',
      ]);
    } finally {
      await pg.end();
    }
  });

  it('una cooperativa solo ve sus propias cuentas de cobro; sin cooperativa fijada, ninguna', async () => {
    const cuentasDeA = await comoApp(coopA, async (pg) => (await pg.query('SELECT datos_cuenta FROM metodos_pago_cooperativa')).rows);
    expect(cuentasDeA.map((f) => f.datos_cuenta.numero)).toEqual(['AAAA']);

    const cuentasDeB = await comoApp(coopB, async (pg) => (await pg.query('SELECT datos_cuenta FROM metodos_pago_cooperativa')).rows);
    expect(cuentasDeB.map((f) => f.datos_cuenta.numero)).toEqual(['BBBB']);

    const sinContexto = await comoApp(null, async (pg) => (await pg.query('SELECT 1 FROM metodos_pago_cooperativa')).rows);
    expect(sinContexto).toEqual([]);
  });

  it('el rol de plataforma las ve todas', async () => {
    const pg = plataforma();
    await pg.connect();
    try {
      const r = await pg.query('SELECT count(*)::int AS n FROM metodos_pago_cooperativa WHERE cooperativa_id = ANY($1)', [[coopA, coopB]]);
      expect(r.rows[0].n).toBe(2);
    } finally {
      await pg.end();
    }
  });

  it('una cooperativa no puede modificar, borrar ni crear datos a nombre de otra', async () => {
    await comoApp(coopA, async (pg) => {
      const modificar = await pg.query(`UPDATE metodos_pago_cooperativa SET activo = false WHERE cooperativa_id = $1`, [coopB]);
      expect(modificar.rowCount).toBe(0);
      const borrar = await pg.query(`DELETE FROM metodos_pago_cooperativa WHERE cooperativa_id = $1`, [coopB]);
      expect(borrar.rowCount).toBe(0);
    });

    await expect(
      comoApp(coopA, (pg) =>
        pg.query(
          `INSERT INTO metodos_pago_cooperativa (cooperativa_id, tipo, datos_cuenta, activo) VALUES ($1, 'efectivo', '{}', true)`,
          [coopB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);

    // Tampoco puede "regalar" una fila propia a otra cooperativa.
    await expect(
      comoApp(coopA, (pg) => pg.query(`UPDATE metodos_pago_cooperativa SET cooperativa_id = $1 WHERE cooperativa_id = $2`, [coopB, coopA])),
    ).rejects.toThrow(/row-level security/);
  });
});
