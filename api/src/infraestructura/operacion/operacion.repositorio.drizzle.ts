import { Inject, Injectable } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type {
  AlertasOperacion,
  EstadoViaje,
  FiltrosOperacion,
  FiltrosViajesOperacion,
  OpcionRuta,
  OperacionRepositorio,
  ResultadoViajesOperacion,
  ResumenOperacion,
  RutaOperacion,
  ViajeEnAlerta,
  ViajeOperacion,
} from '../../dominio/operacion/operacion.ports';

const HOY_ECUADOR = sql`(now() AT TIME ZONE 'America/Guayaquil')::date`;

/** Un viaje por fila, con su capacidad, boletos vendidos e ingresos ya calculados. */
function viajesConOcupacion(donde: SQL): SQL {
  return sql`
    SELECT v.id AS viaje_id, v.cooperativa_id, v.ruta_id,
           v.fecha_salida::text AS fecha_salida,
           to_char(v.hora_salida_programada AT TIME ZONE 'America/Guayaquil', 'HH24:MI') AS hora_salida,
           v.hora_salida_programada,
           v.estado::text AS estado,
           co.nombre_comercial AS cooperativa,
           ori.ciudad || ' → ' || dest.ciudad AS ruta,
           un.placa,
           tv.capacidad_total AS capacidad,
           COALESCE(s.vendidos, 0) AS vendidos,
           COALESCE(s.cancelados, 0) AS cancelados,
           COALESCE(s.ingresos, 0)::float AS ingresos
    FROM viajes v
    INNER JOIN cooperativas co ON co.id = v.cooperativa_id
    INNER JOIN rutas r ON r.id = v.ruta_id
    INNER JOIN puntos_operacion ori ON ori.id = r.origen_punto_operacion_id
    INNER JOIN puntos_operacion dest ON dest.id = r.destino_punto_operacion_id
    INNER JOIN unidades un ON un.id = v.unidad_id
    INNER JOIN tipos_vehiculo tv ON tv.id = un.tipo_vehiculo_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE b.estado <> 'cancelado')::int AS vendidos,
             COUNT(*) FILTER (WHERE b.estado = 'cancelado')::int AS cancelados,
             SUM(b.precio_pagado) FILTER (WHERE b.estado <> 'cancelado') AS ingresos
      FROM boletos b
      INNER JOIN viaje_asientos va ON va.id = b.viaje_asiento_id
      WHERE va.viaje_id = v.id
    ) s ON TRUE
    WHERE ${donde}
  `;
}

function condicionesViajes(filtros: FiltrosOperacion): SQL {
  const desde = filtros.desde ? sql`${filtros.desde}::date` : HOY_ECUADOR;
  const hasta = filtros.hasta ? sql`${filtros.hasta}::date` : HOY_ECUADOR;
  const condiciones: SQL[] = [
    sql`v.fecha_salida BETWEEN ${desde} AND ${hasta}`,
  ];
  if (filtros.cooperativaId) {
    condiciones.push(sql`v.cooperativa_id = ${filtros.cooperativaId}`);
  }
  if (filtros.rutaId) {
    condiciones.push(sql`v.ruta_id = ${filtros.rutaId}`);
  }
  if (filtros.estado) {
    condiciones.push(sql`v.estado::text = ${filtros.estado}`);
  }
  return sql.join(condiciones, sql` AND `);
}

const porcentaje = (vendidos: number, capacidad: number) =>
  capacidad > 0 ? Math.round((vendidos * 100) / capacidad) : 0;

interface FilaViaje {
  viaje_id: string;
  fecha_salida: string;
  hora_salida: string;
  estado: EstadoViaje;
  cooperativa: string;
  ruta: string;
  placa: string;
  capacidad: number;
  vendidos: number;
  ingresos: number;
}

function aViaje(f: FilaViaje): ViajeOperacion {
  return {
    viajeId: f.viaje_id,
    fechaSalida: f.fecha_salida,
    horaSalida: f.hora_salida,
    cooperativa: f.cooperativa,
    ruta: f.ruta,
    placa: f.placa,
    estado: f.estado,
    capacidad: f.capacidad,
    vendidos: f.vendidos,
    ocupacion: porcentaje(f.vendidos, f.capacidad),
    ingresos: f.ingresos,
  };
}

/**
 * Solo lectura sobre toda la plataforma (todas las cooperativas): usa
 * DRIZZLE_DB_PUBLICO, como el resto de las consultas del panel de
 * administración de plataforma.
 */
