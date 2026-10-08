import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type {
  ClienteFactura,
  ContextoVentaCooperativa,
  CooperativaDeCompra,
  ModoOperacion,
  EstadoTareaPostpago,
  FiltrosTareasPostpago,
  TareaPostpago,
  TareasPostpagoRepositorio,
  TipoTareaPostpago,
} from '../../dominio/postpago/postpago.ports';

type FilaTarea = {
  id: string;
  compra_id: string;
  cooperativa_id: string | null;
  tipo: TipoTareaPostpago;
  estado: EstadoTareaPostpago;
  intentos: number;
  max_intentos: number;
  proximo_intento_en: Date | string;
  ultimo_error: string | null;
  resultado: Record<string, unknown> | null;
  creado_en: Date | string;
  completado_en: Date | string | null;
};

const iso = (d: Date | string) => new Date(d).toISOString();

function aTarea(f: FilaTarea): TareaPostpago {
  return {
    id: f.id,
    compraId: f.compra_id,
    cooperativaId: f.cooperativa_id,
    tipo: f.tipo,
    estado: f.estado,
    intentos: Number(f.intentos),
    maxIntentos: Number(f.max_intentos),
    proximoIntentoEn: iso(f.proximo_intento_en),
    ultimoError: f.ultimo_error,
    resultado: f.resultado,
    creadoEn: iso(f.creado_en),
    completadoEn: f.completado_en ? iso(f.completado_en) : null,
  };
}

/**
 * Persistencia de las tareas posteriores al pago. Usa la conexión de la
 * plataforma (cross-tenant): el worker procesa tareas de todas las
 * cooperativas a la vez, y las facturas y tasas que escribe pertenecen a cada
 * una, pero las escribe el sistema, no la cooperativa.
 */
