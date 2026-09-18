/**
 * Datos ficticios para probar de punta a punta lo construido en la
 * Fase 1 (gate de cooperativa habilitada, venta en ventanilla,
 * cotización antes de pagar) -- 2 cooperativas, un usuario de cada
 * rol, catálogo completo (terminales, rutas, unidades, conductores) y
 * varias salidas programadas para los próximos días.
 *
 * Todo lo que crea este script es reconocible como dato de prueba:
 * RUCs 179000000010{1,2}, correos @prueba.klumbus.tech, nombres con
 * el prefijo "PRUEBA F1" -- distinto del prefijo "PRUEBA" (sin "F1")
 * que ya usa seeds/rf017-conciliacion.seed.ts, para no chocar ni
 * mezclarse con esos datos si ambos siguen existiendo a la vez.
 *
 * Uso:
 *   DATABASE_URL_PUBLICO=postgresql://ticketya_platform_admin:...@host:5432/ticketya \
 *     npm run seed:fase1 --workspace=db
 *
 * Para borrar todo lo que este script creó (cuando termines de probar):
 *   DATABASE_URL_PUBLICO=... npm run seed:fase1:limpiar --workspace=db
 *
 * Las cuentas administrativas (super_admin, admin_plataforma,
 * admin_cooperativa) tienen 2FA obligatorio en el primer login real
 * -- este script NO puede completar ese paso por vos (necesita un
 * código real de tu app autenticadora). Si querés probar sin esa
 * fricción mientras armás el resto, seteá temporalmente
 * DESACTIVAR_2FA_TEMPORAL=true en el .env del backend y reinicia el
 * servicio -- no lo dejes así en producción real.
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import * as schema from '../schema';

const CONNECTION_STRING = process.env.DATABASE_URL_PUBLICO;
if (!CONNECTION_STRING) {
  console.error('❌ Falta DATABASE_URL_PUBLICO (rol ticketya_platform_admin).');
  process.exit(1);
}

const SOLO_LIMPIAR = process.argv.includes('--limpiar');
const PASSWORD_PRUEBA = 'Prueba123456+';

const pool = new Pool({ connectionString: CONNECTION_STRING });
const db = drizzle(pool, { schema });

const RUC_TRANS_ORO = '1790000000101';
const RUC_EL_PACIFICO = '1790000000102';

const NOMBRES_PUNTOS = [
  'PRUEBA F1 Terminal Machala',
  'PRUEBA F1 Terminal Quito',
  'PRUEBA F1 Terminal Guayaquil',
  'PRUEBA F1 Terminal Cuenca',
];

const CORREOS_USUARIOS = [
  'super.admin.f1@prueba.klumbus.tech',
  'admin.plataforma.f1@prueba.klumbus.tech',
  'admin.transoro.f1@prueba.klumbus.tech',
  'admin.pacifico.f1@prueba.klumbus.tech',
  'vendedor.transoro.f1@prueba.klumbus.tech',
  'pasajero.ana.f1@prueba.klumbus.tech',
  'pasajero.luis.f1@prueba.klumbus.tech',
];

const DISTRIBUCION_SENCILLA = {
  pisos: [
    {
      nombre: 'Piso único',
      filas: [
        { celdas: ['1A', '1B', null, '1C', '1D'] },
        { celdas: ['2A', '2B', null, '2C', '2D'] },
        { celdas: ['3A', '3B', null, '3C', '3D'] },
        { celdas: ['4A', '4B', null, '4C', '4D'] },
        { celdas: ['5A', '5B', null, '5C', '5D'] },
      ],
    },
  ],
};

const DISTRIBUCION_DOBLE_PISO_VIP = {
  pisos: [
    {
      nombre: 'Piso 1 -- VIP',
      categoria: 'vip',
      filas: [
        { celdas: ['1A', '1B', null, '1C', '1D'] },
        { celdas: ['2A', '2B', null, '2C', '2D'] },
      ],
    },
    {
      nombre: 'Piso 2 -- Ejecutivo',
      filas: [
        { celdas: ['3A', '3B', null, '3C', '3D'] },
        { celdas: ['4A', '4B', null, '4C', '4D'] },
        { celdas: ['5A', '5B', null, '5C', '5D'] },
      ],
    },
  ],
};

/** Borra todo lo que este script pudo haber insertado en una corrida anterior, en orden de dependencia. */
async function limpiar() {
  const cooperativasPrueba = await db
    .select({ id: schema.cooperativas.id })
    .from(schema.cooperativas)
    .where(inArray(schema.cooperativas.ruc, [RUC_TRANS_ORO, RUC_EL_PACIFICO]));
  const cooperativaIds = cooperativasPrueba.map((c) => c.id);

  const usuariosPrueba = await db
    .select({ id: schema.usuarios.id })
    .from(schema.usuarios)
    .where(inArray(schema.usuarios.correo, CORREOS_USUARIOS));
  const usuarioIds = usuariosPrueba.map((u) => u.id);

  if (cooperativaIds.length === 0 && usuarioIds.length === 0) {
    console.log('ℹ️  No había datos de una corrida anterior -- nada que limpiar.');
    return;
  }

  const viajesPrueba = cooperativaIds.length
    ? await db.select({ id: schema.viajes.id }).from(schema.viajes).where(inArray(schema.viajes.cooperativaId, cooperativaIds))
    : [];
  const viajeIds = viajesPrueba.map((v) => v.id);

  const comprasPrueba = usuarioIds.length
    ? await db.select({ id: schema.compras.id }).from(schema.compras).where(inArray(schema.compras.compradorUsuarioId, usuarioIds))
    : [];
  const compraIds = comprasPrueba.map((c) => c.id);

  const boletosPrueba = compraIds.length
    ? await db.select({ id: schema.boletos.id }).from(schema.boletos).where(inArray(schema.boletos.compraId, compraIds))
    : [];
  const boletoIds = boletosPrueba.map((b) => b.id);

  if (boletoIds.length) {
    await db.delete(schema.comprobantesTasaTerminal).where(inArray(schema.comprobantesTasaTerminal.boletoId, boletoIds));
  }
  if (compraIds.length) {
    await db.delete(schema.comprasTransiciones).where(inArray(schema.comprasTransiciones.compraId, compraIds));
    await db.delete(schema.comprobantesElectronicos).where(inArray(schema.comprobantesElectronicos.compraId, compraIds));
    await db.delete(schema.pagos).where(inArray(schema.pagos.compraId, compraIds));
  }
  if (boletoIds.length) {
    await db.delete(schema.boletos).where(inArray(schema.boletos.id, boletoIds));
  }
  if (compraIds.length) {
    await db.delete(schema.pasajerosCompra).where(inArray(schema.pasajerosCompra.compraId, compraIds));
    await db.delete(schema.compras).where(inArray(schema.compras.id, compraIds));
  }
  if (viajeIds.length) {
    await db.delete(schema.viajeAsientos).where(inArray(schema.viajeAsientos.viajeId, viajeIds));
    await db.delete(schema.viajes).where(inArray(schema.viajes.id, viajeIds));
  }
  if (cooperativaIds.length) {
    await db.delete(schema.metodosPagoCooperativa).where(inArray(schema.metodosPagoCooperativa.cooperativaId, cooperativaIds));
    await db.delete(schema.unidades).where(inArray(schema.unidades.cooperativaId, cooperativaIds));
    await db.delete(schema.conductores).where(inArray(schema.conductores.cooperativaId, cooperativaIds));
    await db.delete(schema.tiposVehiculo).where(inArray(schema.tiposVehiculo.cooperativaId, cooperativaIds));
    await db.delete(schema.rutas).where(inArray(schema.rutas.cooperativaId, cooperativaIds));
  }
  if (usuarioIds.length) {
    await db.delete(schema.usuarios).where(inArray(schema.usuarios.id, usuarioIds));
  }
  if (cooperativaIds.length) {
    await db.delete(schema.cooperativas).where(inArray(schema.cooperativas.id, cooperativaIds));
  }
  await db.delete(schema.puntosOperacion).where(inArray(schema.puntosOperacion.nombre, NOMBRES_PUNTOS));

  console.log('🧹 Datos de una corrida anterior eliminados.');
}

