import { Inject, Injectable } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type {
  BoletoParaReclamo,
  DatosNuevoReclamo,
  DatosResolucionReclamo,
  EstadoReclamo,
  FiltrosReclamosCooperativa,
  FiltrosReclamosPasajero,
  ReclamoDeCooperativa,
  ReclamoDePasajero,
  ReclamosRepositorio,
  ResultadoReclamos,
  ResumenReclamosCooperativa,
  TipoReclamo,
} from '../../dominio/reclamos/reclamos.ports';

/**
 * Usa DRIZZLE_DB_PUBLICO (rol de plataforma) a propósito, igual que las
 * solicitudes de factura y el historial de pagos: un mismo reclamo lo
 * ve el pasajero (que no pertenece a ninguna cooperativa) y la
 * cooperativa dueña del viaje, así que el aislamiento se garantiza con
 * filtros EXPLÍCITOS -- `pasajero_usuario_id` en el lado del pasajero,
 * `cooperativa_id` (siempre del token, nunca del cliente) en el de la
 * cooperativa. La política RLS de la tabla es la red de seguridad.
 */
const DESDE_RECLAMO = sql`
  FROM reclamos rc
  INNER JOIN boletos b ON b.id = rc.boleto_id
  INNER JOIN viaje_asientos va ON va.id = b.viaje_asiento_id
  INNER JOIN viajes v ON v.id = va.viaje_id
  INNER JOIN rutas r ON r.id = v.ruta_id
  INNER JOIN puntos_operacion ori ON ori.id = r.origen_punto_operacion_id
  INNER JOIN puntos_operacion dest ON dest.id = r.destino_punto_operacion_id
  INNER JOIN cooperativas co ON co.id = rc.cooperativa_id
  INNER JOIN usuarios u ON u.id = rc.pasajero_usuario_id
`;

const aIso = (v: Date | string) =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();
const aIsoONulo = (v: Date | string | null) => (v === null ? null : aIso(v));

interface FilaReclamo {
  id: string;
  boleto_id: string;
  tipo: TipoReclamo;
  descripcion: string;
  estado: EstadoReclamo;
  respuesta: string | null;
  monto_reconocido: string | null;
  monto_boleto: string;
  cooperativa_nombre: string;
  pasajero_nombre: string;
  pasajero_correo: string | null;
  pasajero_telefono: string | null;
  origen_ciudad: string;
  destino_ciudad: string;
  fecha_salida: string;
  creado_en: Date | string;
  resuelto_en: Date | string | null;
}

const COLUMNAS_RECLAMO = sql`
  rc.id, rc.boleto_id, rc.tipo, rc.descripcion, rc.estado, rc.respuesta,
  rc.monto_reconocido, b.precio_pagado AS monto_boleto,
  co.nombre_comercial AS cooperativa_nombre,
  u.nombre_completo AS pasajero_nombre,
  u.correo AS pasajero_correo,
  u.telefono AS pasajero_telefono,
  ori.ciudad AS origen_ciudad, dest.ciudad AS destino_ciudad,
  v.fecha_salida::text AS fecha_salida,
  rc.creado_en, rc.resuelto_en
`;

function aReclamoDePasajero(f: FilaReclamo): ReclamoDePasajero {
  return {
    id: f.id,
    boletoId: f.boleto_id,
    tipo: f.tipo,
    descripcion: f.descripcion,
    estado: f.estado,
    respuesta: f.respuesta,
    montoReconocido:
      f.monto_reconocido === null ? null : Number(f.monto_reconocido),
    cooperativaNombre: f.cooperativa_nombre,
    origenCiudad: f.origen_ciudad,
    destinoCiudad: f.destino_ciudad,
    fechaSalida: f.fecha_salida,
    creadoEn: aIso(f.creado_en),
    resueltoEn: aIsoONulo(f.resuelto_en),
  };
}

function aReclamoDeCooperativa(f: FilaReclamo): ReclamoDeCooperativa {
  return {
    ...aReclamoDePasajero(f),
    montoBoleto: Number(f.monto_boleto),
    pasajeroNombre: f.pasajero_nombre,
    pasajeroCorreo: f.pasajero_correo,
    pasajeroTelefono: f.pasajero_telefono,
  };
}

