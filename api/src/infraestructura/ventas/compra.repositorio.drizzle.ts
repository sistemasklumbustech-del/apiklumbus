import { Inject, Injectable, BadRequestException, Logger } from '@nestjs/common';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { NotificadorEmail } from '../../dominio/auth/auth.ports';
import { NOTIFICADOR_EMAIL } from '../../aplicacion/auth/auth.service';
import { randomUUID } from 'node:crypto';
import {
  viajes,
  viajeAsientos,
  rutas,
  puntosOperacion,
  cooperativas,
  compras,
  pasajerosCompra,
  pagos,
  boletos,
  comprobantesTasaTerminal,
  autorizacionesMenor,
  configuracionPlataforma,
  notificaciones,
  creditosPasajero,
  unidades,
  usuarios,
  tiposVehiculo,
} from '@columbus/db';
import {
  obtenerPisos,
  interpretarCelda,
} from '../../dominio/asientos/distribucion-asientos.util';
const puntosOperacionOrigen = alias(puntosOperacion, 'po_origen_idem');
const puntosOperacionDestino = alias(puntosOperacion, 'po_destino_idem');
import { DRIZZLE_DB_PUBLICO, DRIZZLE_DB } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import { ejecutarComoCooperativa } from '../database/tenant-transaction';
import type {
  CompraRepositorio,
  PasajeroCheckout,
  DesgloseAsiento,
  MapeoAsientoPasajero,
  PagoExistente,
  BoletoEmitido,
  ReciboCompra,
  PagoManualPendiente,
  SolicitudFactura,
} from '../../dominio/ventas/ventas.ports';
import {
  factorDescuento,
  esMenorDeEdad,
} from '../../dominio/ventas/ventas.ports';

@Injectable()
export class CompraRepositorioDrizzle implements CompraRepositorio {
  private readonly logger = new Logger(CompraRepositorioDrizzle.name);

  constructor(
    @Inject(DRIZZLE_DB_PUBLICO) private readonly dbPublico: DrizzleDb,
    @Inject(DRIZZLE_DB) private readonly dbApp: DrizzleDb,
    @Inject(NOTIFICADOR_EMAIL) private readonly email: NotificadorEmail,
  ) {}

  async buscarPagoPorIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PagoExistente | null> {
    const pago = await this.dbPublico.query.pagos.findFirst({
      where: eq(pagos.idempotencyKey, idempotencyKey),
    });
    if (!pago) return null;

    const boletosDeLaCompra = await this.dbPublico
      .select({
        id: boletos.id,
        codigoQr: boletos.codigoQr,
        numeroAsiento: viajeAsientos.numeroAsiento,
        precioPagado: boletos.precioPagado,
        cargoPlataforma: boletos.cargoPlataforma,
        ivaMonto: boletos.ivaMonto,
        tasaTerminal: comprobantesTasaTerminal.monto,
        cooperativaNombre: cooperativas.nombreComercial,
        rutaOrigenCiudad: puntosOperacionOrigen.ciudad,
        rutaDestinoCiudad: puntosOperacionDestino.ciudad,
        fechaSalida: viajes.fechaSalida,
        horaSalidaProgramada: viajes.horaSalidaProgramada,
        unidadPlaca: unidades.placa,
        unidadIdentificador: unidades.identificadorOperativo,
        pasajeroNombres: pasajerosCompra.nombres,
        pasajeroApellidos: pasajerosCompra.apellidos,
        pasajeroDocumento: pasajerosCompra.documento,
        compradorNombreCuenta: usuarios.nombreCompleto,
        compradorCedulaCuenta: usuarios.cedula,
        esVip: boletos.esVip,
      })
      .from(boletos)
      .innerJoin(viajeAsientos, eq(boletos.viajeAsientoId, viajeAsientos.id))
      .innerJoin(viajes, eq(viajeAsientos.viajeId, viajes.id))
      .innerJoin(rutas, eq(viajes.rutaId, rutas.id))
      .innerJoin(puntosOperacionOrigen, eq(rutas.origenPuntoOperacionId, puntosOperacionOrigen.id))
      .innerJoin(puntosOperacionDestino, eq(rutas.destinoPuntoOperacionId, puntosOperacionDestino.id))
      .innerJoin(cooperativas, eq(viajes.cooperativaId, cooperativas.id))
      .leftJoin(unidades, eq(viajes.unidadId, unidades.id))
      .innerJoin(pasajerosCompra, eq(boletos.pasajeroCompraId, pasajerosCompra.id))
      .innerJoin(compras, eq(boletos.compraId, compras.id))
      .leftJoin(usuarios, eq(compras.compradorUsuarioId, usuarios.id))
      .leftJoin(
        comprobantesTasaTerminal,
        eq(comprobantesTasaTerminal.boletoId, boletos.id),
      )
      .where(eq(boletos.compraId, pago.compraId));

    return {
      compraId: pago.compraId,
      estado: pago.estado,
      boletos: boletosDeLaCompra.map((b) => ({
        id: b.id,
        codigoQr: b.codigoQr,
        numeroAsiento: b.numeroAsiento,
        precioPagado: Number(b.precioPagado),
        cargoPlataforma: Number(b.cargoPlataforma),
        ivaMonto: Number(b.ivaMonto),
        tasaTerminal: Number(b.tasaTerminal ?? 0),
        cooperativaNombre: b.cooperativaNombre,
        rutaOrigenCiudad: b.rutaOrigenCiudad,
        rutaDestinoCiudad: b.rutaDestinoCiudad,
        fechaSalida: b.fechaSalida,
        horaSalidaProgramada: b.horaSalidaProgramada.toISOString(),
        unidadPlaca: b.unidadPlaca,
        unidadIdentificador: b.unidadIdentificador,
        compradorNombre: b.compradorNombreCuenta ?? `${b.pasajeroNombres} ${b.pasajeroApellidos}`,
        compradorDocumento: b.compradorCedulaCuenta ?? b.pasajeroDocumento,
        esVip: b.esVip,
      })),
    };
  }