@Injectable()
export class OperacionRepositorioDrizzle implements OperacionRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async resumen(filtros: FiltrosOperacion): Promise<ResumenOperacion> {
    const resultado = await this.db.execute(sql`
      WITH base AS (${viajesConOcupacion(condicionesViajes(filtros))})
      SELECT
        COUNT(*)::int AS total_viajes,
        COUNT(*) FILTER (WHERE estado = 'programado')::int AS programados,
        COUNT(*) FILTER (WHERE estado = 'en_curso')::int AS en_curso,
        COUNT(*) FILTER (WHERE estado = 'finalizado')::int AS finalizados,
        COUNT(*) FILTER (WHERE estado = 'cancelado')::int AS cancelados,
        COALESCE(SUM(vendidos), 0)::int AS boletos_vendidos,
        COALESCE(SUM(cancelados), 0)::int AS boletos_cancelados,
        COALESCE(SUM(ingresos), 0)::float AS ingresos,
        COALESCE(SUM(vendidos) FILTER (WHERE estado <> 'cancelado'), 0)::int AS vendidos_activos,
        COALESCE(SUM(capacidad) FILTER (WHERE estado <> 'cancelado'), 0)::int AS capacidad_activa
      FROM base
    `);
    const f = resultado.rows[0] as {
      total_viajes: number;
      programados: number;
      en_curso: number;
      finalizados: number;
      cancelados: number;
      boletos_vendidos: number;
      boletos_cancelados: number;
      ingresos: number;
      vendidos_activos: number;
      capacidad_activa: number;
    };
    return {
      totalViajes: f.total_viajes,
      viajesPorEstado: {
        programado: f.programados,
        en_curso: f.en_curso,
        finalizado: f.finalizados,
        cancelado: f.cancelados,
      },
      boletosVendidos: f.boletos_vendidos,
      boletosCancelados: f.boletos_cancelados,
      ingresos: f.ingresos,
      ocupacionPromedio: porcentaje(f.vendidos_activos, f.capacidad_activa),
    };
  }

  async listarViajes(
    filtros: FiltrosViajesOperacion,
  ): Promise<ResultadoViajesOperacion> {
    const base = viajesConOcupacion(condicionesViajes(filtros));
    const totalFilas = await this.db.execute(
      sql`WITH base AS (${base}) SELECT COUNT(*)::int AS total FROM base`,
    );
    const total = (totalFilas.rows[0] as { total: number }).total;

    const offset = (filtros.pagina - 1) * filtros.limite;
    const resultado = await this.db.execute(sql`
      WITH base AS (${base})
      SELECT * FROM base
      ORDER BY fecha_salida DESC, hora_salida_programada DESC, viaje_id
      LIMIT ${filtros.limite} OFFSET ${offset}
    `);
    return {
      filas: resultado.rows.map((f) => aViaje(f as unknown as FilaViaje)),
      total,
      pagina: filtros.pagina,
      limite: filtros.limite,
    };
  }

  async viajesParaExportar(
    filtros: FiltrosOperacion,
    maximo: number,
  ): Promise<ViajeOperacion[]> {
    const resultado = await this.db.execute(sql`
      WITH base AS (${viajesConOcupacion(condicionesViajes(filtros))})
      SELECT * FROM base
      ORDER BY fecha_salida DESC, hora_salida_programada DESC, viaje_id
      LIMIT ${maximo}
    `);
    return resultado.rows.map((f) => aViaje(f as unknown as FilaViaje));
  }

  async rutasDestacadas(
    filtros: FiltrosOperacion,
    maximo: number,
  ): Promise<RutaOperacion[]> {
    const resultado = await this.db.execute(sql`
      WITH base AS (${viajesConOcupacion(condicionesViajes(filtros))})
      SELECT ruta_id, cooperativa, ruta,
             COUNT(*)::int AS viajes,
             SUM(vendidos)::int AS vendidos,
             SUM(capacidad)::int AS capacidad,
             SUM(ingresos)::float AS ingresos
      FROM base
      WHERE estado <> 'cancelado'
      GROUP BY ruta_id, cooperativa, ruta
      ORDER BY SUM(vendidos) DESC, SUM(ingresos) DESC
      LIMIT ${maximo}
    `);
    return resultado.rows.map((fila) => {
      const f = fila as {
        ruta_id: string;
        cooperativa: string;
        ruta: string;
        viajes: number;
        vendidos: number;
        capacidad: number;
        ingresos: number;
      };
      return {
        rutaId: f.ruta_id,
        cooperativa: f.cooperativa,
        ruta: f.ruta,
        viajes: f.viajes,
        vendidos: f.vendidos,
        capacidad: f.capacidad,
        ocupacion: porcentaje(f.vendidos, f.capacidad),
        ingresos: f.ingresos,
      };
    });
  }

  async alertas(): Promise<AlertasOperacion> {
    const pagos = await this.db.execute(sql`
      SELECT COUNT(*)::int AS cantidad,
             (EXTRACT(EPOCH FROM (now() - MIN(creado_en))) / 3600)::float AS mas_antiguo_horas
      FROM pagos
      WHERE estado = 'pendiente' AND proveedor <> 'simulado' AND comprobante_url IS NOT NULL
    `);
    const p = pagos.rows[0] as {
      cantidad: number;
      mas_antiguo_horas: number | null;
    };

    const reclamos = await this.db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE estado = 'abierto')::int AS abiertos,
             COUNT(*) FILTER (WHERE estado = 'en_revision')::int AS en_revision
      FROM reclamos
    `);
    const r = reclamos.rows[0] as { abiertos: number; en_revision: number };

    // Viajes que ya debieron salir (más de 30 min de la hora programada) y
    // siguen en "programado": nadie los marcó como iniciados.
    const atrasados = await this.db.execute(sql`
      WITH base AS (${viajesConOcupacion(sql`
        v.estado = 'programado'
        AND v.hora_salida_programada < now() - interval '30 minutes'
        AND v.hora_salida_programada > now() - interval '3 days'
      `)})
      SELECT viaje_id, cooperativa, ruta, hora_salida, vendidos, capacidad,
             (EXTRACT(EPOCH FROM (now() - hora_salida_programada)) / 60)::int AS minutos_atraso
      FROM base
      ORDER BY hora_salida_programada ASC
      LIMIT 10
    `);

    // Salen en las próximas 12 horas con menos del 20 % de los asientos vendidos.
    const bajaOcupacion = await this.db.execute(sql`
      WITH base AS (${viajesConOcupacion(sql`
        v.estado = 'programado'
        AND v.hora_salida_programada BETWEEN now() AND now() + interval '12 hours'
      `)})
      SELECT viaje_id, cooperativa, ruta, hora_salida, vendidos, capacidad
      FROM base
      WHERE capacidad > 0 AND vendidos * 5 < capacidad
      ORDER BY hora_salida_programada ASC
      LIMIT 10
    `);

    // En curso y con la hora estimada de llegada ya pasada: falta la
    // confirmación de llegada de la cooperativa.
    const pendientesLlegada = await this.db.execute(sql`
      WITH base AS (${viajesConOcupacion(sql`
        v.estado = 'en_curso'
        AND COALESCE(
          v.hora_llegada_estimada,
          v.hora_salida_programada + COALESCE(r.duracion_estimada_minutos, 240) * interval '1 minute'
        ) <= now()
      `)})
      SELECT viaje_id, cooperativa, ruta, hora_salida, vendidos, capacidad
      FROM base
      ORDER BY hora_salida_programada ASC
      LIMIT 10
    `);

    const aAlerta = (fila: unknown): ViajeEnAlerta => {
      const f = fila as {
        viaje_id: string;
        cooperativa: string;
        ruta: string;
        hora_salida: string;
        vendidos: number;
        capacidad: number;
        minutos_atraso?: number;
      };
      return {
        viajeId: f.viaje_id,
        cooperativa: f.cooperativa,
        ruta: f.ruta,
        horaSalida: f.hora_salida,
        ocupacion: porcentaje(f.vendidos, f.capacidad),
        ...(f.minutos_atraso !== undefined
          ? { minutosAtraso: f.minutos_atraso }
          : {}),
      };
    };

    return {
      pagosPendientes: {
        cantidad: p.cantidad,
        masAntiguoHoras:
          p.mas_antiguo_horas === null
            ? null
            : Math.round(p.mas_antiguo_horas * 10) / 10,
      },
      reclamos: { abiertos: r.abiertos, enRevision: r.en_revision },
      viajesAtrasados: atrasados.rows.map(aAlerta),
      viajesBajaOcupacion: bajaOcupacion.rows.map(aAlerta),
      viajesPendientesLlegada: pendientesLlegada.rows.map(aAlerta),
    };
  }

  async opcionesRutas(cooperativaId?: string): Promise<OpcionRuta[]> {
    const resultado = await this.db.execute(sql`
      SELECT r.id, co.nombre_comercial || ' — ' || ori.ciudad || ' → ' || dest.ciudad AS nombre
      FROM rutas r
      INNER JOIN cooperativas co ON co.id = r.cooperativa_id
      INNER JOIN puntos_operacion ori ON ori.id = r.origen_punto_operacion_id
      INNER JOIN puntos_operacion dest ON dest.id = r.destino_punto_operacion_id
      WHERE r.activa = true
        ${cooperativaId ? sql`AND r.cooperativa_id = ${cooperativaId}` : sql``}
      ORDER BY co.nombre_comercial, ori.ciudad, dest.ciudad
      LIMIT 500
    `);
    return resultado.rows.map((f) => {
      const fila = f as { id: string; nombre: string };
      return { id: fila.id, nombre: fila.nombre };
    });
  }
}
