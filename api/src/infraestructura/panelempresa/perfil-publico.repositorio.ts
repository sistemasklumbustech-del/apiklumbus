import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import { ejecutarComoCooperativa } from '../database/tenant-transaction';

export interface PerfilPublicoCooperativa {
  descripcion: string;
  servicios: string[];
  beneficios: string[];
}

/** Lo que la cooperativa cuenta de sí misma en la página pública "Cooperativas". */
@Injectable()
export class PerfilPublicoRepositorio {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async obtener(cooperativaId: string): Promise<PerfilPublicoCooperativa> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT descripcion_publica, servicios_publicos, beneficios_publicos
        FROM cooperativas WHERE id = ${cooperativaId}
      `);
      const f = r.rows[0] as
        | {
            descripcion_publica: string | null;
            servicios_publicos: unknown;
            beneficios_publicos: unknown;
          }
        | undefined;
      const aLista = (v: unknown) =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      return {
        descripcion: f?.descripcion_publica ?? '',
        servicios: aLista(f?.servicios_publicos),
        beneficios: aLista(f?.beneficios_publicos),
      };
    });
  }

  async guardar(
    cooperativaId: string,
    perfil: PerfilPublicoCooperativa,
  ): Promise<void> {
    await ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      await tx.execute(sql`
        UPDATE cooperativas
        SET descripcion_publica = ${perfil.descripcion === '' ? null : perfil.descripcion},
            servicios_publicos = ${JSON.stringify(perfil.servicios)}::jsonb,
            beneficios_publicos = ${JSON.stringify(perfil.beneficios)}::jsonb
        WHERE id = ${cooperativaId}
      `);
    });
  }
}