  async validarYCalcularAsientos(
    asientos: PasajeroCheckout[],
    usuarioId: string | null,
    sesionInvitadoId: string | null,
  ): Promise<DesgloseAsiento[]> {
    const configuracion =
      await this.dbPublico.query.configuracionPlataforma.findFirst();
    const cargoPlataforma = Number(
      configuracion?.cargoPlataformaPorPasajeroDefault ?? 0,
    );

    const resultado: DesgloseAsiento[] = [];

    for (const asiento of asientos) {
      const fila = await this.dbPublico
        .select({
          cooperativaId: viajes.cooperativaId,
          precioBase: viajes.precioBase,
          recargoVip: viajes.recargoVip,
          distribucionAsientos: tiposVehiculo.distribucionAsientos,
          capacidadTotal: tiposVehiculo.capacidadTotal,
          estadoAsiento: viajeAsientos.estado,
          holdUsuarioId: viajeAsientos.holdUsuarioId,
          holdSesionInvitadoId: viajeAsientos.holdSesionInvitadoId,
          holdExpiraEn: viajeAsientos.holdExpiraEn,
          tasaTerminal: puntosOperacion.tasaMonto,
          ivaPorcentaje: cooperativas.ivaPorcentaje,
          ivaVisibleEnBoleto: cooperativas.ivaVisibleEnBoleto,
        })
        .from(viajeAsientos)
        .innerJoin(viajes, eq(viajeAsientos.viajeId, viajes.id))
        .innerJoin(rutas, eq(viajes.rutaId, rutas.id))
        .innerJoin(
          puntosOperacion,
          eq(rutas.origenPuntoOperacionId, puntosOperacion.id),
        )
        .innerJoin(cooperativas, eq(viajes.cooperativaId, cooperativas.id))
        .innerJoin(unidades, eq(viajes.unidadId, unidades.id))
        .innerJoin(tiposVehiculo, eq(unidades.tipoVehiculoId, tiposVehiculo.id))
        .where(
          and(
            eq(viajeAsientos.viajeId, asiento.viajeId),
            eq(viajeAsientos.numeroAsiento, asiento.numeroAsiento),
          ),
        )
        .limit(1);

      if (fila.length === 0) {
        throw new BadRequestException(
          `El asiento ${asiento.numeroAsiento} no está bloqueado — selecciónalo primero.`,
        );
      }

      const f = fila[0];
      const holdVigente =
        f.holdExpiraEn && new Date(f.holdExpiraEn).getTime() > Date.now();

      // Zona VIP de asientos (17-ago-2026) -- reutiliza EXACTAMENTE la
      // misma lógica real que ya usa el mapa de asientos del pasajero
      // (dominio/asientos/distribucion-asientos.util.ts) para
      // interpretar las etiquetas -- nunca una segunda implementación
      // que pudiera desincronizarse.
      const pisos = obtenerPisos(f.distribucionAsientos, f.capacidadTotal);
      let esVip = false;
      for (const piso of pisos) {
        for (const filaAsientos of piso.filas) {
          for (const celda of filaAsientos.celdas) {
            const interpretada = interpretarCelda(celda, piso);
            if (interpretada?.numero === asiento.numeroAsiento && interpretada.etiquetas.includes('vip')) {
              esVip = true;
            }
          }
        }
      }

      // Item 31, Fase 7 (11-ago-2026) -- mismo criterio de dueno que
      // asiento.repositorio.drizzle.ts::bloquear().
      const esElMismoDueno =
        (usuarioId !== null && f.holdUsuarioId === usuarioId) ||
        (sesionInvitadoId !== null &&
          f.holdSesionInvitadoId === sesionInvitadoId);
      if (
        f.estadoAsiento !== 'bloqueado_temporal' ||
        !esElMismoDueno ||
        !holdVigente
      ) {
        throw new BadRequestException(
          `El bloqueo del asiento ${asiento.numeroAsiento} ya no es válido (expiró o pertenece a otro usuario) — vuelve a seleccionarlo.`,
        );
      }

      const precioPagado =
        (Number(f.precioBase) + (esVip ? Number(f.recargoVip) : 0)) *
        factorDescuento(asiento.tipoTarifa);
      const ivaPorcentaje = Number(f.ivaPorcentaje ?? 0);
      // El precio YA trae el IVA incluido — se despeja la porción de IVA
      // sobre el total, no se suma aparte. Ej.: precio 11.50, IVA 15% →
      // base = 11.50 / 1.15 = 10, iva = 11.50 - 10 = 1.50.
      const ivaMonto =
        ivaPorcentaje > 0
          ? precioPagado - precioPagado / (1 + ivaPorcentaje / 100)
          : 0;

      resultado.push({
        viajeId: asiento.viajeId,
        numeroAsiento: asiento.numeroAsiento,
        cooperativaId: f.cooperativaId,
        precioPagado,
        tasaTerminal: Number(f.tasaTerminal ?? 0),
        cargoPlataforma,
        ivaMonto: Number(ivaMonto.toFixed(2)),
        ivaVisible: f.ivaVisibleEnBoleto,
        esVip,
      });
    }

    return resultado;
  }

  async crearCompraPendiente(
    usuarioId: string | null,
    pasajeros: PasajeroCheckout[],
    desglose: DesgloseAsiento[],
    idempotencyKey: string,
    proveedor: string = 'simulado',
    telefonoContacto?: string,
    correoContacto?: string,
  ): Promise<{ compraId: string; mapeo: MapeoAsientoPasajero[] }> {
    const montoTarifasCooperativa = desglose.reduce(
      (a, d) => a + d.precioPagado,
      0,
    );
    const montoTasaTerminal = desglose.reduce((a, d) => a + d.tasaTerminal, 0);
    const montoCargoPlataforma = desglose.reduce(
      (a, d) => a + d.cargoPlataforma,
      0,
    );
    // El IVA ya viene incluido dentro de montoTarifasCooperativa (no se
    // suma aparte al total) — esta columna es el desglose informativo de
    // cuánto de ese monto corresponde a IVA, para el comprobante y la
    // auditoría (RN-002).
    const montoImpuestos = desglose.reduce((a, d) => a + d.ivaMonto, 0);
    const montoTotal =
      montoTarifasCooperativa + montoTasaTerminal + montoCargoPlataforma;

    const [compra] = await this.dbPublico
      .insert(compras)
      .values({
        compradorUsuarioId: usuarioId,
        // Item 31, Fase 7 (11-ago-2026) -- compra como invitado.
        telefonoContacto: telefonoContacto ?? null,
        correoContacto: correoContacto ?? null,
        canal: 'en_linea',
        montoTotal: montoTotal.toFixed(2),
        montoTarifasCooperativa: montoTarifasCooperativa.toFixed(2),
        montoCargoPlataforma: montoCargoPlataforma.toFixed(2),
        montoTasaTerminal: montoTasaTerminal.toFixed(2),
        montoImpuestos: montoImpuestos.toFixed(2),
      })
      .returning();

    const mapeo: MapeoAsientoPasajero[] = [];
    const pasajeroCompraIds: string[] = [];

    for (let i = 0; i < pasajeros.length; i++) {
      const p = pasajeros[i];
      const d = desglose[i];

      // Métodos de pago manuales (29-jul-2026) -- se persiste qué
      // asiento le corresponde a este pasajero, para poder
      // reconstruir la relación horas después (ver comentario en el
      // esquema, columna viajeAsientoId de pasajerosCompra).
      const [asientoFila] = await this.dbPublico.execute(sql`
        SELECT id FROM viaje_asientos WHERE viaje_id = ${p.viajeId} AND numero_asiento = ${p.numeroAsiento}
      `).then((r) => r.rows as { id: string }[]);
      const viajeAsientoId = asientoFila?.id ?? null;

      const [pasajeroCompra] = await this.dbPublico
        .insert(pasajerosCompra)
        .values({
          compraId: compra.id,
          nombres: p.nombres,
          apellidos: p.apellidos,
          tipoDocumento: p.tipoDocumento,
          documento: p.documento,
          tipoTarifa: p.tipoTarifa,
          esEmbarazada: p.esEmbarazada ?? false,
          numeroDocumentoDiscapacidad: p.numeroDocumentoDiscapacidad ?? null,
          fechaNacimiento: p.fechaNacimiento,
          esMenorEdad: esMenorDeEdad(p.tipoTarifa, p.fechaNacimiento),
          viajeAsientoId,
          precioPagado: d.precioPagado.toFixed(2),
          tasaTerminal: d.tasaTerminal.toFixed(2),
          cargoPlataforma: d.cargoPlataforma.toFixed(2),
          ivaMonto: d.ivaMonto.toFixed(2),
          esVip: d.esVip,
        })
        .returning();
      pasajeroCompraIds.push(pasajeroCompra.id);

      mapeo.push({
        viajeId: p.viajeId,
        numeroAsiento: p.numeroAsiento,
        pasajeroCompraId: pasajeroCompra.id,
        cooperativaId: d.cooperativaId,
        precioPagado: d.precioPagado,
        tasaTerminal: d.tasaTerminal,
        cargoPlataforma: d.cargoPlataforma,
        ivaMonto: d.ivaMonto,
        esVip: d.esVip,
      });
    }

    // RF-MENOR — segunda pasada, ya con todos los pasajeroCompra.id
    // conocidos: recién aquí se puede resolver la referencia al adulto
    // acompañante (es otro pasajero DENTRO de esta misma compra).
    for (let i = 0; i < pasajeros.length; i++) {
      const auth = pasajeros[i].autorizacionMenor;
      if (!auth) continue;
      await this.dbPublico.insert(autorizacionesMenor).values({
        pasajeroCompraId: pasajeroCompraIds[i],
        tipoAcompanamiento: auth.tipoAcompanamiento,
        adultoAcompananteEnCompraId:
          auth.adultoAcompananteIndice !== undefined
            ? pasajeroCompraIds[auth.adultoAcompananteIndice]
            : undefined,
        adultoResponsableNombre: auth.adultoResponsableNombre,
        adultoResponsableDocumento: auth.adultoResponsableDocumento,
        adultoResponsableTelefono: auth.adultoResponsableTelefono,
        documentoAutorizacionUrl: auth.documentoAutorizacionUrl,
      });
    }

    await this.dbPublico.insert(pagos).values({
      compraId: compra.id,
      proveedor,
      idempotencyKey,
      monto: montoTotal.toFixed(2),
      estado: 'pendiente',
    });

    return { compraId: compra.id, mapeo };
  }

