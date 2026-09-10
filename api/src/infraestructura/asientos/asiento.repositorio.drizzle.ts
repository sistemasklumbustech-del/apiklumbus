import { Inject, Injectable } from '@nestjs/common';
import { eq, and, sql, ne } from 'drizzle-orm';
import { viajes, viajeAsientos, unidades, tiposVehiculo, cooperativas } from '@columbus/db';
import { DRIZZLE_DB_PUBLICO, DRIZZLE_DB } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import { ejecutarComoCooperativa } from '../database/tenant-transaction';
import {
  AsientoRepositorio,
  MapaAsientosViaje,
  ResultadoBloqueo,
  MINUTOS_BLOQUEO_ASIENTO_DEFECTO,
} from '../../dominio/asientos/asientos.ports';

@Injectable()
export class AsientoRepositorioDrizzle implements AsientoRepositorio {
  constructor(
    /** Lecturas: cross-tenant, igual que la búsqueda (ver BusquedaService). */
    @Inject(DRIZZLE_DB_PUBLICO) private readonly dbPublico: DrizzleDb,
    /** Escrituras: pasa por ejecutarComoCooperativa, nunca se usa "pelado". */
    @Inject(DRIZZLE_DB) private readonly dbApp: DrizzleDb,
  ) {}

  async obtenerCooperativaDelViaje(viajeId: string): Promise<string | null> {
    const fila = await this.dbPublico.query.viajes.findFirst({
      where: eq(viajes.id, viajeId),
      columns: { cooperativaId: true },
    });
    return fila?.cooperativaId ?? null;
  }

  async obtenerMapa(viajeId: string): Promise<MapaAsientosViaje | null> {
    const viaje = await this.dbPublico
      .select({
        capacidadTotal: tiposVehiculo.capacidadTotal,
        distribucionAsientos: tiposVehiculo.distribucionAsientos,
        // Política de cancelación/reprogramación (29-jul-2026, hallazgo
        // real de negocio): el pasajero debe saber ANTES de comprar si
        // esta cooperativa permite cambios o devoluciones -- no
        // descubrirlo después de haber pagado.
        permiteCancelacion: cooperativas.permiteCancelacion,
        permiteReprogramacion: cooperativas.permiteReprogramacion,
      })
      .from(viajes)
      .innerJoin(unidades, eq(viajes.unidadId, unidades.id))
      .innerJoin(tiposVehiculo, eq(unidades.tipoVehiculoId, tiposVehiculo.id))
      .innerJoin(cooperativas, eq(viajes.cooperativaId, cooperativas.id))
      .where(eq(viajes.id, viajeId))
      .limit(1);

    if (viaje.length === 0) return null;

    const noDisponibles = await this.dbPublico
      .select({
        numeroAsiento: viajeAsientos.numeroAsiento,
        estado: viajeAsientos.estado,
        holdExpiraEn: viajeAsientos.holdExpiraEn,
      })
      .from(viajeAsientos)
      .where(
        and(
          eq(viajeAsientos.viajeId, viajeId),
          ne(viajeAsientos.estado, 'disponible'),
        ),
      );

    return {
      viajeId,
      capacidadTotal: viaje[0].capacidadTotal,
      distribucionAsientos: viaje[0].distribucionAsientos,
      asientosNoDisponibles: noDisponibles,
      permiteCancelacion: viaje[0].permiteCancelacion,
      permiteReprogramacion: viaje[0].permiteReprogramacion,
    };
  }

  /**
   * RF-SEAT-004/005 — bloqueo temporal con prevención de doble venta
   * real. Corre dentro de una transacción con `SET LOCAL
   * app.current_cooperativa_id` (vía ejecutarComoCooperativa) y usa
   * `SELECT ... FOR UPDATE` para serializar dos intentos simultáneos
   * sobre el mismo asiento — Postgres bloquea la segunda transacción
   * hasta que la primera termine, y para entonces ya ve el estado
   * actualizado, no el viejo.
   */
  // Item 31, Fase 7 (11-ago-2026) -- compra como invitado. Exactamente
  // uno de usuarioId/sesionInvitadoId trae valor, nunca los 2 -- el
  // servicio ya valida esto antes de llegar aqui.
  async bloquear(
    viajeId: string,
    numeroAsiento: string,
    usuarioId: string | null,
    sesionInvitadoId: string | null,
    cooperativaId: string,
  ): Promise<ResultadoBloqueo> {
    return ejecutarComoCooperativa(this.dbApp, cooperativaId, async (tx) => {
      const expiraEn = new Date(
        Date.now() + MINUTOS_BLOQUEO_ASIENTO_DEFECTO * 60 * 1000,
      );

      const existente = await tx.execute(
        sql`SELECT id, estado, hold_expira_en, hold_usuario_id, hold_sesion_invitado_id FROM viaje_asientos
            WHERE viaje_id = ${viajeId} AND numero_asiento = ${numeroAsiento}
            FOR UPDATE`,
      );

      if (existente.rows.length === 0) {
        // Nadie ha tocado este asiento todavía para este viaje. Insertar
        // directo; si otra transacción concurrente gana la carrera e
        // inserta primero, esta INSERT falla por el índice único
        // (viaje_id, numero_asiento) — se captura como "perdiste la
        // carrera", que es exactamente el comportamiento correcto.
        try {
          await tx.execute(
            sql`INSERT INTO viaje_asientos (viaje_id, numero_asiento, estado, hold_expira_en, hold_usuario_id, hold_sesion_invitado_id)
                VALUES (${viajeId}, ${numeroAsiento}, 'bloqueado_temporal', ${expiraEn}, ${usuarioId}, ${sesionInvitadoId})`,
          );
          return { exito: true, expiraEn };
        } catch {
          return { exito: false, motivo: 'bloqueado_por_otro_usuario' };
        }
      }

      const fila = existente.rows[0] as {
        estado: string;
        hold_expira_en: Date | null;
        hold_usuario_id: string | null;
        hold_sesion_invitado_id: string | null;
      };

      if (fila.estado === 'ocupado') {
        return { exito: false, motivo: 'ocupado' };
      }

      const holdVigente =
        fila.hold_expira_en &&
        new Date(fila.hold_expira_en).getTime() > Date.now();
      // El dueno del hold es el mismo si coincide su usuarioId (cuenta
      // real) O su sesionInvitadoId (invitado) -- nunca los 2 juntos.
      const esElMismoDueno =
        (usuarioId !== null && fila.hold_usuario_id === usuarioId) ||
        (sesionInvitadoId !== null &&
          fila.hold_sesion_invitado_id === sesionInvitadoId);
      const esOtroUsuario = !esElMismoDueno;

      if (
        fila.estado === 'bloqueado_temporal' &&
        holdVigente &&
        esOtroUsuario
      ) {
        return { exito: false, motivo: 'bloqueado_por_otro_usuario' };
      }

      // Disponible, o el hold ya expiró, o es el mismo usuario re-
      // seleccionando su propio asiento — se (re)bloquea.
      await tx.execute(
        sql`UPDATE viaje_asientos
            SET estado = 'bloqueado_temporal', hold_expira_en = ${expiraEn}, hold_usuario_id = ${usuarioId}, hold_sesion_invitado_id = ${sesionInvitadoId}
            WHERE viaje_id = ${viajeId} AND numero_asiento = ${numeroAsiento}`,
      );
      return { exito: true, expiraEn };
    });
  }
}
