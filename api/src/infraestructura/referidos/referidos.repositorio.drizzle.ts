import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type { ReferidosRepositorio } from '../../dominio/referidos/referidos.ports';

/**
 * Usa DRIZZLE_DB_PUBLICO (bypass RLS) a propósito -- mismo criterio
 * que WalletRepositorioDrizzle: la relación de referidos es entre 2
 * usuarios, no pertenece a ninguna cooperativa.
 */
@Injectable()
export class ReferidosRepositorioDrizzle implements ReferidosRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async buscarUsuarioPorCodigoPasajero(
    codigo: string,
  ): Promise<{ id: string; cedula: string | null } | null> {
    const resultado = await this.db.execute(
      sql`SELECT id, cedula FROM usuarios WHERE codigo_pasajero = ${codigo} LIMIT 1`,
    );
    const fila = resultado.rows[0] as { id: string; cedula: string | null } | undefined;
    return fila ?? null;
  }

  async crearRelacion(datos: {
    usuarioReferidorId: string;
    usuarioReferidoId: string;
  }): Promise<{ id: string }> {
    const resultado = await this.db.execute(sql`
      INSERT INTO referidos (usuario_referidor_id, usuario_referido_id)
      VALUES (${datos.usuarioReferidorId}, ${datos.usuarioReferidoId})
      RETURNING id
    `);
    const fila = resultado.rows[0] as { id: string };
    return { id: fila.id };
  }

  async obtenerRelacionPendienteDeDescuento(
    usuarioReferidoId: string,
  ): Promise<{ id: string } | null> {
    const resultado = await this.db.execute(sql`
      SELECT id FROM referidos
      WHERE usuario_referido_id = ${usuarioReferidoId}
        AND descuento_aplicado_en IS NULL
      LIMIT 1
    `);
    const fila = resultado.rows[0] as { id: string } | undefined;
    return fila ?? null;
  }

  async marcarDescuentoAplicado(relacionId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE referidos SET descuento_aplicado_en = now() WHERE id = ${relacionId}
    `);
  }

  async obtenerRelacionPendienteDeCredito(
    usuarioReferidoId: string,
  ): Promise<{ id: string; usuarioReferidorId: string } | null> {
    const resultado = await this.db.execute(sql`
      SELECT id, usuario_referidor_id FROM referidos
      WHERE usuario_referido_id = ${usuarioReferidoId}
        AND boleto_que_disparo_credito_id IS NULL
      LIMIT 1
    `);
    const fila = resultado.rows[0] as
      | { id: string; usuario_referidor_id: string }
      | undefined;
    if (!fila) return null;
    return { id: fila.id, usuarioReferidorId: fila.usuario_referidor_id };
  }

  async marcarCreditoDisparado(relacionId: string, boletoId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE referidos SET boleto_que_disparo_credito_id = ${boletoId} WHERE id = ${relacionId}
    `);
  }

  async obtenerConfiguracion(): Promise<{
    creditoReferidor: number | null;
    descuentoReferido: number | null;
  }> {
    const resultado = await this.db.execute(sql`
      SELECT referido_credito_referidor_default, referido_descuento_referido_default
      FROM configuracion_plataforma LIMIT 1
    `);
    const fila = resultado.rows[0] as
      | { referido_credito_referidor_default: string | null; referido_descuento_referido_default: string | null }
      | undefined;
    return {
      creditoReferidor: fila?.referido_credito_referidor_default
        ? Number(fila.referido_credito_referidor_default)
        : null,
      descuentoReferido: fila?.referido_descuento_referido_default
        ? Number(fila.referido_descuento_referido_default)
        : null,
    };
  }

  /** Mismo patrón exacto que WalletRepositorioDrizzle.actualizarCashbackPorcentajeDefault. */
  async actualizarConfiguracion(
    datos: { creditoReferidor: number; descuentoReferido: number },
    actualizadoPorUsuarioId: string,
  ): Promise<void> {
    const filaExistente = await this.db.execute(
      sql`SELECT id FROM configuracion_plataforma LIMIT 1`,
    );
    let configuracionId: string;
    if (filaExistente.rows.length === 0) {
      const creada = await this.db.execute(sql`
        INSERT INTO configuracion_plataforma (ruc_plataforma, razon_social_plataforma, referido_credito_referidor_default, referido_descuento_referido_default)
        VALUES ('9999999999001', 'Columbus (pendiente RUC real)', ${datos.creditoReferidor}, ${datos.descuentoReferido})
        RETURNING id
      `);
      configuracionId = (creada.rows[0] as { id: string }).id;
    } else {
      configuracionId = (filaExistente.rows[0] as { id: string }).id;
      await this.db.execute(sql`
        UPDATE configuracion_plataforma
        SET referido_credito_referidor_default = ${datos.creditoReferidor},
            referido_descuento_referido_default = ${datos.descuentoReferido},
            actualizado_en = now()
        WHERE id = ${configuracionId}
      `);
    }

    await this.db.execute(sql`
      INSERT INTO auditoria_admin (accion, usuario_id, entidad_tipo, entidad_id, detalle)
      VALUES ('cambio_config_referidos', ${actualizadoPorUsuarioId}, 'configuracion_plataforma', ${configuracionId}, ${JSON.stringify(datos)})
    `);
  }

  async listarMisReferidos(usuarioReferidorId: string): Promise<
    { id: string; nombreReferido: string; creadoEn: string; creditoDisparado: boolean }[]
  > {
    const filas = await this.db.execute(sql`
      SELECT r.id, u.nombre_completo AS nombre_referido, r.creado_en,
             (r.boleto_que_disparo_credito_id IS NOT NULL) AS credito_disparado
      FROM referidos r
      JOIN usuarios u ON u.id = r.usuario_referido_id
      WHERE r.usuario_referidor_id = ${usuarioReferidorId}
      ORDER BY r.creado_en DESC
    `);
    return (
      filas.rows as {
        id: string;
        nombre_referido: string;
        creado_en: string;
        credito_disparado: boolean;
      }[]
    ).map((f) => ({
      id: f.id,
      nombreReferido: f.nombre_referido,
      creadoEn: f.creado_en,
      creditoDisparado: f.credito_disparado,
    }));
  }
}