  // ─────────────────────────────────────────────────────────────
  // Métodos de pago manuales (29-jul-2026) — sin pasarela real
  // conectada, cada cooperativa opera con lo que ya usa hoy en
  // Ecuador (transferencia, efectivo, DeUna, PayPhone). El pasajero
  // sube comprobante, la cooperativa confirma o rechaza -- mismo
  // patrón que Tiendanube/Billowshop, investigado antes de construir.
  // ─────────────────────────────────────────────────────────────

  async verificarMetodoPagoActivo(
    cooperativaId: string,
    tipo: string,
  ): Promise<boolean> {
    const resultado = await this.dbPublico.execute(sql`
      SELECT id FROM metodos_pago_cooperativa
      WHERE cooperativa_id = ${cooperativaId} AND tipo = ${tipo} AND activo = true
    `);
    return resultado.rows.length > 0;
  }

  async marcarAsientosPendientesConfirmacionPago(
    mapeo: MapeoAsientoPasajero[],
  ): Promise<void> {
    for (const item of mapeo) {
      await this.dbPublico.execute(sql`
        UPDATE viaje_asientos
        SET estado = 'pendiente_confirmacion_pago', hold_expira_en = NULL
        WHERE viaje_id = ${item.viajeId} AND numero_asiento = ${item.numeroAsiento}
      `);
    }
  }

  async adjuntarComprobante(
    compraId: string,
    usuarioId: string,
    comprobanteUrl: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    const [compra] = await this.dbPublico
      .select({ compradorUsuarioId: compras.compradorUsuarioId })
      .from(compras)
      .where(eq(compras.id, compraId));
    if (!compra || compra.compradorUsuarioId !== usuarioId) {
      return { ok: false, motivo: 'Esta compra no existe o no te pertenece.' };
    }

    const [pago] = await this.dbPublico
      .select({ estado: pagos.estado, proveedor: pagos.proveedor })
      .from(pagos)
      .where(eq(pagos.compraId, compraId));
    if (!pago || pago.estado !== 'pendiente' || pago.proveedor === 'simulado') {
      return {
        ok: false,
        motivo: 'Este pago no admite subir un comprobante en este momento.',
      };
    }

    await this.dbPublico
      .update(pagos)
      .set({ comprobanteUrl })
      .where(eq(pagos.compraId, compraId));
    return { ok: true };
  }

  async listarPagosPendientesConfirmacion(
    cooperativaId: string,
  ): Promise<PagoManualPendiente[]> {
    // Se consulta por dbPublico (no ejecutarComoCooperativa) porque
    // `pagos`/`compras` no llevan RLS ni cooperativa_id propio (ver
    // nota de diseño al inicio de ventas.ts) -- el filtro por
    // cooperativa se hace aquí explícitamente, vía el asiento
    // reservado de cada pasajero de la compra.
    const resultado = await this.dbPublico.execute(sql`
      SELECT DISTINCT ON (pg.id)
        pg.id AS pago_id, pg.compra_id, pg.proveedor, pg.monto,
        pg.comprobante_url, pg.creado_en,
        u.nombre_completo AS comprador_nombre
      FROM pagos pg
      INNER JOIN compras c ON c.id = pg.compra_id
      INNER JOIN usuarios u ON u.id = c.comprador_usuario_id
      INNER JOIN pasajeros_compra pc ON pc.compra_id = c.id
      INNER JOIN viaje_asientos va ON va.id = pc.viaje_asiento_id
      INNER JOIN viajes v ON v.id = va.viaje_id
      WHERE v.cooperativa_id = ${cooperativaId}
        AND pg.estado = 'pendiente'
        AND pg.proveedor != 'simulado'
        AND pg.comprobante_url IS NOT NULL
      ORDER BY pg.id, pg.creado_en ASC
    `);
    return resultado.rows.map((fila) => {
      const f = fila as {
        pago_id: string;
        compra_id: string;
        proveedor: string;
        monto: string;
        comprobante_url: string;
        creado_en: Date | string;
        comprador_nombre: string;
      };
      return {
        pagoId: f.pago_id,
        compraId: f.compra_id,
        proveedor: f.proveedor,
        monto: Number(f.monto),
        comprobanteUrl: f.comprobante_url,
        compradorNombre: f.comprador_nombre,
        creadoEn: f.creado_en instanceof Date ? f.creado_en.toISOString() : new Date(f.creado_en).toISOString(),
      };
    });
  }

