import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import { ipActual, userAgentActual } from './contexto-solicitud';

export interface DatosAuditoria {
  /** Debe ser un valor del enum accion_auditoria. */
  accion: string;
  /** Quién lo hizo; null si no hay usuario identificado (login fallido de un correo inexistente, tareas del sistema). */
  usuarioId?: string | null;
  entidadTipo: string;
  entidadId?: string | null;
  detalle?: Record<string, unknown>;
  resultado?: 'exito' | 'fallo';
  /** 'sistema' para tareas automáticas (cron), sin persona detrás. */
  origen?: 'usuario' | 'sistema';
}

/**
 * Registro de auditoría (RF-021) para los servicios de la aplicación.
 * Guarda IP y navegador de la solicitud en curso, el resultado y si la
 * originó una persona o el sistema.
 *
 * Nunca lanza: una auditoría que no se pudo escribir se deja en el log
 * del servidor, pero no debe tumbar la operación real del usuario (un
 * inicio de sesión, un pago) por un problema del registro.
 */
@Injectable()
export class AuditoriaRegistrador {
  private readonly logger = new Logger(AuditoriaRegistrador.name);

  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async registrar(datos: DatosAuditoria): Promise<void> {
    try {
      await this.db.execute(sql`
        INSERT INTO auditoria_admin
          (accion, usuario_id, entidad_tipo, entidad_id, detalle, direccion_ip, user_agent, resultado, origen)
        VALUES (
          ${datos.accion},
          ${datos.usuarioId ?? null},
          ${datos.entidadTipo},
          ${datos.entidadId ?? null},
          ${JSON.stringify(datos.detalle ?? {})}::jsonb,
          ${ipActual()},
          ${userAgentActual()},
          ${datos.resultado ?? 'exito'},
          ${datos.origen ?? 'usuario'}
        )
      `);
    } catch (error) {
      this.logger.error(
        `No se pudo registrar la auditoría "${datos.accion}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
