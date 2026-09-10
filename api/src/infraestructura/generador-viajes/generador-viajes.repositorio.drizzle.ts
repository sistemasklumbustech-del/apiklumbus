import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type {
  GeneradorViajesRepositorio,
  HorarioActivoParaGenerar,
} from '../../dominio/generador-viajes/generador-viajes.ports';

/**
 * DRIZZLE_DB_PUBLICO a propósito -- lo llama un cron que revisa
 * plantillas de TODAS las cooperativas, mismo criterio que
 * WebhooksRepositorioDrizzle y NotificacionesProgramadasRepositorioDrizzle.
 */
@Injectable()
export class GeneradorViajesRepositorioDrizzle implements GeneradorViajesRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async listarHorariosActivos(): Promise<HorarioActivoParaGenerar[]> {
    const resultado = await this.db.execute(sql`
      SELECT hr.id, r.cooperativa_id, hr.ruta_id, hr.hora_salida, hr.dias_semana,
             hr.tipo_vehiculo_predeterminado_id, r.precio_base_referencia
      FROM horarios_ruta hr
      JOIN rutas r ON r.id = hr.ruta_id
      WHERE hr.activo = true AND hr.tipo_vehiculo_predeterminado_id IS NOT NULL
    `);
    return resultado.rows.map((fila) => this.mapearFilaHorario(fila));
  }

  /**
   * 04-ago-2026 -- ítem 8, usado por la carga masiva para generar
   * viajes de los horarios que acaba de crear, mismo mecanismo que el
   * cron. `sql.join` (no `ANY`) a propósito -- ver el bug real que
   * causó esto mismo, corregido ayer en cancelarViaje.
   */
  async listarHorariosPorId(
    horarioIds: string[],
  ): Promise<HorarioActivoParaGenerar[]> {
    if (horarioIds.length === 0) return [];
    const resultado = await this.db.execute(sql`
      SELECT hr.id, r.cooperativa_id, hr.ruta_id, hr.hora_salida, hr.dias_semana,
             hr.tipo_vehiculo_predeterminado_id, r.precio_base_referencia
      FROM horarios_ruta hr
      JOIN rutas r ON r.id = hr.ruta_id
      WHERE hr.id IN (${sql.join(horarioIds, sql`, `)}) AND hr.activo = true
    `);
    return resultado.rows.map((fila) => this.mapearFilaHorario(fila));
  }

  private mapearFilaHorario(fila: unknown): HorarioActivoParaGenerar {
    const f = fila as {
      id: string;
      cooperativa_id: string;
      ruta_id: string;
      hora_salida: string;
      dias_semana: number[];
      tipo_vehiculo_predeterminado_id: string;
      precio_base_referencia: string;
    };
    return {
      id: f.id,
      cooperativaId: f.cooperativa_id,
      rutaId: f.ruta_id,
      horaSalida: f.hora_salida,
      diasSemana: f.dias_semana,
      tipoVehiculoPredeterminadoId: f.tipo_vehiculo_predeterminado_id,
      precioBaseReferencia: Number(f.precio_base_referencia),
    };
  }

  async existeViajeParaHorarioYFecha(horarioId: string, fecha: string): Promise<boolean> {
    const resultado = await this.db.execute(sql`
      SELECT 1 FROM viajes
      WHERE horario_ruta_origen_id = ${horarioId} AND fecha_salida = ${fecha}
      LIMIT 1
    `);
    return resultado.rows.length > 0;
  }

  async buscarUnidadDisponible(
    cooperativaId: string,
    tipoVehiculoId: string,
  ): Promise<{ unidadId: string } | null> {
    const resultado = await this.db.execute(sql`
      SELECT id FROM unidades
      WHERE cooperativa_id = ${cooperativaId} AND tipo_vehiculo_id = ${tipoVehiculoId} AND activo = true
      ORDER BY creado_en ASC
      LIMIT 1
    `);
    if (resultado.rows.length === 0) return null;
    return { unidadId: (resultado.rows[0] as { id: string }).id };
  }

  async crearViajeDesdeHorario(datos: {
    cooperativaId: string;
    rutaId: string;
    unidadId: string;
    horarioRutaOrigenId: string;
    fechaSalida: string;
    horaSalidaProgramada: string;
    precioBase: number;
  }): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO viajes (
        cooperativa_id, ruta_id, unidad_id, horario_ruta_origen_id,
        fecha_salida, hora_salida_programada, precio_base, estado
      )
      VALUES (
        ${datos.cooperativaId}, ${datos.rutaId}, ${datos.unidadId}, ${datos.horarioRutaOrigenId},
        ${datos.fechaSalida}, ${datos.horaSalidaProgramada}, ${datos.precioBase}, 'programado'
      )
    `);
  }
}
