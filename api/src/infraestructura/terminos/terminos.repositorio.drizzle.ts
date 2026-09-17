import { Inject, Injectable } from '@nestjs/common';
import { desc, lte } from 'drizzle-orm';
import { terminosCondiciones, terminosAceptaciones } from '@columbus/db';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type {
  TerminosRepositorio,
  VersionTerminos,
  DatosAceptacionTerminos,
} from '../../dominio/terminos/terminos.ports';

@Injectable()
export class TerminosRepositorioDrizzle implements TerminosRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async obtenerVigente(): Promise<VersionTerminos | null> {
    const [fila] = await this.db
      .select()
      .from(terminosCondiciones)
      .where(lte(terminosCondiciones.vigenteDesde, new Date()))
      .orderBy(desc(terminosCondiciones.vigenteDesde))
      .limit(1);
    return fila ?? null;
  }

  async registrarAceptacion(datos: DatosAceptacionTerminos): Promise<void> {
    await this.db.insert(terminosAceptaciones).values({
      terminosVersionId: datos.terminosVersionId,
      usuarioId: datos.usuarioId,
      compraId: datos.compraId,
      direccionIp: datos.direccionIp,
    });
  }
}
