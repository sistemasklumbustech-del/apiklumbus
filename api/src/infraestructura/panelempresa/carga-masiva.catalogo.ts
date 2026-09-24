import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type { CatalogoCooperativa, PuntoCatalogo } from './carga-masiva.excel';

/**
 * Lecturas para armar y validar la plantilla de carga masiva. Usa el rol de
 * plataforma con filtro EXPLÍCITO por cooperativa (siempre la del token).
 */
@Injectable()
export class CargaMasivaCatalogo {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async puntos(): Promise<PuntoCatalogo[]> {
    const r = await this.db.execute(sql`
      SELECT id, nombre, ciudad, provincia, tipo
      FROM puntos_operacion
      WHERE estado = 'aprobado'
    `);
    return r.rows as unknown as PuntoCatalogo[];
  }

  async deCooperativa(cooperativaId: string): Promise<CatalogoCooperativa> {
    const [puntos, tipos, rutas, conductores, unidades] = await Promise.all([
      this.puntos(),
      this.db.execute(
        sql`SELECT id, nombre FROM tipos_vehiculo WHERE cooperativa_id = ${cooperativaId}`,
      ),
      this.db.execute(sql`
        SELECT r.id, r.nombre, ori.ciudad AS origen_ciudad, dest.ciudad AS destino_ciudad
        FROM rutas r
        INNER JOIN puntos_operacion ori ON ori.id = r.origen_punto_operacion_id
        INNER JOIN puntos_operacion dest ON dest.id = r.destino_punto_operacion_id
        WHERE r.cooperativa_id = ${cooperativaId}
      `),
      this.db.execute(
        sql`SELECT cedula FROM conductores WHERE cooperativa_id = ${cooperativaId}`,
      ),
      this.db.execute(
        sql`SELECT placa FROM unidades WHERE cooperativa_id = ${cooperativaId}`,
      ),
    ]);
    return {
      puntos,
      tiposVehiculo: tipos.rows as unknown as { id: string; nombre: string }[],
      rutas: (
        rutas.rows as unknown as {
          id: string;
          nombre: string | null;
          origen_ciudad: string;
          destino_ciudad: string;
        }[]
      ).map((f) => ({
        id: f.id,
        nombre: f.nombre,
        origenCiudad: f.origen_ciudad,
        destinoCiudad: f.destino_ciudad,
      })),
      cedulas: new Set(
        (conductores.rows as unknown as { cedula: string }[]).map(
          (f) => f.cedula,
        ),
      ),
      placas: new Set(
        (unidades.rows as unknown as { placa: string }[]).map((f) =>
          f.placa.toUpperCase().replace(/\s/g, ''),
        ),
      ),
    };
  }
}
