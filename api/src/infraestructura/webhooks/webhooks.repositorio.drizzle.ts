import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type {
  WebhooksRepositorio,
  EventoWebhookPendiente,
} from '../../dominio/webhooks/webhooks.ports';

const MAX_INTENTOS = 5;

/**
 * Usa DRIZZLE_DB_PUBLICO (bypass RLS) a propósito, mismo criterio que
 * AdminRepositorioDrizzle: este repositorio no atiende una sesión web
 * de una cooperativa en particular -- es contabilidad interna de
 * plataforma, disparada por el flujo de checkout ya validado, y leída
 * después por un cron que revisa TODAS las cooperativas a la vez.
 */
@Injectable()
export class WebhooksRepositorioDrizzle implements WebhooksRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async obtenerWebhookActivo(cooperativaId: string): Promise<{ webhookUrl: string } | null> {
    const resultado = await this.db.execute(sql`
      SELECT webhook_url FROM credenciales_api
      WHERE cooperativa_id = ${cooperativaId} AND activo = true AND webhook_url IS NOT NULL
      ORDER BY creado_en DESC
      LIMIT 1
    `);
    if (resultado.rows.length === 0) return null;
    const fila = resultado.rows[0] as { webhook_url: string | null };
    return fila.webhook_url ? { webhookUrl: fila.webhook_url } : null;
  }

  async crearEventoWebhook(
    cooperativaId: string,
    compraId: string,
    evento: string,
    payload: unknown,
  ): Promise<{ id: string }> {
    const resultado = await this.db.execute(sql`
      INSERT INTO webhooks_log (cooperativa_id, compra_id, evento, payload, estado_entrega)
      VALUES (${cooperativaId}, ${compraId}, ${evento}, ${JSON.stringify(payload)}, 'pendiente')
      RETURNING id
    `);
    return { id: (resultado.rows[0] as { id: string }).id };
  }

  async marcarEntregado(id: string, respuesta: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE webhooks_log
      SET estado_entrega = 'confirmado',
          intentos = intentos + 1,
          ultimo_intento_en = now(),
          ultima_respuesta = ${respuesta}
      WHERE id = ${id}
    `);
  }

  async registrarIntentoFallido(id: string, respuesta: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE webhooks_log
      SET intentos = intentos + 1,
          ultimo_intento_en = now(),
          ultima_respuesta = ${respuesta},
          estado_entrega = CASE WHEN intentos + 1 >= ${MAX_INTENTOS} THEN 'fallido' ELSE 'pendiente' END
      WHERE id = ${id}
    `);
  }

  async listarPendientesParaReintentar(maxIntentos: number): Promise<EventoWebhookPendiente[]> {
    const resultado = await this.db.execute(sql`
      SELECT w.id, w.cooperativa_id, w.payload, w.intentos, c.webhook_url
      FROM webhooks_log w
      JOIN credenciales_api c
        ON c.cooperativa_id = w.cooperativa_id AND c.activo = true AND c.webhook_url IS NOT NULL
      WHERE w.estado_entrega = 'pendiente' AND w.intentos < ${maxIntentos}
      ORDER BY w.creado_en ASC
      LIMIT 100
    `);
    return resultado.rows.map((fila) => {
      const f = fila as {
        id: string;
        cooperativa_id: string;
        payload: unknown;
        intentos: number;
        webhook_url: string;
      };
      return {
        id: f.id,
        cooperativaId: f.cooperativa_id,
        webhookUrl: f.webhook_url,
        evento: 'venta_creada',
        payload: f.payload,
        intentos: f.intentos,
      };
    });
  }
}