  async confirmarPagoManual(
    pagoId: string,
    cooperativaId: string,
    confirmadoPorUsuarioId: string,
  ): Promise<
    | { ok: true; compraId: string; montoCargoPlataforma: number }
    | { ok: false; motivo: string }
  > {
    const [pago] = await this.dbPublico
      .select({ compraId: pagos.compraId, estado: pagos.estado })
      .from(pagos)
      .where(eq(pagos.id, pagoId));
    if (!pago || pago.estado !== 'pendiente') {
      return { ok: false, motivo: 'Este pago no existe o ya fue procesado.' };
    }

    // Reconstruir el mapeo pasajero <-> asiento <-> desglose de precio
    // desde la base de datos -- ya no vive en memoria (pudieron pasar
    // horas desde que se creó la compra). Verifica de paso que TODOS
    // los asientos sean de esta cooperativa, no solo alguno.
    const filas = await this.dbPublico.execute(sql`
      SELECT pc.id AS pasajero_compra_id, va.id AS viaje_asiento_id,
             va.numero_asiento, va.viaje_id, v.cooperativa_id,
             pc.precio_pagado, pc.tasa_terminal, pc.cargo_plataforma, pc.iva_monto, pc.es_vip
      FROM pasajeros_compra pc
      INNER JOIN viaje_asientos va ON va.id = pc.viaje_asiento_id
      INNER JOIN viajes v ON v.id = va.viaje_id
      WHERE pc.compra_id = ${pago.compraId}
    `);
    if (filas.rows.length === 0) {
      return {
        ok: false,
        motivo: 'No se encontró la información de asientos de esta compra.',
      };
    }
    type FilaPasajero = {
      pasajero_compra_id: string;
      viaje_asiento_id: string;
      numero_asiento: string;
      viaje_id: string;
      cooperativa_id: string;
      precio_pagado: string | null;
      tasa_terminal: string | null;
      cargo_plataforma: string | null;
      iva_monto: string | null;
      es_vip: boolean;
    };
    const filasTipadas = filas.rows as unknown as FilaPasajero[];

    const cooperativasEnCompra = new Set(filasTipadas.map((f) => f.cooperativa_id));
    if (cooperativasEnCompra.size !== 1 || !cooperativasEnCompra.has(cooperativaId)) {
      return { ok: false, motivo: 'Esta compra no corresponde a tu cooperativa.' };
    }
    if (filasTipadas.some((f) => f.precio_pagado === null)) {
      return {
        ok: false,
        motivo:
          'Esta compra es anterior a que se empezara a guardar el desglose de precio -- no se puede confirmar automáticamente.',
      };
    }

    await ejecutarComoCooperativa(this.dbApp, cooperativaId, async (tx) => {
      for (const f of filasTipadas) {
        await tx.execute(
          sql`UPDATE viaje_asientos SET estado = 'ocupado' WHERE id = ${f.viaje_asiento_id}`,
        );

        const codigoQr = randomUUID();
        const boletoRows = await tx.execute(
          sql`INSERT INTO boletos (cooperativa_id, compra_id, pasajero_compra_id, viaje_asiento_id, codigo_qr, precio_pagado, cargo_plataforma, iva_monto, estado, es_vip)
              VALUES (${cooperativaId}, ${pago.compraId}, ${f.pasajero_compra_id}, ${f.viaje_asiento_id}, ${codigoQr}, ${f.precio_pagado}, ${f.cargo_plataforma}, ${f.iva_monto}, 'vigente', ${f.es_vip})
              RETURNING id`,
        );
        const boletoId = (boletoRows.rows[0] as { id: string }).id;

        const rutaOrigen = await tx.execute(
          sql`SELECT r.origen_punto_operacion_id AS id FROM viajes v
              JOIN rutas r ON r.id = v.ruta_id
              WHERE v.id = ${f.viaje_id}`,
        );
        const puntoOperacionId = (rutaOrigen.rows[0] as { id: string }).id;

        await tx.execute(
          sql`INSERT INTO comprobantes_tasa_terminal (boleto_id, punto_operacion_id, monto, codigo_verificacion)
              VALUES (${boletoId}, ${puntoOperacionId}, ${f.tasa_terminal}, ${randomUUID()})`,
        );
      }
    });

    await this.dbPublico
      .update(pagos)
      .set({ estado: 'aprobado', confirmadoPorUsuarioId })
      .where(eq(pagos.id, pagoId));

    const montoCargoPlataforma = filasTipadas.reduce(
      (acc, f) => acc + Number(f.cargo_plataforma ?? 0),
      0,
    );
    return { ok: true, compraId: pago.compraId, montoCargoPlataforma };
  }

  async rechazarPagoManual(
    pagoId: string,
    cooperativaId: string,
    motivo: string | undefined,
    confirmadoPorUsuarioId: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    const [pago] = await this.dbPublico
      .select({ compraId: pagos.compraId, estado: pagos.estado })
      .from(pagos)
      .where(eq(pagos.id, pagoId));
    if (!pago || pago.estado !== 'pendiente') {
      return { ok: false, motivo: 'Este pago no existe o ya fue procesado.' };
    }

    const filas = await this.dbPublico.execute(sql`
      SELECT va.id AS viaje_asiento_id, v.cooperativa_id
      FROM pasajeros_compra pc
      INNER JOIN viaje_asientos va ON va.id = pc.viaje_asiento_id
      INNER JOIN viajes v ON v.id = va.viaje_id
      WHERE pc.compra_id = ${pago.compraId}
    `);
    const cooperativasEnCompra = new Set(
      filas.rows.map((f) => (f as { cooperativa_id: string }).cooperativa_id),
    );
    if (cooperativasEnCompra.size !== 1 || !cooperativasEnCompra.has(cooperativaId)) {
      return { ok: false, motivo: 'Esta compra no corresponde a tu cooperativa.' };
    }

    for (const fila of filas.rows) {
      const f = fila as { viaje_asiento_id: string };
      await this.dbPublico.execute(sql`
        UPDATE viaje_asientos
        SET estado = 'disponible', hold_usuario_id = NULL, hold_expira_en = NULL
        WHERE id = ${f.viaje_asiento_id}
      `);
    }

    await this.dbPublico
      .update(pagos)
      .set({
        estado: 'rechazado',
        confirmadoPorUsuarioId,
        respuestaProveedor: { motivo: motivo ?? 'Rechazado por la cooperativa.' },
      })
      .where(eq(pagos.id, pagoId));

    return { ok: true };
  }

  async confirmarPago(
    compraId: string,
    referenciaExterna: string,
    mapeo: MapeoAsientoPasajero[],
  ): Promise<{ boletos: BoletoEmitido[] }> {
    // Agrupar por cooperativa: cada grupo se escribe en su propia
    // transacción con SET LOCAL — una compra puede, en teoría, cubrir
    // asientos de más de una cooperativa (ver nota de diseño en
    // ventas.ts del esquema).
    const porCooperativa = new Map<string, MapeoAsientoPasajero[]>();
    for (const item of mapeo) {
      const lista = porCooperativa.get(item.cooperativaId) ?? [];
      lista.push(item);
      porCooperativa.set(item.cooperativaId, lista);
    }

    const boletosEmitidos: BoletoEmitido[] = [];

    for (const [cooperativaId, items] of porCooperativa) {
      await ejecutarComoCooperativa(this.dbApp, cooperativaId, async (tx) => {
        for (const item of items) {
          const asientoRows = await tx.execute(
            sql`SELECT id FROM viaje_asientos WHERE viaje_id = ${item.viajeId} AND numero_asiento = ${item.numeroAsiento}`,
          );
          const viajeAsientoId = (asientoRows.rows[0] as { id: string }).id;

          await tx.execute(
            sql`UPDATE viaje_asientos SET estado = 'ocupado' WHERE id = ${viajeAsientoId}`,
          );

          const codigoQr = randomUUID();
          const boletoRows = await tx.execute(
            sql`INSERT INTO boletos (cooperativa_id, compra_id, pasajero_compra_id, viaje_asiento_id, codigo_qr, precio_pagado, cargo_plataforma, iva_monto, estado, es_vip)
                VALUES (${cooperativaId}, ${compraId}, ${item.pasajeroCompraId}, ${viajeAsientoId}, ${codigoQr}, ${item.precioPagado.toFixed(2)}, ${item.cargoPlataforma.toFixed(2)}, ${item.ivaMonto.toFixed(2)}, 'vigente', ${item.esVip})
                RETURNING id`,
          );
          const boletoId = (boletoRows.rows[0] as { id: string }).id;

          // Hallazgo real del director (15-ago-2026, recorrido en vivo
          // de producción): la pantalla de confirmación y el boleto no
          // mostraban cooperativa, ruta, hora de salida, ni unidad --
          // solo el asiento y el precio. Se trae todo junto aquí antes
          // de armar el boleto de respuesta.
          const datosViaje = await tx.execute(
            sql`SELECT
                  r.origen_punto_operacion_id AS origen_id,
                  po_origen.ciudad AS origen_ciudad,
                  po_destino.ciudad AS destino_ciudad,
                  v.fecha_salida AS fecha_salida,
                  v.hora_salida_programada AS hora_salida_programada,
                  c.nombre_comercial AS cooperativa_nombre,
                  u.placa AS unidad_placa,
                  u.identificador_operativo AS unidad_identificador
                FROM viajes v
                JOIN rutas r ON r.id = v.ruta_id
                JOIN puntos_operacion po_origen ON po_origen.id = r.origen_punto_operacion_id
                JOIN puntos_operacion po_destino ON po_destino.id = r.destino_punto_operacion_id
                JOIN cooperativas c ON c.id = v.cooperativa_id
                LEFT JOIN unidades u ON u.id = v.unidad_id
                WHERE v.id = ${item.viajeId}`,
          );
          const filaViaje = datosViaje.rows[0] as {
            origen_id: string;
            origen_ciudad: string;
            destino_ciudad: string;
            fecha_salida: string;
            hora_salida_programada: string;
            cooperativa_nombre: string;
            unidad_placa: string | null;
            unidad_identificador: string | null;
          };
          const puntoOperacionId = filaViaje.origen_id;

          // Nombre/documento de quien compró -- si hay cuenta real
          // (compradorUsuarioId), se usa su nombre/cédula reales; si es
          // compra de invitado (sin cuenta), no existe cédula del
          // comprador en ese flujo (solo teléfono/correo de contacto),
          // así que se usa el nombre del propio pasajero como el mejor
          // dato real disponible -- decisión documentada, no oculta.
          const filaPasajero = await tx.execute(
            sql`SELECT nombres, apellidos, documento FROM pasajeros_compra WHERE id = ${item.pasajeroCompraId}`,
          );
          const p = filaPasajero.rows[0] as { nombres: string; apellidos: string; documento: string };
          let compradorNombre = `${p.nombres} ${p.apellidos}`;
          let compradorDocumento: string | null = p.documento;
          const filaComprador = await tx.execute(
            sql`SELECT u.nombre_completo, u.cedula FROM compras co
                JOIN usuarios u ON u.id = co.comprador_usuario_id
                WHERE co.id = ${compraId} AND co.comprador_usuario_id IS NOT NULL`,
          );
          if (filaComprador.rows[0]) {
            const c = filaComprador.rows[0] as { nombre_completo: string; cedula: string | null };
            compradorNombre = c.nombre_completo;
            compradorDocumento = c.cedula;
          }

          boletosEmitidos.push({
            id: boletoId,
            codigoQr,
            numeroAsiento: item.numeroAsiento,
            precioPagado: item.precioPagado,
            tasaTerminal: item.tasaTerminal,
            cargoPlataforma: item.cargoPlataforma,
            ivaMonto: item.ivaMonto,
            cooperativaNombre: filaViaje.cooperativa_nombre,
            rutaOrigenCiudad: filaViaje.origen_ciudad,
            rutaDestinoCiudad: filaViaje.destino_ciudad,
            fechaSalida: filaViaje.fecha_salida,
            horaSalidaProgramada: filaViaje.hora_salida_programada,
            unidadPlaca: filaViaje.unidad_placa,
            unidadIdentificador: filaViaje.unidad_identificador,
            compradorNombre,
            compradorDocumento,
            esVip: item.esVip,
          });

          await tx.execute(
            sql`INSERT INTO comprobantes_tasa_terminal (boleto_id, punto_operacion_id, monto, codigo_verificacion)
                VALUES (${boletoId}, ${puntoOperacionId}, ${item.tasaTerminal.toFixed(2)}, ${randomUUID()})`,
          );
        }
      });
    }

    await this.dbPublico
      .update(pagos)
      .set({ estado: 'aprobado', referenciaExterna })
      .where(eq(pagos.compraId, compraId));

    return { boletos: boletosEmitidos };
  }

