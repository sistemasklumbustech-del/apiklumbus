import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../infraestructura/database/database.module';
import type { DrizzleDb } from '../../infraestructura/database/database.provider';

/**
 * Endpoint de verificación real: no solo confirma que la app arrancó,
 * sino que además ejecuta una consulta real contra Postgres, para
 * detectar de inmediato si la conexión/credenciales/esquema fallan —
 * consistente con la práctica del resto del proyecto de verificar contra
 * una base de datos real, no solo confiar en que "debería funcionar".
 */
@Controller('salud')
export class SaludController {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  @Get()
  async verificar() {
    const resultado = await this.db.execute(
      sql`SELECT count(*)::int AS total FROM cooperativas`,
    );
    const totalCooperativas = (resultado.rows[0] as { total: number }).total;
    return {
      estado: 'ok',
      baseDeDatos: 'conectada',
      totalCooperativas,
    };
  }
}
