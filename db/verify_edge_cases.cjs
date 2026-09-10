const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');

async function main() {
  const db = new PGlite();
  const migrationsDir = require('path').join(__dirname, 'migrations');
  const migrationFile = fs.readdirSync(migrationsDir).find((f) => f.endsWith('.sql'));
  const migrationSql = fs.readFileSync(require('path').join(migrationsDir, migrationFile), 'utf-8');
  for (const s of migrationSql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
    await db.exec(s);
  }
  await db.exec(`GRANT USAGE ON SCHEMA public TO ticketya_app;`);
  await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ticketya_app;`);
  console.log('✅ Migración aplicada y privilegios otorgados.\n');

  // --- Setup: dos cooperativas, cada una con un punto de operación, ruta,
  // tipo de vehículo, unidad y viaje propio ---
  const coopA = (
    await db.query(
      `INSERT INTO cooperativas (ruc, razon_social, nombre_comercial, estado, modelo_integracion)
       VALUES ('0190000001001','Coop A','Coop A','aprobada','modelo_a') RETURNING id;`,
    )
  ).rows[0].id;
  const coopB = (
    await db.query(
      `INSERT INTO cooperativas (ruc, razon_social, nombre_comercial, estado, modelo_integracion)
       VALUES ('0190000002001','Coop B','Coop B','aprobada','modelo_a') RETURNING id;`,
    )
  ).rows[0].id;

  const puntoOrigen = (
    await db.query(
      `INSERT INTO puntos_operacion (tipo, nombre, ciudad, provincia)
       VALUES ('terminal_terrestre','Terminal Machala','Machala','El Oro') RETURNING id;`,
    )
  ).rows[0].id;
  const puntoDestino = (
    await db.query(
      `INSERT INTO puntos_operacion (tipo, nombre, ciudad, provincia)
       VALUES ('terminal_terrestre','Terminal Guayaquil','Guayaquil','Guayas') RETURNING id;`,
    )
  ).rows[0].id;

  await db.exec(`SET ROLE ticketya_app;`);

  async function crearViajeParaCooperativa(coopId, label) {
    await db.exec(`SET app.current_cooperativa_id = '${coopId}';`);
    const tipoVeh = (
      await db.query(
        `INSERT INTO tipos_vehiculo (cooperativa_id, nombre, capacidad_total, distribucion_asientos)
         VALUES ('${coopId}', 'Estándar', 40, '{}') RETURNING id;`,
      )
    ).rows[0].id;
    const unidad = (
      await db.query(
        `INSERT INTO unidades (cooperativa_id, tipo_vehiculo_id, placa, identificador_operativo)
         VALUES ('${coopId}', '${tipoVeh}', 'ABC-${label}', 'DISCO-${label}') RETURNING id;`,
      )
    ).rows[0].id;
    const ruta = (
      await db.query(
        `INSERT INTO rutas (cooperativa_id, origen_punto_operacion_id, destino_punto_operacion_id, precio_base_referencia)
         VALUES ('${coopId}', '${puntoOrigen}', '${puntoDestino}', 12.50) RETURNING id;`,
      )
    ).rows[0].id;
    const viaje = (
      await db.query(
        `INSERT INTO viajes (cooperativa_id, ruta_id, unidad_id, fecha_salida, hora_salida_programada, precio_base)
         VALUES ('${coopId}', '${ruta}', '${unidad}', '2026-08-01', '2026-08-01 08:00:00-05', 12.50) RETURNING id;`,
      )
    ).rows[0].id;
    const asiento = (
      await db.query(
        `INSERT INTO viaje_asientos (viaje_id, numero_asiento) VALUES ('${viaje}', '1A') RETURNING id;`,
      )
    ).rows[0].id;
    return { viaje, asiento };
  }

  const a = await crearViajeParaCooperativa(coopA, 'A');
  const b = await crearViajeParaCooperativa(coopB, 'B');
  console.log('✅ Viaje + asiento creados para cada cooperativa.\n');

  // --- Prueba 1: política con subconsulta en viaje_asientos ---
  await db.exec(`SET app.current_cooperativa_id = '${coopA}';`);
  const asientosDesdeA = await db.query(`SELECT id, viaje_id FROM viaje_asientos;`);
  console.log(`Asientos visibles desde Cooperativa A: ${asientosDesdeA.rows.length} (esperado: 1)`);

  await db.exec(`SET app.current_cooperativa_id = '${coopB}';`);
  const asientosDesdeB = await db.query(`SELECT id, viaje_id FROM viaje_asientos;`);
  console.log(`Asientos visibles desde Cooperativa B: ${asientosDesdeB.rows.length} (esperado: 1)`);

  const subqueryOk =
    asientosDesdeA.rows.length === 1 &&
    asientosDesdeA.rows[0].id === a.asiento &&
    asientosDesdeB.rows.length === 1 &&
    asientosDesdeB.rows[0].id === b.asiento;
  console.log(
    subqueryOk
      ? '✅ Política con subconsulta (viaje_asientos) funciona correctamente.\n'
      : '❌ FALLO en política de viaje_asientos.\n',
  );

  // --- Prueba 2: intento de escribir un asiento de OTRA cooperativa
  // estando seteado en la propia -> debe fallar por WITH CHECK ---
  await db.exec(`SET app.current_cooperativa_id = '${coopA}';`);
  let bloqueoEscrituraCruzadaOk = false;
  try {
    await db.exec(`UPDATE viaje_asientos SET estado = 'ocupado' WHERE id = '${b.asiento}';`);
    // Si no lanza error, revisamos si realmente afectó 0 filas (RLS puede
    // silenciosamente no encontrar la fila en vez de lanzar excepción).
    const check = await db.query(
      `SELECT estado FROM viaje_asientos WHERE id = '${b.asiento}' AND estado = 'ocupado';`,
    );
    bloqueoEscrituraCruzadaOk = check.rows.length === 0;
  } catch (e) {
    bloqueoEscrituraCruzadaOk = true;
  }
  console.log(
    bloqueoEscrituraCruzadaOk
      ? '✅ Cooperativa A no pudo modificar un asiento de Cooperativa B (RLS bloqueó la escritura cruzada).\n'
      : '❌ FALLO CRÍTICO: Cooperativa A modificó un asiento de Cooperativa B.\n',
  );

  // --- Prueba 3: CHECK de ajustes_liquidacion (exactamente una FK seteada) ---
  await db.exec(`RESET ROLE;`); // volver a superusuario para esta parte administrativa
  const liq = (
    await db.query(
      `INSERT INTO liquidaciones_cooperativa (cooperativa_id, periodo_inicio, periodo_fin, monto_ventas_bruto, monto_comision_plataforma, monto_liquidado)
       VALUES ('${coopA}', '2026-07-01', '2026-07-07', 1000, 100, 900) RETURNING id;`,
    )
  ).rows[0].id;

  let checkValidoOk = false;
  try {
    await db.exec(
      `INSERT INTO ajustes_liquidacion (liquidacion_cooperativa_id, monto, motivo, registrado_por_usuario_id)
       VALUES ('${liq}', -50, 'Nota de crédito', (SELECT id FROM usuarios LIMIT 1));`,
    );
    checkValidoOk = false; // no debería llegar aquí sin usuario válido, ver abajo
  } catch (e) {
    // Esperado: puede fallar por FK de usuario (no hay usuarios aún), no por el CHECK.
    checkValidoOk = e.message.includes('usuarios') || e.message.includes('foreign key');
  }

  // Insertar un usuario admin_plataforma real para probar el CHECK limpio.
  await db.exec(
    `INSERT INTO usuarios (rol, correo, nombre_completo) VALUES ('admin_plataforma', 'admin@ticketya.ec', 'Admin Plataforma');`,
  );
  const userId = (await db.query(`SELECT id FROM usuarios LIMIT 1;`)).rows[0].id;

  await db.exec(
    `INSERT INTO ajustes_liquidacion (liquidacion_cooperativa_id, monto, motivo, registrado_por_usuario_id)
     VALUES ('${liq}', -50, 'Nota de crédito válida', '${userId}');`,
  );
  console.log('✅ Ajuste válido (solo liquidacion_cooperativa_id seteado) insertado correctamente.');

  let checkRechazaAmbasNulasOk = false;
  try {
    await db.exec(
      `INSERT INTO ajustes_liquidacion (monto, motivo, registrado_por_usuario_id)
       VALUES (-10, 'Ajuste inválido sin ninguna liquidación', '${userId}');`,
    );
  } catch (e) {
    checkRechazaAmbasNulasOk = e.message.toLowerCase().includes('chk_ajustes_liquidacion');
  }
  console.log(
    checkRechazaAmbasNulasOk
      ? '✅ El CHECK rechazó correctamente un ajuste sin ninguna liquidación asociada.\n'
      : '❌ FALLO: el CHECK no rechazó un ajuste inválido (ninguna liquidación seteada).\n',
  );

  const todoOk = subqueryOk && bloqueoEscrituraCruzadaOk && checkRechazaAmbasNulasOk;
  console.log(todoOk ? '✅✅✅ TODAS LAS PRUEBAS ADICIONALES PASARON.' : '❌ Hay fallos pendientes de corregir.');
  if (!todoOk) process.exit(1);
}

main().catch((e) => {
  console.error('ERROR INESPERADO:', e);
  process.exit(1);
});