@Injectable()
export class TareasPostpagoRepositorioDrizzle implements TareasPostpagoRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async programar(
    compraId: string,
    tareas: { tipo: TipoTareaPostpago; cooperativaId: string | null }[],
  ): Promise<void> {
    for (const t of tareas) {
      await this.db.execute(sql`
        INSERT INTO tareas_postpago (compra_id, cooperativa_id, tipo)
        VALUES (${compraId}, ${t.cooperativaId}, ${t.tipo})
        ON CONFLICT DO NOTHING
      `);
    }
  }

  async reclamarListas(limite: number, compraId?: string): Promise<TareaPostpago[]> {
    const filtroCompra = compraId ?? null;
    const r = await this.db.execute(sql`
      UPDATE tareas_postpago t
      SET estado = 'en_proceso',
          bloqueada_hasta = now() + interval '5 minutes',
          actualizado_en = now()
      WHERE t.id IN (
        SELECT id FROM tareas_postpago
        WHERE ((estado = 'pendiente' AND proximo_intento_en <= now())
               OR (estado = 'en_proceso' AND bloqueada_hasta < now()))
          AND (${filtroCompra}::uuid IS NULL OR compra_id = ${filtroCompra}::uuid)
        ORDER BY creado_en
        LIMIT ${limite}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING t.*
    `);
    return (r.rows as unknown as FilaTarea[]).map(aTarea);
  }

  async tareasDeCompra(compraId: string): Promise<TareaPostpago[]> {
    const r = await this.db.execute(sql`
      SELECT * FROM tareas_postpago WHERE compra_id = ${compraId} ORDER BY creado_en
    `);
    return (r.rows as unknown as FilaTarea[]).map(aTarea);
  }

  async marcarExitosa(id: string, resultado: Record<string, unknown>): Promise<void> {
    await this.db.execute(sql`
      UPDATE tareas_postpago
      SET estado = 'exitosa', intentos = intentos + 1, resultado = ${JSON.stringify(resultado)}::jsonb,
          ultimo_error = NULL, bloqueada_hasta = NULL, completado_en = now(), actualizado_en = now()
      WHERE id = ${id}
    `);
  }

  async marcarReintento(id: string, error: string, proximoIntentoEn: Date): Promise<void> {
    await this.db.execute(sql`
      UPDATE tareas_postpago
      SET estado = 'pendiente', intentos = intentos + 1, ultimo_error = ${error},
          proximo_intento_en = ${proximoIntentoEn.toISOString()}::timestamptz,
          bloqueada_hasta = NULL, actualizado_en = now()
      WHERE id = ${id}
    `);
  }

  async marcarAgotada(id: string, error: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE tareas_postpago
      SET estado = 'agotada', intentos = intentos + 1, ultimo_error = ${error},
          bloqueada_hasta = NULL, actualizado_en = now()
      WHERE id = ${id}
    `);
  }

  async posponer(id: string, proximoIntentoEn: Date, motivo: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE tareas_postpago
      SET estado = 'pendiente', ultimo_error = ${motivo},
          proximo_intento_en = ${proximoIntentoEn.toISOString()}::timestamptz,
          bloqueada_hasta = NULL, actualizado_en = now()
      WHERE id = ${id}
    `);
  }

  async reiniciar(id: string): Promise<boolean> {
    const r = await this.db.execute(sql`
      UPDATE tareas_postpago
      SET estado = 'pendiente', intentos = 0, ultimo_error = NULL,
          proximo_intento_en = now(), bloqueada_hasta = NULL, actualizado_en = now()
      WHERE id = ${id} AND estado = 'agotada'
      RETURNING id
    `);
    return r.rows.length > 0;
  }

  async listar(filtros: FiltrosTareasPostpago): Promise<{ filas: TareaPostpago[]; total: number }> {
    const estado = filtros.estado ?? null;
    const compraId = filtros.compraId ?? null;
    const offset = (filtros.pagina - 1) * filtros.limite;
    const where = sql`(${estado}::estado_tarea_postpago IS NULL OR estado = ${estado}::estado_tarea_postpago)
                      AND (${compraId}::uuid IS NULL OR compra_id = ${compraId}::uuid)`;
    const total = await this.db.execute(sql`SELECT count(*)::int AS n FROM tareas_postpago WHERE ${where}`);
    const filas = await this.db.execute(sql`
      SELECT * FROM tareas_postpago WHERE ${where}
      ORDER BY actualizado_en DESC LIMIT ${filtros.limite} OFFSET ${offset}
    `);
    return {
      filas: (filas.rows as unknown as FilaTarea[]).map(aTarea),
      total: Number((total.rows[0] as { n: number }).n),
    };
  }

  async obtener(id: string): Promise<TareaPostpago | null> {
    const r = await this.db.execute(sql`SELECT * FROM tareas_postpago WHERE id = ${id}`);
    const fila = r.rows[0] as unknown as FilaTarea | undefined;
    return fila ? aTarea(fila) : null;
  }

  async transicionarCompra(compraId: string, estado: 'tasa_confirmada' | 'completada'): Promise<boolean> {
    const desde = estado === 'tasa_confirmada' ? ['boleto_confirmado'] : ['boleto_confirmado', 'tasa_confirmada'];
    const actual = await this.db.execute(sql`SELECT estado FROM compras WHERE id = ${compraId}`);
    const estadoActual = (actual.rows[0] as { estado: string } | undefined)?.estado;
    if (!estadoActual || !desde.includes(estadoActual)) return false;
    await this.db.execute(sql`
      UPDATE compras SET estado = ${estado}::estado_compra, actualizado_en = now() WHERE id = ${compraId}
    `);
    await this.db.execute(sql`
      INSERT INTO compras_transiciones (compra_id, estado_anterior, estado_nuevo, actor_sistema)
      VALUES (${compraId}, ${estadoActual}::estado_compra, ${estado}::estado_compra, 'postpago')
    `);
    return true;
  }

  async rucPlataforma(): Promise<string> {
    const r = await this.db.execute(sql`SELECT ruc_plataforma FROM configuracion_plataforma LIMIT 1`);
    return (r.rows[0] as { ruc_plataforma: string } | undefined)?.ruc_plataforma ?? '';
  }

  async guardarComprobantePlataforma(
    compraId: string,
    datos: { rucEmisor: string; monto: number; claveAcceso?: string; numeroAutorizacion?: string; xmlUrl?: string; pdfUrl?: string },
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO comprobantes_electronicos
        (compra_id, sujeto_tributario, ruc_emisor, monto_comprobante, clave_acceso, numero_autorizacion, estado, xml_url, pdf_url)
      SELECT ${compraId}, 'plataforma', ${datos.rucEmisor}, ${datos.monto},
             ${datos.claveAcceso ?? null}, ${datos.numeroAutorizacion ?? null}, 'autorizado',
             ${datos.xmlUrl ?? null}, ${datos.pdfUrl ?? null}
      WHERE NOT EXISTS (
        SELECT 1 FROM comprobantes_electronicos WHERE compra_id = ${compraId} AND sujeto_tributario = 'plataforma'
      )
    `);
  }

  async cooperativasYCargoDeCompra(
    compraId: string,
  ): Promise<{ cooperativas: CooperativaDeCompra[]; cargoPlataforma: number }> {
    const coops = await this.db.execute(sql`
      SELECT DISTINCT v.cooperativa_id AS id, co.modo_operacion AS modo,
             EXISTS (
               SELECT 1 FROM credenciales_api ca
               WHERE ca.cooperativa_id = v.cooperativa_id AND ca.activo = true AND ca.revocado_en IS NULL
             ) AS tiene_api
      FROM pasajeros_compra pc
      JOIN viaje_asientos va ON va.id = pc.viaje_asiento_id
      JOIN viajes v ON v.id = va.viaje_id
      JOIN cooperativas co ON co.id = v.cooperativa_id
      WHERE pc.compra_id = ${compraId}
      ORDER BY v.cooperativa_id
    `);
    const compra = await this.db.execute(sql`SELECT monto_cargo_plataforma FROM compras WHERE id = ${compraId}`);
    return {
      cooperativas: (coops.rows as unknown as { id: string; modo: ModoOperacion; tiene_api: boolean }[]).map((f) => ({
        id: f.id,
        modo: f.modo,
        tieneIntegracionApi: f.tiene_api,
      })),
      cargoPlataforma: Number((compra.rows[0] as { monto_cargo_plataforma: string } | undefined)?.monto_cargo_plataforma ?? 0),
    };
  }

  async contextoVenta(compraId: string, cooperativaId: string): Promise<ContextoVentaCooperativa | null> {
    const cabecera = await this.db.execute(sql`
      SELECT co.ruc, co.nombre_comercial, c.datos_facturacion, c.correo_contacto, u.correo AS correo_usuario
      FROM compras c
      JOIN cooperativas co ON co.id = ${cooperativaId}
      LEFT JOIN usuarios u ON u.id = c.comprador_usuario_id
      WHERE c.id = ${compraId}
    `);
    const fila = cabecera.rows[0] as
      | {
          ruc: string;
          nombre_comercial: string;
          datos_facturacion: {
            tipoIdentificacion: ClienteFactura['tipoIdentificacion'];
            identificacion: string;
            razonSocial: string;
            correo: string;
            direccion?: string;
          } | null;
          correo_contacto: string | null;
          correo_usuario: string | null;
        }
      | undefined;
    if (!fila) return null;

    const pasajerosFilas = await this.db.execute(sql`
      SELECT pc.nombres, pc.apellidos, pc.tipo_documento, pc.documento, pc.tipo_tarifa,
             pc.precio_pagado, pc.tasa_terminal, va.numero_asiento, va.viaje_id
      FROM pasajeros_compra pc
      JOIN viaje_asientos va ON va.id = pc.viaje_asiento_id
      JOIN viajes v ON v.id = va.viaje_id
      WHERE pc.compra_id = ${compraId} AND v.cooperativa_id = ${cooperativaId}
      ORDER BY pc.id
    `);
    const pasajeros = pasajerosFilas.rows as unknown as {
      nombres: string;
      apellidos: string;
      tipo_documento: 'cedula' | 'pasaporte';
      documento: string;
      tipo_tarifa: 'adulto' | 'nino' | 'tercera_edad' | 'discapacidad';
      precio_pagado: string | null;
      tasa_terminal: string | null;
      numero_asiento: string;
      viaje_id: string;
    }[];
    if (pasajeros.length === 0) return null;

    const primero = pasajeros[0];
    const guardados = fila.datos_facturacion;
    const cliente: ClienteFactura = guardados
      ? {
          tipoIdentificacion: guardados.tipoIdentificacion,
          identificacion: guardados.identificacion,
          razonSocial: guardados.razonSocial,
          correo: guardados.correo,
          direccion: guardados.direccion ?? null,
        }
      : {
          tipoIdentificacion: primero.tipo_documento,
          identificacion: primero.documento,
          razonSocial: `${primero.nombres} ${primero.apellidos}`,
          correo: fila.correo_contacto ?? fila.correo_usuario,
          direccion: null,
        };

    return {
      cooperativaId,
      cooperativaRuc: fila.ruc,
      cooperativaNombre: fila.nombre_comercial,
      cliente,
      pasajeros: pasajeros.map((p) => ({
        asientoEtiqueta: p.numero_asiento,
        viajeId: p.viaje_id,
        tipoTarifa: p.tipo_tarifa,
        precioPagado: Number(p.precio_pagado ?? 0),
        tasaTerminal: Number(p.tasa_terminal ?? 0),
      })),
    };
  }

  async guardarResultadoTasa(
    compraId: string,
    cooperativaId: string,
    datos: {
      exitoso: boolean;
      codigoTasa?: string;
      mensaje?: string;
      saldoRestante?: number;
      solicitud: Record<string, unknown>;
      respuesta: Record<string, unknown>;
    },
  ): Promise<void> {
    const estado = datos.exitoso ? 'exitosa' : 'fallida';
    await this.db.execute(sql`
      INSERT INTO registros_tasa_terminal
        (cooperativa_id, compra_id, clave_idempotencia, estado, codigo_tasa, mensaje_terminal,
         saldo_reportado, solicitud_payload, respuesta_payload, intentos, ultimo_intento_en)
      VALUES
        (${cooperativaId}, ${compraId}, ${`registro-${compraId}-${cooperativaId}`}, ${estado}::estado_registro_tasa,
         ${datos.codigoTasa ?? null}, ${datos.mensaje ?? null}, ${datos.saldoRestante ?? null},
         ${JSON.stringify(datos.solicitud)}::jsonb, ${JSON.stringify(datos.respuesta)}::jsonb, 1, now())
      ON CONFLICT (compra_id, cooperativa_id) DO UPDATE SET
        estado = EXCLUDED.estado,
        codigo_tasa = EXCLUDED.codigo_tasa,
        mensaje_terminal = EXCLUDED.mensaje_terminal,
        saldo_reportado = EXCLUDED.saldo_reportado,
        solicitud_payload = EXCLUDED.solicitud_payload,
        respuesta_payload = EXCLUDED.respuesta_payload,
        intentos = registros_tasa_terminal.intentos + 1,
        ultimo_intento_en = now(),
        actualizado_en = now()
    `);
  }

  async guardarComprobanteCooperativa(
    compraId: string,
    cooperativaId: string,
    datos: {
      rucEmisor: string;
      monto: number;
      claveAcceso?: string;
      numeroAutorizacion?: string;
      xmlUrl?: string;
      pdfUrl?: string;
    },
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO comprobantes_electronicos
        (compra_id, sujeto_tributario, cooperativa_id, ruc_emisor, monto_comprobante,
         clave_acceso, numero_autorizacion, estado, xml_url, pdf_url)
      SELECT ${compraId}, 'cooperativa', ${cooperativaId}, ${datos.rucEmisor}, ${datos.monto},
             ${datos.claveAcceso ?? null}, ${datos.numeroAutorizacion ?? null}, 'autorizado',
             ${datos.xmlUrl ?? null}, ${datos.pdfUrl ?? null}
      WHERE NOT EXISTS (
        SELECT 1 FROM comprobantes_electronicos
        WHERE compra_id = ${compraId} AND sujeto_tributario = 'cooperativa' AND cooperativa_id = ${cooperativaId}
      )
    `);
  }
}