async function main() {
  await limpiar();
  if (SOLO_LIMPIAR) {
    console.log('✅ Limpieza completa -- no se insertó nada nuevo (--limpiar).');
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD_PRUEBA, 10);

  // --- Terminales ---
  const [terminalMachala] = await db
    .insert(schema.puntosOperacion)
    .values({ tipo: 'terminal_terrestre', nombre: NOMBRES_PUNTOS[0], ciudad: 'Machala', provincia: 'El Oro', latitud: -3.2581, longitud: -79.9554, tasaMonto: '0.50', estado: 'aprobado' })
    .returning();
  const [terminalQuito] = await db
    .insert(schema.puntosOperacion)
    .values({ tipo: 'terminal_terrestre', nombre: NOMBRES_PUNTOS[1], ciudad: 'Quito', provincia: 'Pichincha', latitud: -0.1807, longitud: -78.4678, tasaMonto: '0.60', estado: 'aprobado' })
    .returning();
  const [terminalGuayaquil] = await db
    .insert(schema.puntosOperacion)
    .values({ tipo: 'terminal_terrestre', nombre: NOMBRES_PUNTOS[2], ciudad: 'Guayaquil', provincia: 'Guayas', latitud: -2.1894, longitud: -79.8891, tasaMonto: '0.55', estado: 'aprobado' })
    .returning();
  const [terminalCuenca] = await db
    .insert(schema.puntosOperacion)
    .values({ tipo: 'terminal_terrestre', nombre: NOMBRES_PUNTOS[3], ciudad: 'Cuenca', provincia: 'Azuay', latitud: -2.9001, longitud: -79.0059, tasaMonto: '0.50', estado: 'aprobado' })
    .returning();

  // --- Cooperativas: una habilitada, una suspendida (para probar el gate de la Fase 1) ---
  const [transOro] = await db
    .insert(schema.cooperativas)
    .values({
      ruc: RUC_TRANS_ORO,
      razonSocial: 'PRUEBA F1 Trans Oro S.A.',
      nombreComercial: 'PRUEBA F1 Trans Oro',
      estado: 'aprobada',
      modeloIntegracion: 'modelo_a',
      fechaAfiliacion: new Date(),
      contactoNombre: 'PRUEBA Gerente Trans Oro',
      contactoCorreo: 'admin.transoro.f1@prueba.klumbus.tech',
      contactoTelefono: '0991111111',
    })
    .returning();
  const [elPacifico] = await db
    .insert(schema.cooperativas)
    .values({
      ruc: RUC_EL_PACIFICO,
      razonSocial: 'PRUEBA F1 Coop El Pacífico S.A.',
      nombreComercial: 'PRUEBA F1 Coop El Pacífico',
      // Suspendida a propósito: para probar que el gate de RN-01/RF-002
      // (Fase 1) de verdad le impide aparecer en búsquedas y vender,
      // aunque tenga un viaje programado más abajo.
      estado: 'suspendida',
      modeloIntegracion: 'modelo_a',
      fechaAfiliacion: new Date(),
      contactoNombre: 'PRUEBA Gerente El Pacífico',
      contactoCorreo: 'admin.pacifico.f1@prueba.klumbus.tech',
      contactoTelefono: '0992222222',
    })
    .returning();

  // --- Usuarios: uno por cada rol ---
  const [usuarioSuperAdmin] = await db
    .insert(schema.usuarios)
    .values({ rol: 'super_admin', correo: CORREOS_USUARIOS[0], cedula: '1701016444', nombreCompleto: 'PRUEBA F1 Super Admin', passwordHash, correoVerificado: true })
    .returning();
  const [usuarioAdminPlataforma] = await db
    .insert(schema.usuarios)
    .values({ rol: 'admin_plataforma', correo: CORREOS_USUARIOS[1], cedula: '1701019182', nombreCompleto: 'PRUEBA F1 Admin Plataforma', passwordHash, correoVerificado: true })
    .returning();
  const [usuarioAdminTransOro] = await db
    .insert(schema.usuarios)
    .values({ rol: 'admin_cooperativa', cooperativaId: transOro.id, correo: CORREOS_USUARIOS[2], cedula: '1701006429', nombreCompleto: 'PRUEBA F1 Admin Trans Oro', passwordHash, correoVerificado: true })
    .returning();
  const [usuarioAdminPacifico] = await db
    .insert(schema.usuarios)
    .values({ rol: 'admin_cooperativa', cooperativaId: elPacifico.id, correo: CORREOS_USUARIOS[3], cedula: '1701013706', nombreCompleto: 'PRUEBA F1 Admin El Pacífico', passwordHash, correoVerificado: true })
    .returning();
  const [usuarioVendedor] = await db
    .insert(schema.usuarios)
    .values({ rol: 'vendedor', cooperativaId: transOro.id, correo: CORREOS_USUARIOS[4], cedula: '1701015073', nombreCompleto: 'PRUEBA F1 Vendedor Trans Oro', passwordHash, correoVerificado: true })
    .returning();
  const [usuarioPasajeroAna] = await db
    .insert(schema.usuarios)
    .values({ rol: 'pasajero', correo: CORREOS_USUARIOS[5], cedula: '1701002741', telefono: '0991234567', nombreCompleto: 'PRUEBA F1 Ana Viajera', passwordHash, correoVerificado: true })
    .returning();
  const [usuarioPasajeroLuis] = await db
    .insert(schema.usuarios)
    .values({ rol: 'pasajero', correo: CORREOS_USUARIOS[6], cedula: '1701004119', telefono: '0997654321', nombreCompleto: 'PRUEBA F1 Luis Pasajero', passwordHash, correoVerificado: true })
    .returning();

  // --- Flota de Trans Oro: 1 tipo sencillo + 1 doble piso VIP ---
  const [tipoSencilloTransOro] = await db
    .insert(schema.tiposVehiculo)
    .values({ cooperativaId: transOro.id, nombre: 'PRUEBA F1 Bus sencillo', categoria: 'bus', capacidadTotal: 20, distribucionAsientos: DISTRIBUCION_SENCILLA, amenidades: ['wifi'] })
    .returning();
  const [tipoVipTransOro] = await db
    .insert(schema.tiposVehiculo)
    .values({ cooperativaId: transOro.id, nombre: 'PRUEBA F1 Doble piso VIP', categoria: 'bus', capacidadTotal: 20, distribucionAsientos: DISTRIBUCION_DOBLE_PISO_VIP, amenidades: ['wifi', 'aire_acondicionado', 'bano_a_bordo'] })
    .returning();
  const [unidad101] = await db
    .insert(schema.unidades)
    .values({ cooperativaId: transOro.id, tipoVehiculoId: tipoSencilloTransOro.id, placa: 'PRB-0101', identificadorOperativo: 'F1-101' })
    .returning();
  const [unidad102] = await db
    .insert(schema.unidades)
    .values({ cooperativaId: transOro.id, tipoVehiculoId: tipoVipTransOro.id, placa: 'PRB-0102', identificadorOperativo: 'F1-102' })
    .returning();

  const [conductor1] = await db
    .insert(schema.conductores)
    .values({ cooperativaId: transOro.id, nombreCompleto: 'PRUEBA F1 Carlos Ramírez', cedula: '0700000001', licenciaNumero: 'LIC-0001', licenciaCategoria: 'E1', telefono: '0993333333' })
    .returning();
  await db
    .insert(schema.conductores)
    .values({ cooperativaId: transOro.id, nombreCompleto: 'PRUEBA F1 Jorge Salinas', cedula: '0700000002', licenciaNumero: 'LIC-0002', licenciaCategoria: 'E1', telefono: '0994444444' });

  // --- Flota de El Pacífico: solo lo mínimo para el viaje de prueba (suspendida, no debería poder venderlo) ---
  const [tipoSencilloPacifico] = await db
    .insert(schema.tiposVehiculo)
    .values({ cooperativaId: elPacifico.id, nombre: 'PRUEBA F1 Bus sencillo', categoria: 'bus', capacidadTotal: 20, distribucionAsientos: DISTRIBUCION_SENCILLA })
    .returning();
  const [unidadPacifico] = await db
    .insert(schema.unidades)
    .values({ cooperativaId: elPacifico.id, tipoVehiculoId: tipoSencilloPacifico.id, placa: 'PRB-0201', identificadorOperativo: 'F1-201' })
    .returning();

  // --- Métodos de pago manuales de Trans Oro (para probar checkout de invitado con transferencia/efectivo) ---
  await db.insert(schema.metodosPagoCooperativa).values([
    {
      cooperativaId: transOro.id,
      tipo: 'transferencia_bancaria',
      entidadFinanciera: 'banco_pichincha',
      datosCuenta: { banco: 'Banco Pichincha', tipoCuenta: 'Ahorros', numeroCuenta: '2201234567', titular: 'PRUEBA F1 Trans Oro S.A.', cedulaTitular: RUC_TRANS_ORO },
    },
    {
      cooperativaId: transOro.id,
      tipo: 'efectivo',
      datosCuenta: { instrucciones: 'Pagar en efectivo directo en la ventanilla del terminal.' },
    },
  ]);

  // --- Rutas de Trans Oro ---
  const [rutaMachalaQuito] = await db
    .insert(schema.rutas)
    .values({ cooperativaId: transOro.id, nombre: 'PRUEBA F1 Machala - Quito', origenPuntoOperacionId: terminalMachala.id, destinoPuntoOperacionId: terminalQuito.id, precioBaseReferencia: '12.50', duracionEstimadaMinutos: 260, distanciaKm: 420 })
    .returning();
  const [rutaMachalaGuayaquil] = await db
    .insert(schema.rutas)
    .values({ cooperativaId: transOro.id, nombre: 'PRUEBA F1 Machala - Guayaquil', origenPuntoOperacionId: terminalMachala.id, destinoPuntoOperacionId: terminalGuayaquil.id, precioBaseReferencia: '6.00', duracionEstimadaMinutos: 190, distanciaKm: 195 })
    .returning();
  const [rutaGuayaquilCuenca] = await db
    .insert(schema.rutas)
    .values({ cooperativaId: transOro.id, nombre: 'PRUEBA F1 Guayaquil - Cuenca', origenPuntoOperacionId: terminalGuayaquil.id, destinoPuntoOperacionId: terminalCuenca.id, precioBaseReferencia: '8.50', duracionEstimadaMinutos: 180, distanciaKm: 150 })
    .returning();

  // --- Ruta de El Pacífico (suspendida) ---
  const [rutaPacificoMachalaGuayaquil] = await db
    .insert(schema.rutas)
    .values({ cooperativaId: elPacifico.id, nombre: 'PRUEBA F1 Machala - Guayaquil (El Pacífico)', origenPuntoOperacionId: terminalMachala.id, destinoPuntoOperacionId: terminalGuayaquil.id, precioBaseReferencia: '6.00', duracionEstimadaMinutos: 190, distanciaKm: 195 })
    .returning();

  // --- Viajes: varias salidas en los próximos días ---
  function horaEn(dias: number, hora: number, minuto = 0): { fecha: string; timestamp: Date } {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    d.setHours(hora, minuto, 0, 0);
    return { fecha: d.toISOString().slice(0, 10), timestamp: d };
  }

  const viajesACrear = [
    // Machala -> Quito, mezcla de unidad sencilla y VIP.
    { ruta: rutaMachalaQuito, cooperativaId: transOro.id, unidadId: unidad101.id, conductorId: conductor1.id, precioBase: '12.50', recargoVip: '0', ...horaEn(1, 6, 30) },
    { ruta: rutaMachalaQuito, cooperativaId: transOro.id, unidadId: unidad102.id, conductorId: conductor1.id, precioBase: '12.50', recargoVip: '5.00', ...horaEn(1, 14, 0) },
    { ruta: rutaMachalaQuito, cooperativaId: transOro.id, unidadId: unidad101.id, conductorId: null, precioBase: '12.50', recargoVip: '0', ...horaEn(2, 8, 0) },
    // Machala -> Guayaquil.
    { ruta: rutaMachalaGuayaquil, cooperativaId: transOro.id, unidadId: unidad101.id, conductorId: conductor1.id, precioBase: '6.00', recargoVip: '0', ...horaEn(1, 9, 0) },
    { ruta: rutaMachalaGuayaquil, cooperativaId: transOro.id, unidadId: unidad101.id, conductorId: null, precioBase: '6.00', recargoVip: '0', ...horaEn(2, 16, 30) },
    // Guayaquil -> Cuenca.
    { ruta: rutaGuayaquilCuenca, cooperativaId: transOro.id, unidadId: unidad102.id, conductorId: null, precioBase: '8.50', recargoVip: '5.00', ...horaEn(1, 11, 0) },
    { ruta: rutaGuayaquilCuenca, cooperativaId: transOro.id, unidadId: unidad102.id, conductorId: null, precioBase: '8.50', recargoVip: '5.00', ...horaEn(3, 7, 0) },
    // El Pacífico (suspendida) -- este viaje NO debería poder venderse ni aparecer en búsquedas.
    { ruta: rutaPacificoMachalaGuayaquil, cooperativaId: elPacifico.id, unidadId: unidadPacifico.id, conductorId: null, precioBase: '6.00', recargoVip: '0', ...horaEn(1, 10, 0) },
  ];

  for (const v of viajesACrear) {
    await db.insert(schema.viajes).values({
      cooperativaId: v.cooperativaId,
      rutaId: v.ruta.id,
      unidadId: v.unidadId,
      conductorId: v.conductorId,
      fechaSalida: v.fecha,
      horaSalidaProgramada: v.timestamp,
      precioBase: v.precioBase,
      recargoVip: v.recargoVip,
    });
  }

  console.log('✅ Datos de prueba de la Fase 1 creados.');
  console.log('');
  console.log(`Contraseña de todas las cuentas: ${PASSWORD_PRUEBA}`);
  console.log('');
  console.log('Usuarios:');
  console.log(`  super_admin        -- ${usuarioSuperAdmin.correo}`);
  console.log(`  admin_plataforma   -- ${usuarioAdminPlataforma.correo}`);
  console.log(`  admin_cooperativa  -- ${usuarioAdminTransOro.correo} (PRUEBA F1 Trans Oro, habilitada)`);
  console.log(`  admin_cooperativa  -- ${usuarioAdminPacifico.correo} (PRUEBA F1 Coop El Pacífico, SUSPENDIDA)`);
  console.log(`  vendedor           -- ${usuarioVendedor.correo} (PRUEBA F1 Trans Oro)`);
  console.log(`  pasajero           -- ${usuarioPasajeroAna.correo}`);
  console.log(`  pasajero           -- ${usuarioPasajeroLuis.correo}`);
  console.log('');
  console.log('Las 3 cuentas administrativas piden configurar 2FA en el primer login real (obligatorio).');
}

main()
  .catch((err) => {
    console.error('❌ Falló el seed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