@Injectable()
export class ReclamosRepositorioDrizzle implements ReclamosRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async obtenerBoletoDeUsuario(
    boletoId: string,
    usuarioId: string,
  ): Promise<BoletoParaReclamo | null> {
    const resultado = await this.db.execute(sql`
      SELECT b.cooperativa_id, co.nombre_comercial AS cooperativa_nombre,
             ori.ciudad AS origen_ciudad, dest.ciudad AS destino_ciudad,
             v.fecha_salida::text AS fecha_salida
      FROM boletos b
      INNER JOIN compras c ON c.id = b.compra_id
      INNER JOIN viaje_asientos va ON va.id = b.viaje_asiento_id
      INNER JOIN viajes v ON v.id = va.viaje_id
      INNER JOIN rutas r ON r.id = v.ruta_id
      INNER JOIN puntos_operacion ori ON ori.id = r.origen_punto_operacion_id
      INNER JOIN puntos_operacion dest ON dest.id = r.destino_punto_operacion_id
      INNER JOIN cooperativas co ON co.id = b.cooperativa_id
      WHERE b.id = ${boletoId} AND c.comprador_usuario_id = ${usuarioId}
    `);
    const f = resultado.rows[0] as
      | {
          cooperativa_id: string;
          cooperativa_nombre: string;
          origen_ciudad: string;
          destino_ciudad: string;
          fecha_salida: string;
        }
      | undefined;
    if (!f) return null;
    return {
      cooperativaId: f.cooperativa_id,
      cooperativaNombre: f.cooperativa_nombre,
      origenCiudad: f.origen_ciudad,
      destinoCiudad: f.destino_ciudad,
      fechaSalida: f.fecha_salida,
    };
  }

  async existeReclamoActivo(
    boletoId: string,
    tipo: TipoReclamo,
  ): Promise<boolean> {
    const resultado = await this.db.execute(sql`
      SELECT 1 FROM reclamos
      WHERE boleto_id = ${boletoId} AND tipo = ${tipo}
        AND estado IN ('abierto', 'en_revision')
    `);
    return resultado.rows.length > 0;
  }

  async crear(datos: DatosNuevoReclamo): Promise<{ id: string }> {
    const resultado = await this.db.execute(sql`
      INSERT INTO reclamos (boleto_id, cooperativa_id, pasajero_usuario_id, tipo, descripcion)
      VALUES (${datos.boletoId}, ${datos.cooperativaId}, ${datos.pasajeroUsuarioId}, ${datos.tipo}, ${datos.descripcion})
      RETURNING id
    `);
    return { id: (resultado.rows[0] as { id: string }).id };
  }

  async listarDePasajero(
    usuarioId: string,
    filtros: FiltrosReclamosPasajero,
  ): Promise<ResultadoReclamos<ReclamoDePasajero>> {
    const condiciones: SQL[] = [sql`rc.pasajero_usuario_id = ${usuarioId}`];
    if (filtros.estado) {
      condiciones.push(sql`rc.estado = ${filtros.estado}`);
    }
    const donde = sql.join(condiciones, sql` AND `);

    const totalFilas = await this.db.execute(
      sql`SELECT COUNT(*)::int AS total ${DESDE_RECLAMO} WHERE ${donde}`,
    );
    const total = (totalFilas.rows[0] as { total: number }).total;

    const offset = (filtros.pagina - 1) * filtros.limite;
    const resultado = await this.db.execute(sql`
      SELECT ${COLUMNAS_RECLAMO}
      ${DESDE_RECLAMO}
      WHERE ${donde}
      ORDER BY rc.creado_en DESC
      LIMIT ${filtros.limite} OFFSET ${offset}
    `);
    return {
      filas: resultado.rows.map((f) =>
        aReclamoDePasajero(f as unknown as FilaReclamo),
      ),
      total,
      pagina: filtros.pagina,
      limite: filtros.limite,
    };
  }

  async listarDeCooperativa(
    cooperativaId: string,
    filtros: FiltrosReclamosCooperativa,
  ): Promise<ResultadoReclamos<ReclamoDeCooperativa>> {
    const condiciones: SQL[] = [sql`rc.cooperativa_id = ${cooperativaId}`];
    if (filtros.estado) {
      condiciones.push(sql`rc.estado = ${filtros.estado}`);
    }
    if (filtros.tipo) {
      condiciones.push(sql`rc.tipo = ${filtros.tipo}`);
    }
    if (filtros.desde) {
      condiciones.push(
        sql`(rc.creado_en AT TIME ZONE 'America/Guayaquil')::date >= ${filtros.desde}::date`,
      );
    }
    if (filtros.hasta) {
      condiciones.push(
        sql`(rc.creado_en AT TIME ZONE 'America/Guayaquil')::date <= ${filtros.hasta}::date`,
      );
    }
    const texto = filtros.busqueda?.trim();
    if (texto) {
      const patron = `%${texto}%`;
      condiciones.push(
        sql`(u.nombre_completo ILIKE ${patron} OR u.correo ILIKE ${patron} OR rc.descripcion ILIKE ${patron} OR ori.ciudad ILIKE ${patron} OR dest.ciudad ILIKE ${patron})`,
      );
    }
    const donde = sql.join(condiciones, sql` AND `);

    const totalFilas = await this.db.execute(
      sql`SELECT COUNT(*)::int AS total ${DESDE_RECLAMO} WHERE ${donde}`,
    );
    const total = (totalFilas.rows[0] as { total: number }).total;

    // Los pendientes de atender primero, el más antiguo arriba (hay que
    // responderlos en orden de llegada); los ya resueltos después, del
    // más reciente al más antiguo.
    const offset = (filtros.pagina - 1) * filtros.limite;
    const resultado = await this.db.execute(sql`
      SELECT ${COLUMNAS_RECLAMO}
      ${DESDE_RECLAMO}
      WHERE ${donde}
      ORDER BY (rc.estado IN ('resuelto', 'rechazado')),
               CASE WHEN rc.estado IN ('abierto', 'en_revision') THEN rc.creado_en END ASC,
               rc.creado_en DESC
      LIMIT ${filtros.limite} OFFSET ${offset}
    `);
    return {
      filas: resultado.rows.map((f) =>
        aReclamoDeCooperativa(f as unknown as FilaReclamo),
      ),
      total,
      pagina: filtros.pagina,
      limite: filtros.limite,
    };
  }

  async obtenerDeCooperativa(
    cooperativaId: string,
    reclamoId: string,
  ): Promise<ReclamoDeCooperativa | null> {
    const resultado = await this.db.execute(sql`
      SELECT ${COLUMNAS_RECLAMO}
      ${DESDE_RECLAMO}
      WHERE rc.id = ${reclamoId} AND rc.cooperativa_id = ${cooperativaId}
    `);
    const fila = resultado.rows[0];
    return fila ? aReclamoDeCooperativa(fila as unknown as FilaReclamo) : null;
  }

  async resumenDeCooperativa(
    cooperativaId: string,
  ): Promise<ResumenReclamosCooperativa> {
    const resultado = await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE estado = 'abierto')::int AS abiertos,
        COUNT(*) FILTER (WHERE estado = 'en_revision')::int AS en_revision,
        COUNT(*) FILTER (WHERE estado = 'resuelto')::int AS resueltos,
        COUNT(*) FILTER (WHERE estado = 'rechazado')::int AS rechazados
      FROM reclamos
      WHERE cooperativa_id = ${cooperativaId}
    `);
    const f = resultado.rows[0] as {
      abiertos: number;
      en_revision: number;
      resueltos: number;
      rechazados: number;
    };
    return {
      abiertos: f.abiertos,
      enRevision: f.en_revision,
      resueltos: f.resueltos,
      rechazados: f.rechazados,
    };
  }

  async marcarEnRevision(
    cooperativaId: string,
    reclamoId: string,
    usuarioId: string,
  ): Promise<boolean> {
    const resultado = await this.db.execute(sql`
      UPDATE reclamos
      SET estado = 'en_revision', gestionado_por_usuario_id = ${usuarioId}, actualizado_en = now()
      WHERE id = ${reclamoId} AND cooperativa_id = ${cooperativaId} AND estado = 'abierto'
      RETURNING id
    `);
    return resultado.rows.length > 0;
  }

  async resolver(
    cooperativaId: string,
    reclamoId: string,
    datos: DatosResolucionReclamo,
  ): Promise<boolean> {
    const resultado = await this.db.execute(sql`
      UPDATE reclamos
      SET estado = ${datos.estadoFinal},
          respuesta = ${datos.respuesta},
          monto_reconocido = ${datos.montoReconocido},
          gestionado_por_usuario_id = ${datos.gestionadoPorUsuarioId},
          resuelto_en = now(),
          actualizado_en = now()
      WHERE id = ${reclamoId} AND cooperativa_id = ${cooperativaId}
        AND estado IN ('abierto', 'en_revision')
      RETURNING id
    `);
    return resultado.rows.length > 0;
  }

  async correosDeCooperativa(cooperativaId: string): Promise<string[]> {
    const resultado = await this.db.execute(sql`
      SELECT contacto_correo AS correo FROM cooperativas
      WHERE id = ${cooperativaId} AND contacto_correo IS NOT NULL
      UNION
      SELECT correo FROM usuarios
      WHERE cooperativa_id = ${cooperativaId} AND rol = 'admin_cooperativa'
        AND activo = true AND correo IS NOT NULL
    `);
    return resultado.rows
      .map((f) => (f as { correo: string }).correo)
      .filter((c) => c.trim() !== '');
  }

  async correoDePasajero(usuarioId: string): Promise<string | null> {
    const resultado = await this.db.execute(
      sql`SELECT correo FROM usuarios WHERE id = ${usuarioId}`,
    );
    const f = resultado.rows[0] as { correo: string | null } | undefined;
    return f?.correo ?? null;
  }

  async datosParaAvisoResolucion(reclamoId: string): Promise<{
    pasajeroUsuarioId: string;
    cooperativaNombre: string;
    origenCiudad: string;
    destinoCiudad: string;
  } | null> {
    const resultado = await this.db.execute(sql`
      SELECT rc.pasajero_usuario_id, co.nombre_comercial AS cooperativa_nombre,
             ori.ciudad AS origen_ciudad, dest.ciudad AS destino_ciudad
      ${DESDE_RECLAMO}
      WHERE rc.id = ${reclamoId}
    `);
    const f = resultado.rows[0] as
      | {
          pasajero_usuario_id: string;
          cooperativa_nombre: string;
          origen_ciudad: string;
          destino_ciudad: string;
        }
      | undefined;
    if (!f) return null;
    return {
      pasajeroUsuarioId: f.pasajero_usuario_id,
      cooperativaNombre: f.cooperativa_nombre,
      origenCiudad: f.origen_ciudad,
      destinoCiudad: f.destino_ciudad,
    };
  }
}