  async rechazarPago(compraId: string, motivo: string): Promise<void> {
    await this.dbPublico
      .update(pagos)
      .set({ estado: 'rechazado', respuestaProveedor: { motivo } })
      .where(eq(pagos.compraId, compraId));
  }

  async cancelarBoleto(
    boletoId: string,
    usuarioId: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    const [fila] = await this.dbPublico
      .select({
        estado: boletos.estado,
        viajeAsientoId: boletos.viajeAsientoId,
        compradorUsuarioId: compras.compradorUsuarioId,
        horaSalidaProgramada: viajes.horaSalidaProgramada,
        cooperativaId: viajes.cooperativaId,
      })
      .from(boletos)
      .innerJoin(compras, eq(boletos.compraId, compras.id))
      .innerJoin(viajeAsientos, eq(boletos.viajeAsientoId, viajeAsientos.id))
      .innerJoin(viajes, eq(viajeAsientos.viajeId, viajes.id))
      .where(eq(boletos.id, boletoId));

    if (!fila || fila.compradorUsuarioId !== usuarioId) {
      return { ok: false, motivo: 'Este boleto no existe o no te pertenece.' };
    }
    if (fila.estado !== 'vigente') {
      return {
        ok: false,
        motivo:
          fila.estado === 'usado'
            ? 'Este boleto ya fue usado, no se puede cancelar.'
            : 'Este boleto ya estaba cancelado.',
      };
    }

    // Política de cancelación por cooperativa (29-jul-2026, hallazgo
    // real): algunas cooperativas (ej. Transportes Occidental) no
    // permiten cancelar en absoluto -- se rechaza ANTES de revisar
    // horas límite, no tendría sentido calcular una ventana de tiempo
    // que de todas formas nunca se puede usar.
    const [coop] = await this.dbPublico
      .select({
        permiteCancelacion: cooperativas.permiteCancelacion,
        horasLimiteCancelacion: cooperativas.horasLimiteCancelacion,
      })
      .from(cooperativas)
      .where(eq(cooperativas.id, fila.cooperativaId));
    if (!coop?.permiteCancelacion) {
      return {
        ok: false,
        motivo: 'Esta cooperativa no permite cancelaciones -- si no viajas, pierdes el boleto.',
      };
    }

    const horasMinimas =
      coop.horasLimiteCancelacion ??
      (
        await this.dbPublico
          .select({ horas: configuracionPlataforma.cancelacionHorasMinimasAntes })
          .from(configuracionPlataforma)
          .limit(1)
      )[0]?.horas ??
      2;
    const limite = new Date(fila.horaSalidaProgramada);
    limite.setHours(limite.getHours() - horasMinimas);
    if (new Date() > limite) {
      return {
        ok: false,
        motivo: `Ya no se puede cancelar — faltan menos de ${horasMinimas} horas para la salida.`,
      };
    }

    await this.dbPublico
      .update(boletos)
      .set({ estado: 'cancelado' })
      .where(eq(boletos.id, boletoId));
    await this.dbPublico
      .update(viajeAsientos)
      .set({ estado: 'disponible', holdUsuarioId: null, holdExpiraEn: null })
      .where(eq(viajeAsientos.id, fila.viajeAsientoId));

    return { ok: true };
  }

  // ─────────────────────────────────────────────────────────────
  // Reprogramación con crédito (Fase C, 29-jul-2026)
  // ─────────────────────────────────────────────────────────────

  async obtenerDetalleBoletoParaReprogramar(
    boletoId: string,
    usuarioId: string,
  ) {
    const [fila] = await this.dbPublico
      .select({
        estado: boletos.estado,
        viajeAsientoId: boletos.viajeAsientoId,
        compradorUsuarioId: compras.compradorUsuarioId,
        horaSalidaProgramada: viajes.horaSalidaProgramada,
        cooperativaId: viajes.cooperativaId,
        precioPagado: boletos.precioPagado,
        pasajeroCompraId: boletos.pasajeroCompraId,
        nombres: pasajerosCompra.nombres,
        apellidos: pasajerosCompra.apellidos,
        tipoDocumento: pasajerosCompra.tipoDocumento,
        documento: pasajerosCompra.documento,
        tipoTarifa: pasajerosCompra.tipoTarifa,
        fechaNacimiento: pasajerosCompra.fechaNacimiento,
      })
      .from(boletos)
      .innerJoin(compras, eq(boletos.compraId, compras.id))
      .innerJoin(viajeAsientos, eq(boletos.viajeAsientoId, viajeAsientos.id))
      .innerJoin(viajes, eq(viajeAsientos.viajeId, viajes.id))
      .innerJoin(
        pasajerosCompra,
        eq(boletos.pasajeroCompraId, pasajerosCompra.id),
      )
      .where(eq(boletos.id, boletoId));

    if (!fila || fila.compradorUsuarioId !== usuarioId) return null;

    const [tasaFila] = await this.dbPublico
      .select({ monto: comprobantesTasaTerminal.monto })
      .from(comprobantesTasaTerminal)
      .where(eq(comprobantesTasaTerminal.boletoId, boletoId));

    return {
      ...fila,
      precioPagado: Number(fila.precioPagado),
      tasaTerminal: Number(tasaFila?.monto ?? 0),
    };
  }

