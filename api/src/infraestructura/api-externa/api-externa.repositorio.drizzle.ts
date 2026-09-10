import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import { ejecutarComoCooperativa } from '../database/tenant-transaction';
import { BcryptHasher } from '../auth/bcrypt.hasher';
import type {
  ApiExternaRepositorio,
  EventoWebhookResumen,
} from '../../dominio/api-externa/api-externa.ports';

@Injectable()
export class ApiExternaRepositorioDrizzle implements ApiExternaRepositorio {
  constructor(
    @Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb,
    private readonly hasher: BcryptHasher,
  ) {}

  async validarCredencial(
    apiKeyPrefix: string,
    secreto: string,
  ): Promise<{ cooperativaId: string } | null> {
    const resultado = await this.db.execute(sql`
      SELECT cooperativa_id, api_key_hash FROM credenciales_api
      WHERE api_key_prefix = ${apiKeyPrefix} AND activo = true
      LIMIT 1
    `);
    if (resultado.rows.length === 0) return null;
    const fila = resultado.rows[0] as {
      cooperativa_id: string;
      api_key_hash: string | null;
    };
    if (!fila.api_key_hash) return null;
    const coincide = await this.hasher.comparar(secreto, fila.api_key_hash);
    if (!coincide) return null;
    return { cooperativaId: fila.cooperativa_id };
  }

  async actualizarPrecioViaje(
    cooperativaId: string,
    viajeId: string,
    precioBase: number,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        UPDATE viajes SET precio_base = ${precioBase}
        WHERE id = ${viajeId} AND cooperativa_id = ${cooperativaId}
        RETURNING id
      `);
      if (resultado.rows.length === 0) {
        return {
          ok: false as const,
          motivo: 'No existe un viaje con ese id para tu cooperativa.',
        };
      }
      return { ok: true as const };
    });
  }

  async actualizarUbicacionViaje(
    cooperativaId: string,
    viajeId: string,
    latitud: number,
    longitud: number,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        UPDATE viajes
        SET ubicacion_latitud = ${latitud},
            ubicacion_longitud = ${longitud},
            ubicacion_actualizada_en = now()
        WHERE id = ${viajeId} AND cooperativa_id = ${cooperativaId}
        RETURNING id
      `);
      if (resultado.rows.length === 0) {
        return {
          ok: false as const,
          motivo: 'No existe un viaje con ese id para tu cooperativa.',
        };
      }
      return { ok: true as const };
    });
  }

  async listarEventosWebhook(
    cooperativaId: string,
    desde?: string,
    hasta?: string,
  ): Promise<EventoWebhookResumen[]> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const condicionDesde = desde ? sql`AND creado_en >= ${desde}` : sql``;
      const condicionHasta = hasta ? sql`AND creado_en <= ${hasta}` : sql``;
      const resultado = await tx.execute(sql`
        SELECT id, evento, estado_entrega, intentos, ultimo_intento_en, ultima_respuesta, creado_en
        FROM webhooks_log
        WHERE cooperativa_id = ${cooperativaId} ${condicionDesde} ${condicionHasta}
        ORDER BY creado_en DESC
        LIMIT 200
      `);
      return resultado.rows.map((fila) => {
        const f = fila as {
          id: string;
          evento: string;
          estado_entrega: string;
          intentos: number;
          ultimo_intento_en: string | null;
          ultima_respuesta: string | null;
          creado_en: string;
        };
        return {
          id: f.id,
          evento: f.evento,
          estadoEntrega: f.estado_entrega,
          intentos: f.intentos,
          ultimoIntentoEn: f.ultimo_intento_en,
          ultimaRespuesta: f.ultima_respuesta,
          creadoEn: f.creado_en,
        };
      });
    });
  }
}
