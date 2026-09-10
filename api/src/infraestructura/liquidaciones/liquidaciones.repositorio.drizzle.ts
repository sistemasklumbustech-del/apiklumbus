import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type {
  LiquidacionesRepositorio,
  LiquidacionCooperativa,
  ResultadoGenerarLiquidacion,
  ErrorGenerarLiquidacion,
} from '../../dominio/liquidaciones/liquidaciones.ports';

function aFechaISO(valor: unknown): string {
  if (valor instanceof Date) return valor.toISOString();
  return new Date(valor as string).toISOString();
}

function mapearFila(fila: Record<string, unknown>): LiquidacionCooperativa {
  return {
    id: fila.id as string,
    cooperativaId: fila.cooperativa_id as string,
    periodoInicio: fila.periodo_inicio as string,
    periodoFin: fila.periodo_fin as string,
    montoVentasBruto: Number(fila.monto_ventas_bruto),
    montoComisionPlataforma: Number(fila.monto_comision_plataforma),
    montoAjustes: Number(fila.monto_ajustes),
    montoLiquidado: Number(fila.monto_liquidado),
    estado: fila.estado as 'pendiente' | 'pagada',
    pagadoEn: fila.pagado_en ? aFechaISO(fila.pagado_en) : null,
    creadoEn: aFechaISO(fila.creado_en),
  };
}

@Injectable()
export class LiquidacionesRepositorioDrizzle implements LiquidacionesRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async generarLiquidacionCooperativa(
    cooperativaId: string,
    periodoInicio: string,
    periodoFin: string,
  ): Promise<ResultadoGenerarLiquidacion | ErrorGenerarLiquidacion> {
    // Corrección real de modelo de negocio (28-jul-2026, aclarado en
    // vivo con el usuario): la plataforma NO cobra un porcentaje de
    // comisión sobre las ventas de la cooperativa. Su único ingreso es
    // el cargo fijo por boleto (ya configurable en /admin/cargo-plataforma,
    // cobrado aparte al pasajero) — la cooperativa recibe el 100% de su
    // tarifa Y el 100% de la tasa de abordaje (que ella misma le compra
    // al terminal por fuera de la plataforma, según el modelo real
    // explicado por el usuario). La versión anterior de este cálculo
    // descontaba una comisión porcentual que nunca debió existir.
    const cooperativaResultado = await this.db.execute(sql`
      SELECT id FROM cooperativas WHERE id = ${cooperativaId}
    `);
    if (cooperativaResultado.rows.length === 0) {
      return { ok: false, motivo: 'La cooperativa no existe.' };
    }

    const solapadaResultado = await this.db.execute(sql`
      SELECT id FROM liquidaciones_cooperativa
      WHERE cooperativa_id = ${cooperativaId}
        AND periodo_inicio <= ${periodoFin}
        AND periodo_fin >= ${periodoInicio}
      LIMIT 1
    `);
    if (solapadaResultado.rows.length > 0) {
      return {
        ok: false,
        motivo:
          'Ya existe una liquidación para esta cooperativa con un período que se ' +
          'solapa con el solicitado.',
      };
    }

    // Tarifa: excluye el cargo fijo de plataforma y el IVA de cada
    // boleto (esas dos partes no son ingreso de la cooperativa). Tasa
    // de abordaje: 100% de la cooperativa, se suma completa desde
    // comprobantes_tasa_terminal (un comprobante por boleto).
    const ventasResultado = await this.db.execute(sql`
      SELECT
        COALESCE(SUM(b.precio_pagado - b.cargo_plataforma - b.iva_monto), 0) AS total_tarifa,
        COALESCE((
          SELECT SUM(ctt.monto)
          FROM comprobantes_tasa_terminal ctt
          INNER JOIN boletos b2 ON b2.id = ctt.boleto_id
          WHERE b2.cooperativa_id = ${cooperativaId}
            AND b2.estado IN ('vigente', 'usado')
            AND b2.creado_en::date >= ${periodoInicio}
            AND b2.creado_en::date <= ${periodoFin}
        ), 0) AS total_tasa_abordaje
      FROM boletos b
      WHERE b.cooperativa_id = ${cooperativaId}
        AND b.estado IN ('vigente', 'usado')
        AND b.creado_en::date >= ${periodoInicio}
        AND b.creado_en::date <= ${periodoFin}
    `);
    const fila = ventasResultado.rows[0] as { total_tarifa: string; total_tasa_abordaje: string };
    const montoVentasBruto = Number(
      (Number(fila.total_tarifa) + Number(fila.total_tasa_abordaje)).toFixed(2),
    );
    // Sin comisión: la cooperativa recibe el 100%. Se conserva la
    // columna en 0 (no se elimina de la tabla) porque `ajustesLiquidacion`
    // sí puede modificar el monto final más adelante (segunda entrega).
    const montoComisionPlataforma = 0;
    const montoLiquidado = montoVentasBruto;

    const insertResultado = await this.db.execute(sql`
      INSERT INTO liquidaciones_cooperativa
        (cooperativa_id, periodo_inicio, periodo_fin, monto_ventas_bruto,
         monto_comision_plataforma, monto_ajustes, monto_liquidado, estado)
      VALUES
        (${cooperativaId}, ${periodoInicio}, ${periodoFin}, ${montoVentasBruto},
         ${montoComisionPlataforma}, 0, ${montoLiquidado}, 'pendiente')
      RETURNING *
    `);

    return {
      ok: true,
      liquidacion: mapearFila(insertResultado.rows[0] as Record<string, unknown>),
    };
  }

  async listarLiquidacionesCooperativa(
    cooperativaId?: string,
  ): Promise<LiquidacionCooperativa[]> {
    const resultado = cooperativaId
      ? await this.db.execute(sql`
          SELECT * FROM liquidaciones_cooperativa
          WHERE cooperativa_id = ${cooperativaId}
          ORDER BY periodo_inicio DESC
        `)
      : await this.db.execute(sql`
          SELECT * FROM liquidaciones_cooperativa ORDER BY periodo_inicio DESC
        `);
    return resultado.rows.map((fila) => mapearFila(fila as Record<string, unknown>));
  }

  async marcarLiquidacionPagada(
    id: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    const resultado = await this.db.execute(sql`
      UPDATE liquidaciones_cooperativa
      SET estado = 'pagada', pagado_en = now()
      WHERE id = ${id} AND estado = 'pendiente'
      RETURNING id
    `);
    if (resultado.rows.length === 0) {
      return {
        ok: false,
        motivo: 'La liquidación no existe o ya estaba marcada como pagada.',
      };
    }
    return { ok: true };
  }
}