  async obtenerHorasLimiteReprogramacion(
    cooperativaId: string,
  ): Promise<{ permitido: boolean; horas: number }> {
    const [coop] = await this.dbPublico
      .select({
        horas: cooperativas.horasLimiteReprogramacion,
        permitido: cooperativas.permiteReprogramacion,
      })
      .from(cooperativas)
      .where(eq(cooperativas.id, cooperativaId));
    // Valor de reserva conservador si la cooperativa no lo configuró
    // todavía — mismo patrón que cancelacionHorasMinimasAntes.
    return { permitido: coop?.permitido ?? true, horas: coop?.horas ?? 2 };
  }

  async cancelarBoletoPorReprogramacion(
    boletoId: string,
    viajeAsientoId: string,
  ): Promise<void> {
    // Deliberadamente sin volver a chequear el límite de horas — ya se
    // validó específicamente para reprogramación antes de llegar aquí,
    // con la ventana propia de cada cooperativa, no la de cancelación
    // general.
    await this.dbPublico
      .update(boletos)
      .set({ estado: 'cancelado' })
      .where(eq(boletos.id, boletoId));
    await this.dbPublico
      .update(viajeAsientos)
      .set({ estado: 'disponible', holdUsuarioId: null, holdExpiraEn: null })
      .where(eq(viajeAsientos.id, viajeAsientoId));
  }

  async crearCreditoPasajero(
    usuarioId: string,
    cooperativaId: string,
    monto: number,
    boletoOrigenId: string,
  ): Promise<void> {
    await this.dbPublico.insert(creditosPasajero).values({
      usuarioId,
      cooperativaId,
      monto: monto.toFixed(2),
      boletoOrigenId,
    });
  }

  async listarCreditosUsuario(usuarioId: string) {
    // dbPublico (BYPASSRLS) a propósito, mismo motivo que la búsqueda
    // pública: un pasajero puede tener créditos de varias cooperativas
    // distintas a la vez, no tiene sentido filtrar por una sola (ver
    // nota de diseño en la migración 0010_creditos_reprogramacion.sql).
    const filas = await this.dbPublico
      .select({
        id: creditosPasajero.id,
        cooperativaId: creditosPasajero.cooperativaId,
        cooperativaNombre: cooperativas.nombreComercial,
        monto: creditosPasajero.monto,
        usadoEn: creditosPasajero.usadoEn,
        creadoEn: creditosPasajero.creadoEn,
      })
      .from(creditosPasajero)
      .innerJoin(cooperativas, eq(creditosPasajero.cooperativaId, cooperativas.id))
      .where(eq(creditosPasajero.usuarioId, usuarioId))
      .orderBy(sql`${creditosPasajero.creadoEn} DESC`);

    return filas.map((f) => ({
      id: f.id,
      cooperativaId: f.cooperativaId,
      cooperativaNombre: f.cooperativaNombre,
      monto: Number(f.monto),
      usadoEn: f.usadoEn ? f.usadoEn.toISOString() : null,
      creadoEn: f.creadoEn.toISOString(),
    }));
  }

  async listarMetodosPagoActivosPorViaje(
    viajeId: string,
  ): Promise<Array<{ tipo: string; datosCuenta: Record<string, string> }>> {
    const resultado = await this.dbPublico.execute(sql`
      SELECT mp.tipo, mp.datos_cuenta
      FROM metodos_pago_cooperativa mp
      INNER JOIN viajes v ON v.cooperativa_id = mp.cooperativa_id
      WHERE v.id = ${viajeId} AND mp.activo = true
      ORDER BY mp.creado_en ASC
    `);
    return resultado.rows.map((fila) => {
      const f = fila as { tipo: string; datos_cuenta: Record<string, string> };
      return { tipo: f.tipo, datosCuenta: f.datos_cuenta };
    });
  }

  /**
   * Facturación electrónica del servicio de Colombus (29-jul-2026) --
   * ver dominio/facturacion/facturacion.ports.ts para el contexto
   * completo. Distinto de la factura del pasaje (la emite la
   * cooperativa, nosotros solo avisamos -- ver solicitudes-factura).
   */
  async obtenerDatosFiscalesPlataforma(): Promise<{ ruc: string; razonSocial: string }> {
    const [fila] = await this.dbPublico
      .select({
        ruc: configuracionPlataforma.rucPlataforma,
        razonSocial: configuracionPlataforma.razonSocialPlataforma,
      })
      .from(configuracionPlataforma)
      .limit(1);
    return { ruc: fila?.ruc ?? '', razonSocial: fila?.razonSocial ?? '' };
  }

  async crearComprobantePlataforma(
    compraId: string,
    montoComprobante: number,
    rucEmisor: string,
    resultado: { claveAcceso?: string; numeroAutorizacion?: string; xmlUrl?: string; pdfUrl?: string; exitoso: boolean; error?: string },
  ): Promise<void> {
    await this.dbPublico.execute(sql`
      INSERT INTO comprobantes_electronicos
        (compra_id, sujeto_tributario, ruc_emisor, monto_comprobante, clave_acceso, numero_autorizacion, estado, ultimo_error_proveedor)
      VALUES
        (${compraId}, 'plataforma', ${rucEmisor}, ${montoComprobante},
         ${resultado.claveAcceso ?? null}, ${resultado.numeroAutorizacion ?? null},
         ${resultado.exitoso ? 'autorizado' : 'rechazado'}, ${resultado.error ?? null})
    `);
  }

  async solicitarFacturaCooperativa(
    boletoId: string,
    usuarioId: string,
    datosTributarios: Record<string, string>,
  ): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
    // Verifica que el boleto exista y le pertenezca a este usuario --
    // mismo criterio que el resto de acciones sobre un boleto propio
    // (cancelar, reprogramar).
    const fila = await this.dbPublico.execute(sql`
      SELECT b.id FROM boletos b
      INNER JOIN compras c ON c.id = b.compra_id
      WHERE b.id = ${boletoId} AND c.comprador_usuario_id = ${usuarioId}
    `);
    if (fila.rows.length === 0) {
      return { ok: false, motivo: 'Este boleto no existe o no te pertenece.' };
    }

    const yaExiste = await this.dbPublico.execute(sql`
      SELECT id FROM solicitudes_factura_cooperativa WHERE boleto_id = ${boletoId}
    `);
    if (yaExiste.rows.length > 0) {
      return { ok: false, motivo: 'Ya solicitaste la factura de este boleto.' };
    }

