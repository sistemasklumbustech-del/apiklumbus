/**
 * Datos ficticios para poder construir y probar el reporte de
 * conciliación (RF-017) de punta a punta -- 2 cooperativas de prueba,
 * 1 viaje cada una, y 5 compras que cubren escenarios reales de
 * discrepancia, no solo el camino feliz.
 *
 * Todo lo que crea este script es reconocible como dato de prueba: RUCs
 * 179000000000{1,2}, correos @prueba.klumbus.tech, nombres con el
 * prefijo "PRUEBA". `npm run seed:rf017` limpia sus propias filas antes
 * de insertar, así que correrlo varias veces es seguro.
 *
 * Se conecta directo con el rol ticketya_platform_admin (bypassa RLS
 * por política, ver rls.ts) porque necesita escribir en 2 cooperativas
 * distintas en la misma corrida -- mismo nivel de acceso que usa
 * DRIZZLE_DB_PUBLICO en el backend real, nunca el rol de aplicación.
 *
 * Uso:
 *   DATABASE_URL_PUBLICO=postgresql://ticketya_platform_admin:...@host:5432/ticketya \
 *     npx tsx seeds/rf017-conciliacion.seed.ts
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../schema';

const CONNECTION_STRING = process.env.DATABASE_URL_PUBLICO;
if (!CONNECTION_STRING) {
  console.error('❌ Falta DATABASE_URL_PUBLICO (rol ticketya_platform_admin).');
  process.exit(1);
}

const pool = new Pool({ connectionString: CONNECTION_STRING });
const db = drizzle(pool, { schema });

const RUC_ANDINA = '1790000000001';
const RUC_COSTENA = '1790000000002';
const CORREOS_PRUEBA = [
  'pasajero1@prueba.klumbus.tech',
  'pasajero2@prueba.klumbus.tech',
  'pasajero3@prueba.klumbus.tech',
  'pasajero4@prueba.klumbus.tech',
  'pasajero5@prueba.klumbus.tech',
];

const DISTRIBUCION_ASIENTOS_SIMPLE = {
  pisos: [
    {
      filas: [
        { asientos: [{ numero: '1A', categoria: 'economico' }, { numero: '1B', categoria: 'economico' }] },
        { asientos: [{ numero: '2A', categoria: 'economico' }, { numero: '2B', categoria: 'economico' }] },
        { asientos: [{ numero: '3A', categoria: 'economico' }, { numero: '3B', categoria: 'economico' }] },
      ],
    },
  ],
};

/** Borra todo lo que este script pudo haber insertado en una corrida anterior, en orden de dependencia. */
async function limpiar() {
  const cooperativasPrueba = await db
    .select({ id: schema.cooperativas.id })
    .from(schema.cooperativas)
    .where(inArray(schema.cooperativas.ruc, [RUC_ANDINA, RUC_COSTENA]));
  const cooperativaIds = cooperativasPrueba.map((c) => c.id);

  const usuariosPrueba = await db
    .select({ id: schema.usuarios.id })
    .from(schema.usuarios)
    .where(inArray(schema.usuarios.correo, CORREOS_PRUEBA));
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

  const registrosPrueba = compraIds.length
    ? await db
        .select({ id: schema.registrosTasaTerminal.id })
        .from(schema.registrosTasaTerminal)
        .where(inArray(schema.registrosTasaTerminal.compraId, compraIds))
    : [];
  const registroIds = registrosPrueba.map((r) => r.id);

  if (boletoIds.length) {
    await db.delete(schema.comprobantesTasaTerminal).where(inArray(schema.comprobantesTasaTerminal.boletoId, boletoIds));
  }
  if (compraIds.length) {
    await db.delete(schema.comprobantesElectronicos).where(inArray(schema.comprobantesElectronicos.compraId, compraIds));
    await db.delete(schema.pagos).where(inArray(schema.pagos.compraId, compraIds));
  }
  if (registroIds.length) {
    await db.delete(schema.registrosTasaTerminal).where(inArray(schema.registrosTasaTerminal.id, registroIds));
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
    await db.delete(schema.unidades).where(inArray(schema.unidades.cooperativaId, cooperativaIds));
    await db.delete(schema.tiposVehiculo).where(inArray(schema.tiposVehiculo.cooperativaId, cooperativaIds));
    await db.delete(schema.rutas).where(inArray(schema.rutas.cooperativaId, cooperativaIds));
  }
  if (usuarioIds.length) {
    await db.delete(schema.usuarios).where(inArray(schema.usuarios.id, usuarioIds));
  }
  if (cooperativaIds.length) {
    await db.delete(schema.cooperativas).where(inArray(schema.cooperativas.id, cooperativaIds));
  }
  // Los puntos de operación de prueba no tienen un marcador propio único
  // más allá del nombre -- se limpian por nombre exacto.
  await db
    .delete(schema.puntosOperacion)
    .where(inArray(schema.puntosOperacion.nombre, ['PRUEBA Terminal Machala', 'PRUEBA Agencia Quito', 'PRUEBA Agencia Guayaquil']));

  console.log('🧹 Datos de una corrida anterior eliminados.');
}

