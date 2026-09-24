import { Inject, Injectable } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type {
  AuditoriaConsultaRepositorio,
  FiltrosAuditoria,
  RegistroAuditoria,
  ResultadoAuditoria,
} from '../../dominio/auditoria/auditoria.ports';

const DESDE_AUDITORIA = sql`
  FROM auditoria_admin a
  LEFT JOIN usuarios u ON u.id = a.usuario_id
`;

const COLUMNAS_AUDITORIA = sql`
  a.id, a.creado_en, a.accion::text AS accion, a.origen, a.resultado,
  a.usuario_id, u.nombre_completo AS usuario_nombre, u.correo AS usuario_correo,
  u.rol::text AS usuario_rol, a.entidad_tipo, a.entidad_id, a.direccion_ip, a.detalle
`;

interface FilaAuditoria {
  id: string;
  creado_en: Date | string;
  accion: string;
  origen: 'usuario' | 'sistema';
  resultado: 'exito' | 'fallo';
  usuario_id: string | null;
  usuario_nombre: string | null;
  usuario_correo: string | null;
  usuario_rol: string | null;
  entidad_tipo: string;
  entidad_id: string | null;
  direccion_ip: string | null;
  detalle: unknown;
}

function aRegistro(f: FilaAuditoria): RegistroAuditoria {
  return {
    id: f.id,
    creadoEn:
      f.creado_en instanceof Date
        ? f.creado_en.toISOString()
        : new Date(f.creado_en).toISOString(),
    accion: f.accion,
    origen: f.origen,
    resultado: f.resultado,
    usuarioId: f.usuario_id,
    usuarioNombre: f.usuario_nombre,
    usuarioCorreo: f.usuario_correo,
    usuarioRol: f.usuario_rol,
    entidadTipo: f.entidad_tipo,
    entidadId: f.entidad_id,
    direccionIp: f.direccion_ip,
    detalle: f.detalle,
  };
}

function condicionesDe(
  filtros: Omit<FiltrosAuditoria, 'pagina' | 'limite'>,
): SQL {
  const condiciones: SQL[] = [sql`TRUE`];
  if (filtros.accion) {
    condiciones.push(sql`a.accion::text = ${filtros.accion}`);
  }
  if (filtros.origen) {
    condiciones.push(sql`a.origen = ${filtros.origen}`);
  }
  if (filtros.resultado) {
    condiciones.push(sql`a.resultado = ${filtros.resultado}`);
  }
  if (filtros.ip?.trim()) {
    condiciones.push(sql`a.direccion_ip ILIKE ${`%${filtros.ip.trim()}%`}`);
  }
  if (filtros.desde) {
    condiciones.push(
      sql`(a.creado_en AT TIME ZONE 'America/Guayaquil')::date >= ${filtros.desde}::date`,
    );
  }
  if (filtros.hasta) {
    condiciones.push(
      sql`(a.creado_en AT TIME ZONE 'America/Guayaquil')::date <= ${filtros.hasta}::date`,
    );
  }
  const texto = filtros.busqueda?.trim();
  if (texto) {
    const patron = `%${texto}%`;
    condiciones.push(
      sql`(u.nombre_completo ILIKE ${patron} OR u.correo ILIKE ${patron} OR a.entidad_tipo ILIKE ${patron} OR a.detalle::text ILIKE ${patron})`,
    );
  }
  return sql.join(condiciones, sql` AND `);
}

/**
 * Solo lectura. Usa DRIZZLE_DB_PUBLICO: la auditoría es de toda la
 * plataforma (no de una cooperativa) y solo la consulta el panel de
 * administración de plataforma.
 */
@Injectable()
export class AuditoriaConsultaRepositorioDrizzle implements AuditoriaConsultaRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async listar(filtros: FiltrosAuditoria): Promise<ResultadoAuditoria> {
    const donde = condicionesDe(filtros);
    const totalFilas = await this.db.execute(
      sql`SELECT COUNT(*)::int AS total ${DESDE_AUDITORIA} WHERE ${donde}`,
    );
    const total = (totalFilas.rows[0] as { total: number }).total;

    const offset = (filtros.pagina - 1) * filtros.limite;
    const resultado = await this.db.execute(sql`
      SELECT ${COLUMNAS_AUDITORIA}
      ${DESDE_AUDITORIA}
      WHERE ${donde}
      ORDER BY a.creado_en DESC, a.id
      LIMIT ${filtros.limite} OFFSET ${offset}
    `);
    return {
      filas: resultado.rows.map((f) =>
        aRegistro(f as unknown as FilaAuditoria),
      ),
      total,
      pagina: filtros.pagina,
      limite: filtros.limite,
    };
  }

  async listarParaExportar(
    filtros: Omit<FiltrosAuditoria, 'pagina' | 'limite'>,
    maximo: number,
  ): Promise<RegistroAuditoria[]> {
    const resultado = await this.db.execute(sql`
      SELECT ${COLUMNAS_AUDITORIA}
      ${DESDE_AUDITORIA}
      WHERE ${condicionesDe(filtros)}
      ORDER BY a.creado_en DESC, a.id
      LIMIT ${maximo}
    `);
    return resultado.rows.map((f) => aRegistro(f as unknown as FilaAuditoria));
  }

  async listarAcciones(): Promise<string[]> {
    const resultado = await this.db.execute(
      sql`SELECT unnest(enum_range(NULL::accion_auditoria))::text AS accion`,
    );
    return resultado.rows.map((f) => (f as { accion: string }).accion);
  }
}