    const resultado = await this.dbPublico.execute(sql`
      INSERT INTO solicitudes_factura_cooperativa (boleto_id, datos_tributarios)
      VALUES (${boletoId}, ${JSON.stringify(datosTributarios)})
      RETURNING id
    `);
    return { ok: true, id: (resultado.rows[0] as { id: string }).id };
  }

  async listarSolicitudesFactura(cooperativaId: string): Promise<SolicitudFactura[]> {
    const resultado = await this.dbPublico.execute(sql`
      SELECT sf.id, sf.boleto_id, sf.estado, sf.datos_tributarios, sf.url_factura,
             sf.creado_en, pc.nombres || ' ' || pc.apellidos AS pasajero_nombre
      FROM solicitudes_factura_cooperativa sf
      INNER JOIN boletos b ON b.id = sf.boleto_id
      INNER JOIN pasajeros_compra pc ON pc.id = b.pasajero_compra_id
      WHERE b.cooperativa_id = ${cooperativaId}
      ORDER BY sf.creado_en ASC
    `);
    return resultado.rows.map((fila) => {
      const f = fila as {
        id: string;
        boleto_id: string;
        estado: 'pendiente' | 'emitida';
        datos_tributarios: Record<string, string>;
        url_factura: string | null;
        creado_en: Date | string;
        pasajero_nombre: string;
      };
      return {
        id: f.id,
        boletoId: f.boleto_id,
        estado: f.estado,
        datosTributarios: f.datos_tributarios,
        urlFactura: f.url_factura,
        pasajeroNombre: f.pasajero_nombre,
        creadoEn: f.creado_en instanceof Date ? f.creado_en.toISOString() : new Date(f.creado_en).toISOString(),
      };
    });
  }

  async marcarFacturaEmitida(
    solicitudId: string,
    cooperativaId: string,
    urlFactura: string | undefined,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    const fila = await this.dbPublico.execute(sql`
      SELECT sf.id FROM solicitudes_factura_cooperativa sf
      INNER JOIN boletos b ON b.id = sf.boleto_id
      WHERE sf.id = ${solicitudId} AND b.cooperativa_id = ${cooperativaId} AND sf.estado = 'pendiente'
    `);
    if (fila.rows.length === 0) {
      return {
        ok: false,
        motivo: 'Esta solicitud no existe, no corresponde a tu cooperativa, o ya fue emitida.',
      };
    }
    await this.dbPublico.execute(sql`
      UPDATE solicitudes_factura_cooperativa
      SET estado = 'emitida', url_factura = ${urlFactura ?? null}, emitido_en = now()
      WHERE id = ${solicitudId}
    `);
    return { ok: true };
  }

  async obtenerCreditoParaUsar(
    creditoId: string,
    usuarioId: string,
    cooperativaId: string,
  ): Promise<{ monto: number } | null> {
    const [fila] = await this.dbPublico
      .select({ monto: creditosPasajero.monto })
      .from(creditosPasajero)
      .where(
        and(
          eq(creditosPasajero.id, creditoId),
          eq(creditosPasajero.usuarioId, usuarioId),
          eq(creditosPasajero.cooperativaId, cooperativaId),
          isNull(creditosPasajero.usadoEn),
        ),
      );
    if (!fila) return null;
    return { monto: Number(fila.monto) };
  }

  async marcarCreditoUsado(
    creditoId: string,
    boletoUsadoId: string,
  ): Promise<boolean> {
    // Atómico -- mismo patrón que los tokens de un solo uso (fix de
    // condición de carrera real, 28-jul-2026): solo puede marcarlo
    // usado UNA vez, aunque dos peticiones lo intenten a la vez.
    const resultado = await this.dbPublico
      .update(creditosPasajero)
      .set({ usadoEn: new Date(), boletoUsadoId })
      .where(
        and(eq(creditosPasajero.id, creditoId), isNull(creditosPasajero.usadoEn)),
      )
      .returning({ id: creditosPasajero.id });
    return resultado.length > 0;
  }

  async obtenerReciboCompra(
    compraId: string,
    usuarioId: string,
  ): Promise<ReciboCompra | null> {
    const [compra] = await this.dbPublico
      .select({
        id: compras.id,
        compradorUsuarioId: compras.compradorUsuarioId,
        montoTotal: compras.montoTotal,
        montoTarifasCooperativa: compras.montoTarifasCooperativa,
        montoCargoPlataforma: compras.montoCargoPlataforma,
        montoTasaTerminal: compras.montoTasaTerminal,
        montoImpuestos: compras.montoImpuestos,
      })
      .from(compras)
      .where(eq(compras.id, compraId));

    // Igual que en validarBoletoPorQr: no se distingue "no existe" de
    // "no te pertenece" -- nunca se revela si una compra ajena existe.
    if (!compra || compra.compradorUsuarioId !== usuarioId) {
      return null;
    }

    const [pago] = await this.dbPublico
      .select({ proveedor: pagos.proveedor, estado: pagos.estado })
      .from(pagos)
      .where(eq(pagos.compraId, compraId));

    // Drizzle exige alias() para unir la misma tabla dos veces en una
    // sola consulta (aqui: puntos_operacion como origen Y como destino).
    const origen = alias(puntosOperacion, 'origen');
    const destino = alias(puntosOperacion, 'destino');

    const filasBoletos = await this.dbPublico
      .select({
        boletoId: boletos.id,
        codigoQr: boletos.codigoQr,
        numeroAsiento: viajeAsientos.numeroAsiento,
        precioPagado: boletos.precioPagado,
        estado: boletos.estado,
        // Item 31.1, Fase 7 (13-ago-2026) -- nombreCompleto se separo en 2 campos reales; se reconstruye solo para mostrar.
        pasajeroNombre: sql<string>`${pasajerosCompra.nombres} || ' ' || ${pasajerosCompra.apellidos}`,
        pasajeroDocumento: pasajerosCompra.documento,
        cooperativaNombre: cooperativas.nombreComercial,
        rutaOrigenCiudad: origen.ciudad,
        rutaDestinoCiudad: destino.ciudad,
        fechaSalida: viajes.fechaSalida,
        horaSalidaProgramada: viajes.horaSalidaProgramada,
      })
      .from(boletos)
      .innerJoin(pasajerosCompra, eq(boletos.pasajeroCompraId, pasajerosCompra.id))
      .innerJoin(viajeAsientos, eq(boletos.viajeAsientoId, viajeAsientos.id))
      .innerJoin(viajes, eq(viajeAsientos.viajeId, viajes.id))
      .innerJoin(rutas, eq(viajes.rutaId, rutas.id))
      .innerJoin(cooperativas, eq(boletos.cooperativaId, cooperativas.id))
      .innerJoin(origen, eq(rutas.origenPuntoOperacionId, origen.id))
      .innerJoin(destino, eq(rutas.destinoPuntoOperacionId, destino.id))
      .where(eq(boletos.compraId, compraId));

    // 27-jul-2026 -- mismo criterio que en CheckoutService: el valor
    // real sigue en compras.montoImpuestos sin tocarse; solo se
    // transforma lo que se le devuelve al pasajero en este recibo,
    // segun el modo configurado desde el Panel Admin.
    const modoIva = await this.obtenerModoIvaBoleto();
    let montoImpuestosRespuesta = Number(compra.montoImpuestos);
    let ivaVisible = true;
    if (modoIva === 'cero') {
      montoImpuestosRespuesta = 0;
    } else if (modoIva === 'oculto') {
      ivaVisible = false;
    }

    return {
      compraId: compra.id,
      montoTotal: Number(compra.montoTotal),
      montoTarifasCooperativa: Number(compra.montoTarifasCooperativa),
      montoCargoPlataforma: Number(compra.montoCargoPlataforma),
      montoTasaTerminal: Number(compra.montoTasaTerminal),
      montoImpuestos: montoImpuestosRespuesta,
      ivaVisible,
      pagoProveedor: pago?.proveedor ?? 'desconocido',
      pagoEstado: pago?.estado ?? 'desconocido',
      boletos: filasBoletos.map((b) => ({
        boletoId: b.boletoId,
        codigoQr: b.codigoQr,
        numeroAsiento: b.numeroAsiento,
        precioPagado: Number(b.precioPagado),
        estado: b.estado,
        pasajeroNombre: b.pasajeroNombre,
        pasajeroDocumento: b.pasajeroDocumento,
        cooperativaNombre: b.cooperativaNombre,
        rutaOrigenCiudad: b.rutaOrigenCiudad,
        rutaDestinoCiudad: b.rutaDestinoCiudad,
        fechaSalida: b.fechaSalida,
        horaSalidaProgramada: b.horaSalidaProgramada.toISOString(),
      })),
    };
  }

  async notificarCompraConfirmada(
    compraId: string,
    montoTotal: number,
    cantidadBoletos: number,
  ): Promise<void> {
    const filas = await this.dbPublico.execute(sql`
      SELECT u.correo
      FROM compras c
      JOIN usuarios u ON u.id = c.comprador_usuario_id
      WHERE c.id = ${compraId}
    `);
    const fila = filas.rows[0] as { correo: string } | undefined;

    // RF-CHECK-006 -- una venta de ventanilla puede no tener comprador
    // con cuenta propia; sin correo, no hay a quien notificar.
    if (!fila?.correo) return;

    const [notif] = await this.dbPublico
      .insert(notificaciones)
      .values({
        tipo: 'confirmacion_compra',
        canal: 'correo',
        compraId,
        correoDestino: fila.correo,
        estadoEnvio: 'pendiente',
      })
      .returning();

    try {
      await this.email.enviarConfirmacionCompra(fila.correo, {
        compraId,
        montoTotal,
        cantidadBoletos,
      });
      await this.dbPublico
        .update(notificaciones)
        .set({ estadoEnvio: 'enviado', enviadoEn: new Date() })
        .where(eq(notificaciones.id, notif.id));
    } catch (error) {
      // RNF-DISP-002 -- ninguna venta confirmada se pierde silenciosamente,
      // pero un fallo de notificacion tampoco debe reventar la venta ya
      // aprobada. Se registra el fallo y se sigue.
      const mensaje = error instanceof Error ? error.message : 'Error desconocido';
      this.logger.error(`No se pudo notificar la compra ${compraId}: ${mensaje}`);
      await this.dbPublico
        .update(notificaciones)
        .set({ estadoEnvio: 'fallido', errorDetalle: mensaje })
        .where(eq(notificaciones.id, notif.id));
    }
  }

  async obtenerModoIvaBoleto(): Promise<'calculado' | 'cero' | 'oculto'> {
    const resultado = await this.dbPublico.execute(
      sql`SELECT modo_iva_boleto FROM configuracion_plataforma LIMIT 1`,
    );
    const fila = resultado.rows[0] as { modo_iva_boleto: string } | undefined;
    return (fila?.modo_iva_boleto as 'calculado' | 'cero' | 'oculto') ?? 'calculado';
  }

  /** Contacto de soporte global (13-ago-2026) -- usado en el pie de página del boleto PDF. */
  async obtenerContactoSoporte(): Promise<{ correo: string | null; telefono: string | null }> {
    const resultado = await this.dbPublico.execute(
      sql`SELECT soporte_correo, soporte_telefono FROM configuracion_plataforma LIMIT 1`,
    );
    const fila = resultado.rows[0] as
      | { soporte_correo: string | null; soporte_telefono: string | null }
      | undefined;
    return {
      correo: fila?.soporte_correo ?? null,
      telefono: fila?.soporte_telefono ?? null,
    };
  }

  /**
   * Ítem 13, Fase 2 (05-ago-2026) -- descarga de boleto en PDF.
   * Reubicado 13-ago-2026 (auditoría) desde
   * CalificacionesRepositorioDrizzle -- mismo query exacto, sin ningún
   * cambio de comportamiento, solo de ubicación.
   */
  async obtenerDatosBoletoParaPdf(
    boletoId: string,
    usuarioId: string,
  ): Promise<{
    codigoQr: string;
    estado: string;
    precioPagado: number;
    ivaMonto: number;
    pasajeroNombre: string;
    tipoDocumento: string;
    documento: string;
    tipoTarifa: string;
    numeroAsiento: string;
    cooperativaNombre: string;
    // Ambos, ya que el boleto premium (13-ago-2026) necesita el nombre
    // real de la terminal (ej. "Terminal Terrestre Quitumbe"), no solo
    // la ciudad -- puntosOperacion.nombre ya existía en el esquema,
    // separado de ciudad, listo para usar sin ningún cambio de esquema.
    origenNombre: string;
    origenCiudad: string;
    destinoNombre: string;
    destinoCiudad: string;
    fechaSalida: string;
    horaSalidaProgramada: Date;
    permiteCancelacion: boolean;
    horasLimiteCancelacion: number | null;
    permiteReprogramacion: boolean;
    horasLimiteReprogramacion: number | null;
    // Hallazgo real del director (15-ago-2026, recorrido en vivo de
    // producción): faltaba unidad y a nombre de quién queda el boleto.
    unidadIdentificador: string | null;
    compradorNombre: string;
    compradorDocumento: string | null;
    esVip: boolean;
  } | null> {
    const puntosOrigenPdf = alias(puntosOperacion, 'puntos_origen_pdf');
    const puntosDestinoPdf = alias(puntosOperacion, 'puntos_destino_pdf');

    const [fila] = await this.dbPublico
      .select({
        codigoQr: boletos.codigoQr,
        estado: boletos.estado,
        precioPagado: boletos.precioPagado,
        ivaMonto: boletos.ivaMonto,
        pasajeroNombre: sql<string>`${pasajerosCompra.nombres} || ' ' || ${pasajerosCompra.apellidos}`,
        tipoDocumento: pasajerosCompra.tipoDocumento,
        documento: pasajerosCompra.documento,
        tipoTarifa: pasajerosCompra.tipoTarifa,
        numeroAsiento: viajeAsientos.numeroAsiento,
        cooperativaNombre: cooperativas.nombreComercial,
        origenNombre: puntosOrigenPdf.nombre,
        origenCiudad: puntosOrigenPdf.ciudad,
        destinoNombre: puntosDestinoPdf.nombre,
        destinoCiudad: puntosDestinoPdf.ciudad,
        fechaSalida: viajes.fechaSalida,
        horaSalidaProgramada: viajes.horaSalidaProgramada,
        permiteCancelacion: cooperativas.permiteCancelacion,
        horasLimiteCancelacion: cooperativas.horasLimiteCancelacion,
        permiteReprogramacion: cooperativas.permiteReprogramacion,
        horasLimiteReprogramacion: cooperativas.horasLimiteReprogramacion,
        unidadIdentificador: unidades.identificadorOperativo,
        compradorNombreCuenta: usuarios.nombreCompleto,
        compradorCedulaCuenta: usuarios.cedula,
        esVip: boletos.esVip,
      })
      .from(boletos)
      .innerJoin(compras, eq(boletos.compraId, compras.id))
      .innerJoin(pasajerosCompra, eq(boletos.pasajeroCompraId, pasajerosCompra.id))
      .innerJoin(viajeAsientos, eq(boletos.viajeAsientoId, viajeAsientos.id))
      .innerJoin(viajes, eq(viajeAsientos.viajeId, viajes.id))
      .innerJoin(rutas, eq(viajes.rutaId, rutas.id))
      .innerJoin(puntosOrigenPdf, eq(rutas.origenPuntoOperacionId, puntosOrigenPdf.id))
      .innerJoin(puntosDestinoPdf, eq(rutas.destinoPuntoOperacionId, puntosDestinoPdf.id))
      .innerJoin(cooperativas, eq(boletos.cooperativaId, cooperativas.id))
      .leftJoin(unidades, eq(viajes.unidadId, unidades.id))
      .leftJoin(usuarios, eq(compras.compradorUsuarioId, usuarios.id))
      .where(
        sql`${boletos.id} = ${boletoId} AND ${compras.compradorUsuarioId} = ${usuarioId}`,
      );

    if (!fila) return null;
    return {
      ...fila,
      precioPagado: Number(fila.precioPagado),
      ivaMonto: Number(fila.ivaMonto),
      compradorNombre: fila.compradorNombreCuenta ?? fila.pasajeroNombre,
      compradorDocumento: fila.compradorCedulaCuenta ?? fila.documento,
    };
  }
}
