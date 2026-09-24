import { Inject, Injectable } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type {
  EstadoViajeAutomatico,
  EstadoViajesRepositorio,
  ViajeCambiado,
  ViajePorConsultar,
} from '../../dominio/estado-viajes/estado-viajes.ports';

/** Si la ruta no tiene duración cargada y el viaje no trae hora de llegada, se asumen 4 horas. */
const DURACION_POR_DEFECTO_MINUTOS = 240;

/** Hora estimada de llegada de un viaje (v = viajes, r = rutas). */
const LLEGADA_ESTIMADA = sql`COALESCE(
  v.hora_llegada_estimada,
  v.hora_salida_programada + COALESCE(r.duracion_estimada_minutos, ${DURACION_POR_DEFECTO_MINUTOS}) * interval '1 minute'
)`;

/** El viaje vendió al menos un boleto (no cancelado): es lo que lo hace salir. */
const VIAJE_CON_BOLETOS = sql`EXISTS (
  SELECT 1 FROM boletos b
  INNER JOIN viaje_asientos va ON va.id = b.viaje_asiento_id
  WHERE va.viaje_id = v.id AND b.estado <> 'cancelado'
)`;

/**
 * El viaje tiene alguna venta en juego: un boleto, un asiento ocupado o
 * pendiente de confirmar el pago, o un bloqueo vigente. Un viaje así NO se
 * cancela aunque todavía no tenga un boleto confirmado: esa venta puede
 * concretarse (queda en las alertas del panel operativo para revisarlo).
 */
const VIAJE_CON_VENTAS = sql`(
  ${VIAJE_CON_BOLETOS}
  OR EXISTS (
    SELECT 1 FROM viaje_asientos va
    WHERE va.viaje_id = v.id
      AND (
        va.estado IN ('ocupado', 'pendiente_confirmacion_pago')
        OR (va.estado = 'bloqueado_temporal' AND va.hold_expira_en > now())
      )
  )
)`;

interface FilaCambio {
  viaje_id: string;
  cooperativa_id: string;
  ruta: string;
  hora_salida: string;
}

const RUTA_Y_HORA = sql`
  (SELECT ori.ciudad || ' → ' || dest.ciudad
     FROM puntos_operacion ori, puntos_operacion dest
    WHERE ori.id = r.origen_punto_operacion_id AND dest.id = r.destino_punto_operacion_id) AS ruta,
  to_char(v.hora_salida_programada AT TIME ZONE 'America/Guayaquil', 'HH24:MI') AS hora_salida
`;

function aCambios(
  filas: unknown[],
  anterior: EstadoViajeAutomatico,
  nuevo: EstadoViajeAutomatico,
): ViajeCambiado[] {
  return filas.map((fila) => {
    const f = fila as FilaCambio;
    return {
      viajeId: f.viaje_id,
      cooperativaId: f.cooperativa_id,
      anterior,
      nuevo,
      ruta: f.ruta,
      horaSalida: f.hora_salida,
    };
  });
}

/**
 * Cada cambio de estado es UN solo UPDATE ... WHERE estado = <anterior>
 * RETURNING: si dos ejecuciones se cruzan, solo una cambia cada viaje. Usa
 * DRIZZLE_DB_PUBLICO (rol de plataforma): es una tarea del sistema que
 * recorre a todas las cooperativas, sin usuario ni cooperativa de sesión.
 */
@Injectable()
export class EstadoViajesRepositorioDrizzle implements EstadoViajesRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  private async actualizar(
    nuevoEstado: EstadoViajeAutomatico,
    anterior: EstadoViajeAutomatico,
    condicion: SQL,
  ): Promise<ViajeCambiado[]> {
    // UPDATE ... FROM rutas r para poder usar r.* en las condiciones.
    const resultado = await this.db.execute(sql`
      UPDATE viajes v
      SET estado = ${nuevoEstado}
      FROM rutas r
      WHERE r.id = v.ruta_id
        AND v.estado = ${anterior}
        AND ${condicion}
      RETURNING v.id AS viaje_id, v.cooperativa_id, ${RUTA_Y_HORA}
    `);
    return aCambios(resultado.rows, anterior, nuevoEstado);
  }

  iniciarViajesConVentas(minutosEspera: number) {
    return this.actualizar(
      'en_curso',
      'programado',
      sql`v.hora_salida_programada <= now() - ${minutosEspera} * interval '1 minute' AND ${VIAJE_CON_BOLETOS}`,
    );
  }

  cancelarViajesSinVentas(minutosEspera: number) {
    return this.actualizar(
      'cancelado',
      'programado',
      sql`v.hora_salida_programada <= now() - ${minutosEspera} * interval '1 minute' AND NOT ${VIAJE_CON_VENTAS}`,
    );
  }

  finalizarViajesVencidos(horas: number) {
    return this.actualizar(
      'finalizado',
      'en_curso',
      sql`${LLEGADA_ESTIMADA} <= now() - ${horas} * interval '1 hour'`,
    );
  }

  async viajesParaConsultarLlegada(): Promise<ViajePorConsultar[]> {
    const resultado = await this.db.execute(sql`
      SELECT v.id AS viaje_id, v.cooperativa_id, co.nombre_comercial AS cooperativa,
             ${RUTA_Y_HORA}, un.placa
      FROM viajes v
      INNER JOIN rutas r ON r.id = v.ruta_id
      INNER JOIN cooperativas co ON co.id = v.cooperativa_id
      INNER JOIN unidades un ON un.id = v.unidad_id
      WHERE v.estado = 'en_curso'
        AND v.llegada_consultada_en IS NULL
        AND ${LLEGADA_ESTIMADA} <= now()
        AND ${LLEGADA_ESTIMADA} > now() - interval '24 hours'
    `);
    return resultado.rows.map((fila) => {
      const f = fila as unknown as FilaCambio & {
        cooperativa: string;
        placa: string;
      };
      return {
        viajeId: f.viaje_id,
        cooperativaId: f.cooperativa_id,
        cooperativaNombre: f.cooperativa,
        ruta: f.ruta,
        horaSalida: f.hora_salida,
        placa: f.placa,
      };
    });
  }

  async marcarLlegadaConsultada(viajeId: string): Promise<void> {
    await this.db.execute(
      sql`UPDATE viajes SET llegada_consultada_en = now() WHERE id = ${viajeId}`,
    );
  }

  async confirmarLlegada(
    cooperativaId: string,
    viajeId: string,
  ): Promise<ViajeCambiado | null> {
    const resultado = await this.db.execute(sql`
      UPDATE viajes v
      SET estado = 'finalizado'
      FROM rutas r
      WHERE r.id = v.ruta_id
        AND v.id = ${viajeId}
        AND v.cooperativa_id = ${cooperativaId}
        AND v.estado = 'en_curso'
      RETURNING v.id AS viaje_id, v.cooperativa_id, ${RUTA_Y_HORA}
    `);
    return aCambios(resultado.rows, 'en_curso', 'finalizado')[0] ?? null;
  }

  async correosDeCooperativa(cooperativaId: string): Promise<string[]> {
    const resultado = await this.db.execute(sql`
      SELECT contacto_correo AS correo FROM cooperativas
      WHERE id = ${cooperativaId} AND contacto_correo IS NOT NULL
      UNION
      SELECT correo FROM usuarios
      WHERE cooperativa_id = ${cooperativaId} AND rol = 'admin_cooperativa'
        AND activo = true AND correo IS NOT NULL
    `);
    return resultado.rows
      .map((f) => (f as { correo: string }).correo)
      .filter((c) => c.trim() !== '');
  }
}