async function crearCooperativa(ruc: string, nombreComercial: string) {
  const [coop] = await db
    .insert(schema.cooperativas)
    .values({
      ruc,
      razonSocial: `${nombreComercial} S.A. (PRUEBA)`,
      nombreComercial,
      estado: 'aprobada',
      modeloIntegracion: 'modelo_a',
      fechaAfiliacion: new Date(),
    })
    .returning();
  return coop;
}

async function main() {
  await limpiar();

  // --- Puntos de operación compartidos ---
  const [terminalMachala] = await db
    .insert(schema.puntosOperacion)
    .values({
      tipo: 'terminal_terrestre',
      nombre: 'PRUEBA Terminal Machala',
      ciudad: 'Machala',
      provincia: 'El Oro',
      estado: 'aprobado',
    })
    .returning();
  const [agenciaQuito] = await db
    .insert(schema.puntosOperacion)
    .values({ tipo: 'oficina_agencia', nombre: 'PRUEBA Agencia Quito', ciudad: 'Quito', provincia: 'Pichincha', estado: 'aprobado' })
    .returning();
  const [agenciaGuayaquil] = await db
    .insert(schema.puntosOperacion)
    .values({
      tipo: 'oficina_agencia',
      nombre: 'PRUEBA Agencia Guayaquil',
      ciudad: 'Guayaquil',
      provincia: 'Guayas',
      estado: 'aprobado',
    })
    .returning();
  void terminalMachala; // reservado para cuando se conecten credenciales_integracion_terminal reales

  // --- 2 cooperativas de prueba ---
  const andina = await crearCooperativa(RUC_ANDINA, 'PRUEBA Cooperativa Andina');
  const costena = await crearCooperativa(RUC_COSTENA, 'PRUEBA Cooperativa Costeña');

  // --- 5 pasajeros ficticios ---
  const pasajeros = await db
    .insert(schema.usuarios)
    .values(
      CORREOS_PRUEBA.map((correo, i) => ({
        rol: 'pasajero' as const,
        correo,
        cedula: `175000000${i + 1}`,
        nombreCompleto: `PRUEBA Pasajero ${i + 1}`,
        correoVerificado: true,
      })),
    )
    .returning();

  async function crearViajeConAsientos(cooperativaId: string) {
    const [tipoVehiculo] = await db
      .insert(schema.tiposVehiculo)
      .values({
        cooperativaId,
        nombre: 'PRUEBA Bus estándar',
        categoria: 'bus',
        capacidadTotal: 6,
        distribucionAsientos: DISTRIBUCION_ASIENTOS_SIMPLE,
      })
      .returning();
    const [unidad] = await db
      .insert(schema.unidades)
      .values({ cooperativaId, tipoVehiculoId: tipoVehiculo.id, placa: 'PRB-0001', identificadorOperativo: '1' })
      .returning();
    const [ruta] = await db
      .insert(schema.rutas)
      .values({
        cooperativaId,
        nombre: 'PRUEBA Quito - Guayaquil',
        origenPuntoOperacionId: agenciaQuito.id,
        destinoPuntoOperacionId: agenciaGuayaquil.id,
        precioBaseReferencia: '10.00',
      })
      .returning();
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const [viaje] = await db
      .insert(schema.viajes)
      .values({
        cooperativaId,
        rutaId: ruta.id,
        unidadId: unidad.id,
        fechaSalida: ayer.toISOString().slice(0, 10),
        horaSalidaProgramada: ayer,
        precioBase: '10.00',
        estado: 'finalizado',
      })
      .returning();
    const asientos = await db
      .insert(schema.viajeAsientos)
      .values(
        ['1A', '1B', '2A', '2B', '3A'].map((numeroAsiento) => ({
          viajeId: viaje.id,
          numeroAsiento,
          estado: 'ocupado' as const,
        })),
      )
      .returning();
    return { viaje, asientos };
  }

  const { asientos: asientosAndina } = await crearViajeConAsientos(andina.id);
  const { asientos: asientosCostena } = await crearViajeConAsientos(costena.id);

  /**
   * Crea una compra completa de 1 pasajero: pasajero_compra + boleto +
   * pago, y devuelve los ids para que cada escenario decida qué le
   * agrega encima (registro de tasa, comprobante, comprobante
   * electrónico) o deliberadamente le falta.
   */
  async function crearCompraBase(opts: {
    cooperativaId: string;
    compradorUsuarioId: string;
    viajeAsientoId: string;
    facturaNumero: string;
    estadoPago: 'pendiente' | 'aprobado' | 'rechazado' | 'revertido';
    estadoBoleto: 'vigente' | 'usado' | 'cancelado';
  }) {
    const [compra] = await db
      .insert(schema.compras)
      .values({
        compradorUsuarioId: opts.compradorUsuarioId,
        canal: 'en_linea',
        montoTotal: '11.50',
        montoTarifasCooperativa: '10.00',
        montoCargoPlataforma: '0.50',
        montoTasaTerminal: '1.00',
        montoImpuestos: '0.00',
      })
      .returning();
    const [pasajeroCompra] = await db
      .insert(schema.pasajerosCompra)
      .values({
        compraId: compra.id,
        nombres: 'PRUEBA',
        apellidos: 'Pasajero',
        documento: '1750000000',
        tipoTarifa: 'adulto',
      })
      .returning();
    const [boleto] = await db
      .insert(schema.boletos)
      .values({
        cooperativaId: opts.cooperativaId,
        compraId: compra.id,
        pasajeroCompraId: pasajeroCompra.id,
        viajeAsientoId: opts.viajeAsientoId,
        codigoQr: `PRUEBA-QR-${opts.facturaNumero}`,
        precioPagado: '10.00',
        cargoPlataforma: '0.50',
        ivaMonto: '0.00',
        estado: opts.estadoBoleto,
      })
      .returning();
    await db.insert(schema.pagos).values({
      compraId: compra.id,
      proveedor: 'payphone',
      idempotencyKey: `PRUEBA-PAGO-${opts.facturaNumero}`,
      monto: '11.50',
      estado: opts.estadoPago,
    });
    return { compra, pasajeroCompra, boleto };
  }

  async function crearRegistroYComprobante(opts: {
    cooperativaId: string;
    compraId: string;
    boletoId: string;
    facturaNumero: string;
    estado: 'exitosa' | 'fallida' | 'pendiente';
    codigoTasa?: string;
  }) {
    const [registro] = await db
      .insert(schema.registrosTasaTerminal)
      .values({
        cooperativaId: opts.cooperativaId,
        compraId: opts.compraId,
        claveIdempotencia: `PRUEBA-TASA-${opts.facturaNumero}`,
        estado: opts.estado,
        mensajeTerminal:
          opts.estado === 'exitosa' ? 'Simulado para prueba de conciliación.' : 'Simulado: fallo intencional para prueba.',
        solicitudPayload: { factura: opts.facturaNumero, prueba: true },
        ...(opts.codigoTasa ? { codigoTasa: opts.codigoTasa } : {}),
      })
      .returning();
    if (opts.estado === 'exitosa' && opts.codigoTasa) {
      await db.insert(schema.comprobantesTasaTerminal).values({
        boletoId: opts.boletoId,
        puntoOperacionId: terminalMachala.id,
        registroTasaTerminalId: registro.id,
        monto: '1.00',
        codigoVerificacion: opts.codigoTasa,
      });
    }
    return registro;
  }

  // === Escenario A (Andina) -- camino feliz, todo conciliado ===
  const a = await crearCompraBase({
    cooperativaId: andina.id,
    compradorUsuarioId: pasajeros[0].id,
    viajeAsientoId: asientosAndina[0].id,
    facturaNumero: '000000001',
    estadoPago: 'aprobado',
    estadoBoleto: 'usado',
  });
  await crearRegistroYComprobante({
    cooperativaId: andina.id,
    compraId: a.compra.id,
    boletoId: a.boleto.id,
    facturaNumero: '000000001',
    estado: 'exitosa',
    codigoTasa: '10000000000000000001',
  });
  await db.insert(schema.comprobantesElectronicos).values({
    compraId: a.compra.id,
    sujetoTributario: 'plataforma',
    rucEmisor: '1792146739001',
    montoComprobante: '0.50',
    claveAcceso: '1'.repeat(49),
    estado: 'autorizado',
  });
  console.log('✅ Escenario A (Andina) -- camino feliz, todo conciliado.');

  // === Escenario B (Costeña) -- pago aprobado, boleto vigente, pero SIN registro de tasa ===
  await crearCompraBase({
    cooperativaId: costena.id,
    compradorUsuarioId: pasajeros[1].id,
    viajeAsientoId: asientosCostena[0].id,
    facturaNumero: '000000002',
    estadoPago: 'aprobado',
    estadoBoleto: 'vigente',
  });
  console.log('✅ Escenario B (Costeña) -- pago aprobado sin registro de tasa (discrepancia esperada).');

  // === Escenario C (Andina) -- tasa exitosa, pero comprobante electrónico RECHAZADO ===
  const c = await crearCompraBase({
    cooperativaId: andina.id,
    compradorUsuarioId: pasajeros[2].id,
    viajeAsientoId: asientosAndina[1].id,
    facturaNumero: '000000003',
    estadoPago: 'aprobado',
    estadoBoleto: 'vigente',
  });
  await crearRegistroYComprobante({
    cooperativaId: andina.id,
    compraId: c.compra.id,
    boletoId: c.boleto.id,
    facturaNumero: '000000003',
    estado: 'exitosa',
    codigoTasa: '10000000000000000003',
  });
  await db.insert(schema.comprobantesElectronicos).values({
    compraId: c.compra.id,
    sujetoTributario: 'plataforma',
    rucEmisor: '1792146739001',
    montoComprobante: '0.50',
    estado: 'rechazado',
    ultimoErrorProveedor: 'PRUEBA: rechazo simulado del SRI para probar el reporte de conciliación.',
  });
  console.log('✅ Escenario C (Andina) -- comprobante electrónico rechazado (discrepancia esperada).');

  // === Escenario D (Costeña) -- pago RECHAZADO pero el boleto quedó vigente (inconsistencia de datos) ===
  await crearCompraBase({
    cooperativaId: costena.id,
    compradorUsuarioId: pasajeros[3].id,
    viajeAsientoId: asientosCostena[1].id,
    facturaNumero: '000000004',
    estadoPago: 'rechazado',
    estadoBoleto: 'vigente',
  });
  console.log('✅ Escenario D (Costeña) -- boleto vigente con pago rechazado (inconsistencia esperada).');

  // === Escenario E (Andina) -- boleto cancelado, tasa se registró pero (correctamente) nunca se anula ===
  const e = await crearCompraBase({
    cooperativaId: andina.id,
    compradorUsuarioId: pasajeros[4].id,
    viajeAsientoId: asientosAndina[2].id,
    facturaNumero: '000000005',
    estadoPago: 'revertido',
    estadoBoleto: 'cancelado',
  });
  await crearRegistroYComprobante({
    cooperativaId: andina.id,
    compraId: e.compra.id,
    boletoId: e.boleto.id,
    facturaNumero: '000000005',
    estado: 'exitosa',
    codigoTasa: '10000000000000000005',
  });
  console.log('✅ Escenario E (Andina) -- boleto cancelado con tasa ya cobrada (RF-014: la tasa no se anula, no es un error).');

  console.log('\n🌱 Seed de conciliación (RF-017) completo.');
}

main()
  .catch((err) => {
    console.error('\n❌ El seed falló:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
