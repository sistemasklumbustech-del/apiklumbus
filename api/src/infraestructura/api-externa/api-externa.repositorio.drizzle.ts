import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import { ejecutarComoCooperativa } from '../database/tenant-transaction';
import { BcryptHasher } from '../auth/bcrypt.hasher';
import { extraerNumerosValidos } from '../../dominio/asientos/distribucion-asientos.util';
import type {
  ApiExternaRepositorio,
  AsientosDeViajeExterno,
  CatalogoCooperativa,
  DatosViajeExterno,
  EstadoAsientoExterno,
  EventoWebhookResumen,
  ResultadoAsientoExterno,
  ResultadoGuardarViaje,
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

  async catalogo(cooperativaId: string): Promise<CatalogoCooperativa> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const rutas = await tx.execute(sql`
        SELECT r.id, r.nombre, r.precio_base_referencia, r.activa,
               po_o.id AS origen_id, po_o.nombre AS origen_nombre, po_o.ciudad AS origen_ciudad,
               po_d.id AS destino_id, po_d.nombre AS destino_nombre, po_d.ciudad AS destino_ciudad
        FROM rutas r
        JOIN puntos_operacion po_o ON po_o.id = r.origen_punto_operacion_id
        JOIN puntos_operacion po_d ON po_d.id = r.destino_punto_operacion_id
        WHERE r.cooperativa_id = ${cooperativaId}
        ORDER BY po_o.ciudad, po_d.ciudad
      `);
      const unidades = await tx.execute(sql`
        SELECT u.id, u.placa, u.identificador_operativo, u.activo, tv.nombre AS tipo_vehiculo, tv.capacidad_total
        FROM unidades u
        JOIN tipos_vehiculo tv ON tv.id = u.tipo_vehiculo_id
        WHERE u.cooperativa_id = ${cooperativaId}
        ORDER BY u.identificador_operativo
      `);
      return {
        rutas: (rutas.rows as unknown as Record<string, string | boolean | null>[]).map((r) => ({
          id: r.id as string,
          nombre: r.nombre as string | null,
          origen: { id: r.origen_id as string, nombre: r.origen_nombre as string, ciudad: r.origen_ciudad as string },
          destino: { id: r.destino_id as string, nombre: r.destino_nombre as string, ciudad: r.destino_ciudad as string },
          precioBaseReferencia: Number(r.precio_base_referencia),
          activa: r.activa as boolean,
        })),
        unidades: (unidades.rows as unknown as Record<string, string | number | boolean>[]).map((u) => ({
          id: u.id as string,
          placa: u.placa as string,
          identificadorOperativo: u.identificador_operativo as string,
          tipoVehiculo: u.tipo_vehiculo as string,
          capacidadTotal: Number(u.capacidad_total),
          activo: u.activo as boolean,
        })),
      };
    });
  }

  async guardarViaje(
    cooperativaId: string,
    referenciaExterna: string,
    datos: DatosViajeExterno,
  ): Promise<ResultadoGuardarViaje> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const ruta = await tx.execute(
        sql`SELECT 1 FROM rutas WHERE id = ${datos.rutaId} AND cooperativa_id = ${cooperativaId} AND activa = true`,
      );
      if (ruta.rows.length === 0) {
        return { ok: false as const, codigo: 'ruta_invalida' as const, motivo: 'La ruta no existe, está inactiva o no es de tu cooperativa.' };
      }
      const unidad = await tx.execute(
        sql`SELECT 1 FROM unidades WHERE id = ${datos.unidadId} AND cooperativa_id = ${cooperativaId} AND activo = true`,
      );
      if (unidad.rows.length === 0) {
        return { ok: false as const, codigo: 'unidad_invalida' as const, motivo: 'La unidad no existe, está inactiva o no es de tu cooperativa.' };
      }

      const existente = await tx.execute(sql`
        SELECT id, estado, ruta_id, unidad_id, hora_salida_programada
        FROM viajes WHERE cooperativa_id = ${cooperativaId} AND referencia_externa = ${referenciaExterna}
        FOR UPDATE
      `);
      const actual = existente.rows[0] as
        | { id: string; estado: string; ruta_id: string; unidad_id: string; hora_salida_programada: Date | string }
        | undefined;

      if (!actual) {
        const nuevo = await tx.execute(sql`
          INSERT INTO viajes (cooperativa_id, ruta_id, unidad_id, fecha_salida, hora_salida_programada, hora_llegada_estimada,
                              recargo_vip, precio_base, estado, referencia_externa)
          VALUES (
            ${cooperativaId}, ${datos.rutaId}, ${datos.unidadId}, ${datos.fechaSalida}, ${datos.horaSalidaProgramada},
            ${datos.horaLlegadaEstimada ?? null},
            COALESCE(${datos.recargoVip ?? null}, (SELECT recargo_vip_default FROM cooperativas WHERE id = ${cooperativaId}), 0),
            ${datos.precioBase}, 'programado', ${referenciaExterna}
          )
          RETURNING id
        `);
        return { ok: true as const, id: (nuevo.rows[0] as { id: string }).id, creado: true };
      }

      if (actual.estado !== 'programado') {
        return {
          ok: false as const,
          codigo: 'viaje_no_programado' as const,
          motivo: `Este viaje ya está "${actual.estado}": solo se puede modificar uno programado.`,
        };
      }
      const cambiaEstructura =
        actual.ruta_id !== datos.rutaId ||
        actual.unidad_id !== datos.unidadId ||
        new Date(actual.hora_salida_programada).getTime() !== new Date(datos.horaSalidaProgramada).getTime();
      if (cambiaEstructura) {
        const tomados = await tx.execute(sql`
          SELECT 1 FROM viaje_asientos
          WHERE viaje_id = ${actual.id} AND estado <> 'disponible'
            AND (estado <> 'bloqueado_temporal' OR hold_expira_en > now())
          LIMIT 1
        `);
        if (tomados.rows.length > 0) {
          return {
            ok: false as const,
            codigo: 'viaje_con_ventas' as const,
            motivo: 'Este viaje ya tiene asientos tomados: no se puede cambiar la ruta, la unidad ni la hora. El precio sí.',
          };
        }
      }
      await tx.execute(sql`
        UPDATE viajes
        SET ruta_id = ${datos.rutaId}, unidad_id = ${datos.unidadId}, fecha_salida = ${datos.fechaSalida},
            hora_salida_programada = ${datos.horaSalidaProgramada}, hora_llegada_estimada = ${datos.horaLlegadaEstimada ?? null},
            precio_base = ${datos.precioBase},
            recargo_vip = COALESCE(${datos.recargoVip ?? null}, recargo_vip),
            actualizado_en = now()
        WHERE id = ${actual.id}
      `);
      return { ok: true as const, id: actual.id, creado: false };
    });
  }

  private async viajeConDistribucion(
    tx: Parameters<Parameters<typeof ejecutarComoCooperativa>[2]>[0],
    cooperativaId: string,
    viajeId: string,
  ) {
    const r = await tx.execute(sql`
      SELECT v.estado, tv.distribucion_asientos, tv.capacidad_total
      FROM viajes v
      JOIN unidades u ON u.id = v.unidad_id
      JOIN tipos_vehiculo tv ON tv.id = u.tipo_vehiculo_id
      WHERE v.id = ${viajeId} AND v.cooperativa_id = ${cooperativaId}
    `);
    return r.rows[0] as { estado: string; distribucion_asientos: unknown; capacidad_total: number } | undefined;
  }

  async asientosDeViaje(cooperativaId: string, viajeId: string): Promise<AsientosDeViajeExterno | null> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const viaje = await this.viajeConDistribucion(tx, cooperativaId, viajeId);
      if (!viaje) return null;
      const filas = await tx.execute(sql`
        SELECT numero_asiento, estado, ocupado_por_cooperativa, referencia_externa, hold_expira_en
        FROM viaje_asientos
        WHERE viaje_id = ${viajeId} AND estado <> 'disponible'
          AND (estado <> 'bloqueado_temporal' OR hold_expira_en > now())
        ORDER BY numero_asiento
      `);
      return {
        viajeId,
        capacidadTotal: Number(viaje.capacidad_total),
        numerosValidos: Array.from(extraerNumerosValidos(viaje.distribucion_asientos, Number(viaje.capacidad_total))),
        noDisponibles: (
          filas.rows as unknown as {
            numero_asiento: string;
            estado: string;
            ocupado_por_cooperativa: boolean;
            referencia_externa: string | null;
            hold_expira_en: Date | string | null;
          }[]
        ).map((f) => ({
          numero: f.numero_asiento,
          estado: (f.estado === 'ocupado'
            ? f.ocupado_por_cooperativa
              ? 'ocupado_cooperativa'
              : 'vendido_klumbus'
            : f.estado === 'pendiente_confirmacion_pago'
              ? 'pago_en_revision'
              : 'en_compra') as EstadoAsientoExterno,
          referencia: f.referencia_externa,
          expiraEn: f.hold_expira_en ? new Date(f.hold_expira_en).toISOString() : null,
        })),
      };
    });
  }

  async ocuparAsientos(
    cooperativaId: string,
    viajeId: string,
    asientos: { numero: string; referencia?: string }[],
  ): Promise<{ ok: true; resultados: ResultadoAsientoExterno[] } | { ok: false; motivo: string } | null> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const viaje = await this.viajeConDistribucion(tx, cooperativaId, viajeId);
      if (!viaje) return null;
      if (viaje.estado !== 'programado') {
        return { ok: false as const, motivo: `Este viaje ya está "${viaje.estado}": no se pueden ocupar asientos.` };
      }
      const validos = extraerNumerosValidos(viaje.distribucion_asientos, Number(viaje.capacidad_total));
      const resultados: ResultadoAsientoExterno[] = [];
      for (const { numero, referencia } of asientos) {
        if (!validos.has(numero)) {
          resultados.push({ numero, resultado: 'inexistente', motivo: 'asiento_inexistente' });
          continue;
        }
        const r = await tx.execute(sql`
          SELECT estado, ocupado_por_cooperativa, hold_expira_en
          FROM viaje_asientos WHERE viaje_id = ${viajeId} AND numero_asiento = ${numero} FOR UPDATE
        `);
        const fila = r.rows[0] as
          | { estado: string; ocupado_por_cooperativa: boolean; hold_expira_en: Date | string | null }
          | undefined;
        if (!fila) {
          const insertado = await tx.execute(sql`
            INSERT INTO viaje_asientos (viaje_id, numero_asiento, estado, ocupado_por_cooperativa, referencia_externa)
            VALUES (${viajeId}, ${numero}, 'ocupado', true, ${referencia ?? null})
            ON CONFLICT (viaje_id, numero_asiento) DO NOTHING
            RETURNING id
          `);
          resultados.push(
            insertado.rows.length > 0
              ? { numero, resultado: 'ocupado' }
              : { numero, resultado: 'conflicto', motivo: 'en_proceso_de_compra' },
          );
          continue;
        }
        if (fila.estado === 'ocupado') {
          if (fila.ocupado_por_cooperativa) {
            await tx.execute(sql`
              UPDATE viaje_asientos SET referencia_externa = COALESCE(${referencia ?? null}, referencia_externa), actualizado_en = now()
              WHERE viaje_id = ${viajeId} AND numero_asiento = ${numero}
            `);
            resultados.push({ numero, resultado: 'ya_ocupado' });
          } else {
            resultados.push({ numero, resultado: 'conflicto', motivo: 'vendido_en_klumbus' });
          }
          continue;
        }
        if (fila.estado === 'pendiente_confirmacion_pago') {
          resultados.push({ numero, resultado: 'conflicto', motivo: 'pago_en_revision' });
          continue;
        }
        const holdVigente =
          fila.estado === 'bloqueado_temporal' && fila.hold_expira_en && new Date(fila.hold_expira_en).getTime() > Date.now();
        if (holdVigente) {
          resultados.push({
            numero,
            resultado: 'conflicto',
            motivo: 'en_proceso_de_compra',
            expiraEn: new Date(fila.hold_expira_en as Date | string).toISOString(),
          });
          continue;
        }
        await tx.execute(sql`
          UPDATE viaje_asientos
          SET estado = 'ocupado', ocupado_por_cooperativa = true, referencia_externa = ${referencia ?? null},
              hold_expira_en = NULL, hold_usuario_id = NULL, hold_sesion_invitado_id = NULL, actualizado_en = now()
          WHERE viaje_id = ${viajeId} AND numero_asiento = ${numero}
        `);
        resultados.push({ numero, resultado: 'ocupado' });
      }
      return { ok: true as const, resultados };
    });
  }

  async liberarAsientos(
    cooperativaId: string,
    viajeId: string,
    numeros: string[],
  ): Promise<{ ok: true; resultados: ResultadoAsientoExterno[] } | null> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const viaje = await this.viajeConDistribucion(tx, cooperativaId, viajeId);
      if (!viaje) return null;
      const resultados: ResultadoAsientoExterno[] = [];
      for (const numero of numeros) {
        const r = await tx.execute(sql`
          SELECT estado, ocupado_por_cooperativa FROM viaje_asientos
          WHERE viaje_id = ${viajeId} AND numero_asiento = ${numero} FOR UPDATE
        `);
        const fila = r.rows[0] as { estado: string; ocupado_por_cooperativa: boolean } | undefined;
        if (!fila || fila.estado === 'disponible') {
          resultados.push({ numero, resultado: 'sin_cambios' });
        } else if (fila.estado === 'ocupado' && fila.ocupado_por_cooperativa) {
          await tx.execute(sql`DELETE FROM viaje_asientos WHERE viaje_id = ${viajeId} AND numero_asiento = ${numero}`);
          resultados.push({ numero, resultado: 'liberado' });
        } else {
          resultados.push({ numero, resultado: 'conflicto', motivo: 'no_es_de_la_cooperativa' });
        }
      }
      return { ok: true as const, resultados };
    });
  }
}
