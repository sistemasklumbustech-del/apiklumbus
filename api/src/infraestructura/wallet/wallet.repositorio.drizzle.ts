import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type { WalletRepositorio } from '../../dominio/wallet/wallet.ports';

/**
 * Usa DRIZZLE_DB_PUBLICO (bypass RLS) a propósito -- mismo criterio
 * que CalificacionesRepositorioDrizzle y creditos_pasajero (migración
 * 0010): el wallet es del usuario, cruza cooperativas por diseño, no
 * tiene ninguna política RLS por cooperativa (ver wallet.ts, schema).
 */
@Injectable()
export class WalletRepositorioDrizzle implements WalletRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async crearMovimiento(datos: {
    usuarioId: string;
    monto: number;
    tipo: string;
    compraId?: string;
  }): Promise<{ id: string }> {
    const resultado = await this.db.execute(sql`
      INSERT INTO wallet_movimientos (usuario_id, monto, tipo, compra_id)
      VALUES (${datos.usuarioId}, ${datos.monto}, ${datos.tipo}, ${datos.compraId ?? null})
      RETURNING id
    `);
    const fila = resultado.rows[0] as { id: string };
    return { id: fila.id };
  }

  /**
   * Fase 2 -- créditos vigentes (dentro de `diasVigencia` días) MENOS
   * todos los débitos, sin importar su antigüedad. `monto` siempre se
   * guarda como magnitud positiva en ambos tipos -- el signo se decide
   * aquí en la consulta, no al insertar, para que la tabla sea un
   * historial legible por sí mismo (un débito de $5 dice "5", no "-5").
   *
   * Programa de referidos (13-ago-2026) -- 'credito_referido' se suma
   * igual que 'credito_cashback', mismo plazo de vigencia de 180 días
   * (el proyecto no definió un plazo distinto para este tipo, se
   * asume el mismo criterio general).
   *
   * ⚠ Limitación real conocida, NO resuelta en esta fase (reportada,
   * no resuelta unilateralmente): si un crédito se gasta parcialmente
   * y ese mismo crédito expira más tarde (pasa de los 180 días), el
   * débito ya hecho sigue restando igual -- en un caso extremo el
   * saldo podría quedar negativo. Resolverlo de verdad requiere un
   * consumo tipo FIFO (marcar qué crédito específico cubrió cada
   * débito), que es más complejo que la suma simple de esta fase y no
   * estaba en el alcance pedido. Documentado también en
   * DOCUMENTO_MAESTRO.md.
   */
  async saldoDeUsuario(usuarioId: string, diasVigencia: number): Promise<number> {
    const resultado = await this.db.execute(sql`
      SELECT COALESCE(SUM(
        CASE
          WHEN tipo IN ('credito_cashback', 'credito_referido') AND creado_en >= now() - (${diasVigencia} || ' days')::interval THEN monto
          WHEN tipo = 'debito_compra' THEN -monto
          ELSE 0
        END
      ), 0) AS saldo
      FROM wallet_movimientos
      WHERE usuario_id = ${usuarioId}
    `);
    const fila = resultado.rows[0] as { saldo: string } | undefined;
    return fila?.saldo ? Number(fila.saldo) : 0;
  }

  async listarMovimientosDeUsuario(
    usuarioId: string,
  ): Promise<{ id: string; monto: number; tipo: string; creadoEn: string }[]> {
    const filas = await this.db.execute(sql`
      SELECT id, monto, tipo, creado_en
      FROM wallet_movimientos
      WHERE usuario_id = ${usuarioId}
      ORDER BY creado_en DESC
      LIMIT 50
    `);
    return (filas.rows as { id: string; monto: string; tipo: string; creado_en: string }[]).map((f) => ({
      id: f.id,
      monto: Number(f.monto),
      tipo: f.tipo,
      creadoEn: f.creado_en,
    }));
  }

  async obtenerCashbackPorcentajeDefault(): Promise<number | null> {
    const resultado = await this.db.execute(
      sql`SELECT cashback_porcentaje_default FROM configuracion_plataforma LIMIT 1`,
    );
    const fila = resultado.rows[0] as { cashback_porcentaje_default: string | null } | undefined;
    return fila?.cashback_porcentaje_default ? Number(fila.cashback_porcentaje_default) : null;
  }

  /**
   * Mismo patrón exacto que AdminRepositorioDrizzle.actualizarCargoPlataforma:
   * crea la fila de configuración si todavía no existe (singleton), y
   * deja registro de auditoría real (RF-ADMIN-005) con el valor nuevo.
   */
  async actualizarCashbackPorcentajeDefault(
    porcentaje: number,
    actualizadoPorUsuarioId: string,
  ): Promise<void> {
    const filaExistente = await this.db.execute(
      sql`SELECT id FROM configuracion_plataforma LIMIT 1`,
    );
    let configuracionId: string;
    if (filaExistente.rows.length === 0) {
      const creada = await this.db.execute(sql`
        INSERT INTO configuracion_plataforma (ruc_plataforma, razon_social_plataforma, cashback_porcentaje_default)
        VALUES ('9999999999001', 'Columbus (pendiente RUC real)', ${porcentaje})
        RETURNING id
      `);
      configuracionId = (creada.rows[0] as { id: string }).id;
    } else {
      configuracionId = (filaExistente.rows[0] as { id: string }).id;
      await this.db.execute(sql`
        UPDATE configuracion_plataforma
        SET cashback_porcentaje_default = ${porcentaje}, actualizado_en = now()
        WHERE id = ${configuracionId}
      `);
    }

    await this.db.execute(sql`
      INSERT INTO auditoria_admin (accion, usuario_id, entidad_tipo, entidad_id, detalle)
      VALUES ('cambio_cashback_porcentaje', ${actualizadoPorUsuarioId}, 'configuracion_plataforma', ${configuracionId}, ${JSON.stringify({ nuevoPorcentaje: porcentaje })})
    `);
  }
}
