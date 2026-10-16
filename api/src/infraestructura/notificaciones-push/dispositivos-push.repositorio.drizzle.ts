import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type {
  DispositivosPushRepositorio,
  PlataformaPush,
} from '../../dominio/notificaciones-push/notificaciones-push.ports';

/**
 * Usa DRIZZLE_DB_PUBLICO a propósito (mismo criterio que referidos y wallet): un dispositivo
 * pertenece a una persona, no a una cooperativa, así que la tabla no lleva RLS por cooperativa.
 */
@Injectable()
export class DispositivosPushRepositorioDrizzle implements DispositivosPushRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async registrar(
    usuarioId: string,
    token: string,
    plataforma: PlataformaPush,
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO dispositivos_push (usuario_id, token, plataforma)
      VALUES (${usuarioId}, ${token}, ${plataforma})
      ON CONFLICT (token) DO UPDATE
        SET usuario_id = EXCLUDED.usuario_id,
            plataforma = EXCLUDED.plataforma,
            activo = true,
            actualizado_en = now()
    `);
  }

  async eliminar(usuarioId: string, token: string): Promise<void> {
    await this.db.execute(
      sql`DELETE FROM dispositivos_push WHERE usuario_id = ${usuarioId} AND token = ${token}`,
    );
  }

  async listarTokensActivos(usuarioId: string): Promise<string[]> {
    const r = await this.db.execute(
      sql`SELECT token FROM dispositivos_push WHERE usuario_id = ${usuarioId} AND activo = true`,
    );
    return (r.rows as { token: string }[]).map((f) => f.token);
  }

  async desactivar(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.db.execute(sql`
      UPDATE dispositivos_push SET activo = false, actualizado_en = now()
      WHERE token IN (${sql.join(
        tokens.map((t) => sql`${t}`),
        sql`, `,
      )})
    `);
  }

  async obtenerUsuarioDeCompra(compraId: string): Promise<string | null> {
    const r = await this.db.execute(
      sql`SELECT comprador_usuario_id FROM compras WHERE id = ${compraId}`,
    );
    const fila = r.rows[0] as
      { comprador_usuario_id: string | null } | undefined;
    return fila?.comprador_usuario_id ?? null;
  }

  async obtenerUsuarioDePago(pagoId: string): Promise<string | null> {
    const r = await this.db.execute(sql`
      SELECT c.comprador_usuario_id FROM pagos p INNER JOIN compras c ON c.id = p.compra_id WHERE p.id = ${pagoId}
    `);
    const fila = r.rows[0] as
      { comprador_usuario_id: string | null } | undefined;
    return fila?.comprador_usuario_id ?? null;
  }
}
