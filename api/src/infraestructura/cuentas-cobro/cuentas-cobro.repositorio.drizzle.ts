import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type {
  CuentaCobro,
  CuentasCobroRepositorio,
  DatosCuentaCobro,
  EstadoCuentaCobro,
} from '../../dominio/cuentas-cobro/cuentas-cobro.ports';

interface Fila {
  id: string;
  cooperativa_id: string;
  cooperativa_nombre: string;
  entidad_financiera: string;
  tipo_cuenta: 'ahorros' | 'corriente';
  numero_cuenta: string;
  titular_nombre: string;
  titular_tipo_identificacion: 'cedula' | 'ruc';
  titular_identificacion: string;
  correo_notificacion: string;
  estado: EstadoCuentaCobro;
  motivo_rechazo: string | null;
  verificada_en: Date | string | null;
  creado_en: Date | string;
}

const aIso = (v: Date | string) =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

const mapear = (f: Fila): CuentaCobro => ({
  id: f.id,
  cooperativaId: f.cooperativa_id,
  cooperativaNombre: f.cooperativa_nombre,
  entidadFinanciera: f.entidad_financiera,
  tipoCuenta: f.tipo_cuenta,
  numeroCuenta: f.numero_cuenta,
  titularNombre: f.titular_nombre,
  titularTipoIdentificacion: f.titular_tipo_identificacion,
  titularIdentificacion: f.titular_identificacion,
  correoNotificacion: f.correo_notificacion,
  estado: f.estado,
  motivoRechazo: f.motivo_rechazo,
  verificadaEn: f.verificada_en ? aIso(f.verificada_en) : null,
  creadoEn: aIso(f.creado_en),
});

const SELECCION = sql`
  SELECT c.id, c.cooperativa_id, co.nombre AS cooperativa_nombre, c.entidad_financiera,
         c.tipo_cuenta, c.numero_cuenta, c.titular_nombre, c.titular_tipo_identificacion,
         c.titular_identificacion, c.correo_notificacion, c.estado, c.motivo_rechazo,
         c.verificada_en, c.creado_en
  FROM cuentas_cobro_cooperativa c
  INNER JOIN cooperativas co ON co.id = c.cooperativa_id
`;

/**
 * Usa DRIZZLE_DB_PUBLICO (rol de plataforma) con filtro explícito por
 * cooperativa (siempre del token) -- mismo criterio que reclamos.
 */
@Injectable()
export class CuentasCobroRepositorioDrizzle implements CuentasCobroRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async listarDeCooperativa(cooperativaId: string): Promise<CuentaCobro[]> {
    const r = await this.db.execute(sql`
      ${SELECCION}
      WHERE c.cooperativa_id = ${cooperativaId} AND c.estado <> 'reemplazada'
      ORDER BY c.creado_en DESC
    `);
    return (r.rows as unknown as Fila[]).map(mapear);
  }

  async registrar(
    cooperativaId: string,
    usuarioId: string,
    d: DatosCuentaCobro,
  ): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      // La solicitud pendiente anterior (si la hay) se descarta: solo cuenta la última.
      await tx.execute(sql`
        DELETE FROM cuentas_cobro_cooperativa
        WHERE cooperativa_id = ${cooperativaId} AND estado = 'pendiente_verificacion'
      `);
      const r = await tx.execute(sql`
        INSERT INTO cuentas_cobro_cooperativa
          (cooperativa_id, entidad_financiera, tipo_cuenta, numero_cuenta, titular_nombre,
           titular_tipo_identificacion, titular_identificacion, correo_notificacion,
           registrada_por_usuario_id)
        VALUES (${cooperativaId}, ${d.entidadFinanciera}::entidad_financiera,
                ${d.tipoCuenta}::tipo_cuenta_bancaria, ${d.numeroCuenta}, ${d.titularNombre},
                ${d.titularTipoIdentificacion}::tipo_identificacion_titular,
                ${d.titularIdentificacion}, ${d.correoNotificacion}, ${usuarioId})
        RETURNING id
      `);
      return { id: (r.rows[0] as { id: string }).id };
    });
  }

  async listarParaAdmin(estado?: EstadoCuentaCobro): Promise<CuentaCobro[]> {
    const filtro = estado
      ? sql`WHERE c.estado = ${estado}::estado_cuenta_cobro`
      : sql`WHERE c.estado <> 'reemplazada'`;
    const r = await this.db.execute(sql`
      ${SELECCION} ${filtro}
      ORDER BY (c.estado = 'pendiente_verificacion') DESC, c.creado_en DESC
      LIMIT 200
    `);
    return (r.rows as unknown as Fila[]).map(mapear);
  }

  async obtener(id: string): Promise<CuentaCobro | null> {
    const r = await this.db.execute(sql`${SELECCION} WHERE c.id = ${id}`);
    const fila = r.rows[0] as unknown as Fila | undefined;
    return fila ? mapear(fila) : null;
  }

  async verificar(id: string, adminId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE cuentas_cobro_cooperativa SET estado = 'reemplazada', actualizado_en = now()
        WHERE estado = 'verificada' AND id <> ${id}
          AND cooperativa_id = (SELECT cooperativa_id FROM cuentas_cobro_cooperativa WHERE id = ${id})
      `);
      await tx.execute(sql`
        UPDATE cuentas_cobro_cooperativa
        SET estado = 'verificada', verificada_por_usuario_id = ${adminId},
            verificada_en = now(), motivo_rechazo = NULL, actualizado_en = now()
        WHERE id = ${id} AND estado = 'pendiente_verificacion'
      `);
    });
  }

  async rechazar(id: string, adminId: string, motivo: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE cuentas_cobro_cooperativa
      SET estado = 'rechazada', verificada_por_usuario_id = ${adminId},
          verificada_en = now(), motivo_rechazo = ${motivo}, actualizado_en = now()
      WHERE id = ${id} AND estado = 'pendiente_verificacion'
    `);
  }
}
