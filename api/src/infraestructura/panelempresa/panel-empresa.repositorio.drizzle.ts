import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { sql, eq } from 'drizzle-orm';
import { cooperativas } from '@columbus/db';
import { DRIZZLE_DB } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import { ejecutarComoCooperativa } from '../database/tenant-transaction';
import { BcryptHasher } from '../auth/bcrypt.hasher';
import type {
  PanelEmpresaRepositorio,
  DatosNuevoTipoVehiculo,
  DatosLegalesCooperativa,
  Amenidad,
  DatosNuevaUnidad,
  DatosEditarTipoVehiculo,
  DatosEditarRuta,
  DatosNuevaRuta,
  DatosNuevaParada,
  DatosEditarParada,
  ParadaResumen,
  DatosNuevoViaje,
  DatosNuevoUsuarioStaff,
  DatosNuevoConductor,
  DatosImportacion,
  ResultadoImportacionRepo,
  FilaVentaDelDia,
  ResultadoValidacionQr,
  RutaResumen,
  TipoVehiculoResumen,
  UnidadResumen,
  ViajeResumen,
  MetodoPagoCooperativa,
  CredencialApiCooperativa,
  CredencialApiRecienCreada,
  HorarioRutaResumen,
  DatosNuevoHorarioRuta,
} from '../../dominio/panelempresa/panel-empresa.ports';

/**
 * Todas las escrituras de este repositorio pasan por
 * `ejecutarComoCooperativa` — nunca se escribe "pelado" contra
 * DRIZZLE_DB. Esto es lo que hace que RLS proteja de verdad estas
 * operaciones (Arquitectura Técnica 4.3), no solo la búsqueda pública.
 */

/**
 * Ítem 11 (04-ago-2026) -- construye un literal ARRAY[...]::amenidad[]
 * con cada valor como su propio parámetro ligado, NUNCA interpolando el
 * array de JS directo en el template sql`` -- mismo bug real que ya
 * encontramos con ANY() vs IN() en el ítem 7: Drizzle expande un array
 * de JS como lista de parámetros separados, no como un literal de
 * array nativo de Postgres.
 */
function amenidadesArraySql(amenidades: Amenidad[] | undefined) {
  if (!amenidades || amenidades.length === 0) return sql`ARRAY[]::amenidad[]`;
  return sql`ARRAY[${sql.join(
    amenidades.map((a) => sql`${a}::amenidad`),
    sql`, `,
  )}]`;
}

/**
 * Bug real encontrado por el director (18-ago-2026): las columnas de
 * arreglo de un tipo personalizado de Postgres (enum[], como
 * amenidades) leidas por SQL crudo (tx.execute(sql`...`)) no siempre
 * llegan como un arreglo real de JavaScript -- el driver de Postgres
 * puede devolver el texto plano ("{}", "{wifi,ac}") cuando no hay un
 * parser de tipo registrado para ese OID especifico. Esto rompio la
 * pantalla de Unidades en produccion con un .map() sobre una cadena.
 * Esta funcion normaliza cualquiera de las 2 formas a un arreglo real.
 */
function parsearArregloPostgres<T extends string>(valor: T[] | string | null | undefined): T[] {
  if (Array.isArray(valor)) return valor;
  if (!valor) return [];
  const sinLlaves = valor.replace(/^\{|\}$/g, '');
  if (sinLlaves === '') return [];
  return sinLlaves.split(',').map((v) => v.trim() as T);
}

@Injectable()
export class PanelEmpresaRepositorioDrizzle implements PanelEmpresaRepositorio {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly hasher: BcryptHasher,
  ) {}

  async crearTipoVehiculo(
    cooperativaId: string,
    datos: DatosNuevoTipoVehiculo,
  ): Promise<{ id: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        INSERT INTO tipos_vehiculo (cooperativa_id, nombre, categoria, capacidad_total, distribucion_asientos, amenidades)
        VALUES (${cooperativaId}, ${datos.nombre}, ${datos.categoria ?? null}, ${datos.capacidadTotal}, ${JSON.stringify(datos.distribucionAsientos)}, ${amenidadesArraySql(datos.amenidades)})
        RETURNING id
      `);
      return { id: (filas.rows[0] as { id: string }).id };
    });
  }

  /**
   * Cooperativas proponen sus propios puntos de operación (13-ago-2026).
   * `puntos_operacion` NO tiene política RLS (a diferencia de
   * tipos_vehiculo arriba) -- es un recurso compartido, así que no hace
   * falta ejecutarComoCooperativa, un INSERT directo basta. Siempre
   * 'pendiente_revision' -- este método nunca crea algo ya aprobado.
   */
  async proponerPuntoOperacion(
    cooperativaId: string,
    datos: {
      tipo: 'oficina_agencia' | 'parada_intermedia';
      nombre: string;
      ciudad: string;
      provincia: string;
    },
  ): Promise<{ id: string }> {
    const filas = await this.db.execute(sql`
      INSERT INTO puntos_operacion (tipo, nombre, ciudad, provincia, cooperativa_propietaria_id, estado)
      VALUES (${datos.tipo}, ${datos.nombre}, ${datos.ciudad}, ${datos.provincia}, ${cooperativaId}, 'pendiente_revision')
      RETURNING id
    `);
    return { id: (filas.rows[0] as { id: string }).id };
  }

  async listarTiposVehiculo(
    cooperativaId: string,
  ): Promise<TipoVehiculoResumen[]> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT id, nombre, categoria, capacidad_total, amenidades
        FROM tipos_vehiculo
        WHERE cooperativa_id = ${cooperativaId}
        ORDER BY creado_en DESC
      `);
      return resultado.rows.map((fila) => {
        const f = fila as {
          id: string;
          nombre: string;
          categoria: string | null;
          capacidad_total: number;
          amenidades: Amenidad[] | string | null;
        };
        return {
          id: f.id,
          nombre: f.nombre,
          categoria: f.categoria,
          capacidadTotal: f.capacidad_total,
          amenidades: parsearArregloPostgres(f.amenidades),
        };
      });
    });
  }

  async editarTipoVehiculo(
    cooperativaId: string,
    tipoVehiculoId: string,
    datos: DatosEditarTipoVehiculo,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        SELECT id FROM tipos_vehiculo
        WHERE id = ${tipoVehiculoId} AND cooperativa_id = ${cooperativaId}
      `);
      if (filas.rows.length === 0) {
        return { ok: false as const, motivo: 'Este tipo de vehiculo no existe.' };
      }

      // 27-jul-2026 -- aumentar capacidad siempre es seguro; solo reducirla
      // o cambiar el mapa de asientos arriesga invalidar boletos ya
      // vendidos, asi que eso es lo unico que se sigue bloqueando.
      let debeBloquearPorBoletos = datos.distribucionAsientos !== undefined;
      if (datos.capacidadTotal !== undefined) {
        const filaActual = await tx.execute(sql`
          SELECT capacidad_total FROM tipos_vehiculo WHERE id = ${tipoVehiculoId}
        `);
        const capacidadActual = (filaActual.rows[0] as { capacidad_total: number })
          .capacidad_total;
        if (datos.capacidadTotal < capacidadActual) {
          debeBloquearPorBoletos = true;
        }
      }
      if (debeBloquearPorBoletos) {
        const boletosFilas = await tx.execute(sql`
          SELECT COUNT(*)::int AS total
          FROM boletos b
          JOIN viaje_asientos va ON va.id = b.viaje_asiento_id
          JOIN viajes v ON v.id = va.viaje_id
          JOIN unidades u ON u.id = v.unidad_id
          WHERE u.tipo_vehiculo_id = ${tipoVehiculoId}
            AND b.estado != 'cancelado'
        `);
        const totalBoletos = (boletosFilas.rows[0] as { total: number }).total;
        if (totalBoletos > 0) {
          return {
            ok: false as const,
            motivo:
              'Ya hay boletos vigentes vendidos en viajes con unidades de este tipo -- solo se pueden cambiar el nombre o el estado activo.',
          };
        }
      }

      if (datos.nombre !== undefined) {
        await tx.execute(sql`UPDATE tipos_vehiculo SET nombre = ${datos.nombre} WHERE id = ${tipoVehiculoId}`);
      }
      if (datos.categoria !== undefined) {
        await tx.execute(sql`UPDATE tipos_vehiculo SET categoria = ${datos.categoria} WHERE id = ${tipoVehiculoId}`);
      }
      if (datos.capacidadTotal !== undefined) {
        await tx.execute(sql`UPDATE tipos_vehiculo SET capacidad_total = ${datos.capacidadTotal} WHERE id = ${tipoVehiculoId}`);
      }
      if (datos.distribucionAsientos !== undefined) {
        await tx.execute(sql`UPDATE tipos_vehiculo SET distribucion_asientos = ${JSON.stringify(datos.distribucionAsientos)} WHERE id = ${tipoVehiculoId}`);
      }
      if (datos.activo !== undefined) {
        await tx.execute(sql`UPDATE tipos_vehiculo SET activo = ${datos.activo} WHERE id = ${tipoVehiculoId}`);
      }
      // Ítem 11 (04-ago-2026) -- cambiar amenidades no afecta boletos ya
      // vendidos (no toca capacidad ni distribución de asientos), así
      // que no pasa por el bloqueo de arriba.
      if (datos.amenidades !== undefined) {
        await tx.execute(sql`UPDATE tipos_vehiculo SET amenidades = ${amenidadesArraySql(datos.amenidades)} WHERE id = ${tipoVehiculoId}`);
      }
      return { ok: true as const };
    });
  }

  async crearUnidad(
    cooperativaId: string,
    datos: DatosNuevaUnidad,
  ): Promise<{ id: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        INSERT INTO unidades (cooperativa_id, tipo_vehiculo_id, placa, identificador_operativo)
        VALUES (${cooperativaId}, ${datos.tipoVehiculoId}, ${datos.placa}, ${datos.identificadorOperativo})
        RETURNING id
      `);
      return { id: (filas.rows[0] as { id: string }).id };
    });
  }

  async listarUnidades(cooperativaId: string): Promise<UnidadResumen[]> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT u.id, u.placa, u.identificador_operativo, u.tipo_vehiculo_id, tv.nombre AS tipo_vehiculo_nombre, u.activo
        FROM unidades u
        JOIN tipos_vehiculo tv ON tv.id = u.tipo_vehiculo_id
        WHERE u.cooperativa_id = ${cooperativaId}
        ORDER BY u.creado_en DESC
      `);
      return resultado.rows.map((fila) => {
        const f = fila as {
          id: string;
          placa: string;
          identificador_operativo: string;
          tipo_vehiculo_id: string;
          tipo_vehiculo_nombre: string;
          activo: boolean;
        };
        return {
          id: f.id,
          placa: f.placa,
          identificadorOperativo: f.identificador_operativo,
          tipoVehiculoId: f.tipo_vehiculo_id,
          tipoVehiculoNombre: f.tipo_vehiculo_nombre,
          activo: f.activo,
        };
      });
    });
  }

  async actualizarEstadoUnidad(
    cooperativaId: string,
    unidadId: string,
    activo: boolean,
  ): Promise<void> {
    await ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      await tx.execute(sql`
        UPDATE unidades SET activo = ${activo}
        WHERE id = ${unidadId} AND cooperativa_id = ${cooperativaId}
      `);
    });
  }

  async crearRuta(
    cooperativaId: string,
    datos: DatosNuevaRuta,
  ): Promise<{ id: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        INSERT INTO rutas (cooperativa_id, origen_punto_operacion_id, destino_punto_operacion_id, precio_base_referencia, nombre)
        VALUES (${cooperativaId}, ${datos.origenPuntoOperacionId}, ${datos.destinoPuntoOperacionId}, ${datos.precioBaseReferencia}, ${datos.nombre ?? null})
        RETURNING id
      `);
      return { id: (filas.rows[0] as { id: string }).id };
    });
  }

  async listarRutas(cooperativaId: string): Promise<RutaResumen[]> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT r.id, r.nombre, r.precio_base_referencia,
               ori.ciudad AS origen_ciudad, dest.ciudad AS destino_ciudad
        FROM rutas r
        JOIN puntos_operacion ori ON ori.id = r.origen_punto_operacion_id
        JOIN puntos_operacion dest ON dest.id = r.destino_punto_operacion_id
        WHERE r.cooperativa_id = ${cooperativaId}
        ORDER BY r.creado_en DESC
      `);
      return resultado.rows.map((fila) => {
        const f = fila as {
          id: string;
          nombre: string | null;
          precio_base_referencia: string;
          origen_ciudad: string;
          destino_ciudad: string;
        };
        return {
          id: f.id,
          nombre: f.nombre,
          origenCiudad: f.origen_ciudad,
          destinoCiudad: f.destino_ciudad,
          precioBaseReferencia: Number(f.precio_base_referencia),
        };
      });
    });
  }

  async agregarParada(cooperativaId: string, datos: DatosNuevaParada): Promise<{ id: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        INSERT INTO ruta_paradas (ruta_id, punto_operacion_id, orden, tarifa_desde_origen, tiempo_estimado_desde_origen_minutos)
        VALUES (${datos.rutaId}, ${datos.puntoOperacionId}, ${datos.orden}, ${datos.tarifaDesdeOrigen}, ${datos.tiempoEstimadoDesdeOrigenMinutos ?? null})
        RETURNING id
      `);
      return { id: (filas.rows[0] as { id: string }).id };
    });
  }

  async listarParadas(cooperativaId: string, rutaId: string): Promise<ParadaResumen[]> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT rp.id, rp.orden, rp.tarifa_desde_origen, rp.tiempo_estimado_desde_origen_minutos,
               po.id AS punto_operacion_id, po.nombre AS punto_operacion_nombre, po.ciudad AS punto_operacion_ciudad
        FROM ruta_paradas rp
        JOIN puntos_operacion po ON po.id = rp.punto_operacion_id
        WHERE rp.ruta_id = ${rutaId}
        ORDER BY rp.orden ASC
      `);
      return resultado.rows.map((fila) => {
        const f = fila as {
          id: string;
          orden: number;
          tarifa_desde_origen: string;
          tiempo_estimado_desde_origen_minutos: number | null;
          punto_operacion_id: string;
          punto_operacion_nombre: string;
          punto_operacion_ciudad: string;
        };
        return {
          id: f.id,
          orden: f.orden,
          tarifaDesdeOrigen: Number(f.tarifa_desde_origen),
          tiempoEstimadoDesdeOrigenMinutos: f.tiempo_estimado_desde_origen_minutos,
          puntoOperacionId: f.punto_operacion_id,
          puntoOperacionNombre: f.punto_operacion_nombre,
          puntoOperacionCiudad: f.punto_operacion_ciudad,
        };
      });
    });
  }

  async editarParada(
    cooperativaId: string,
    paradaId: string,
    datos: DatosEditarParada,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`SELECT id FROM ruta_paradas WHERE id = ${paradaId}`);
      if (filas.rows.length === 0) {
        return { ok: false as const, motivo: 'Esta parada no existe.' };
      }
      if (datos.orden !== undefined) {
        await tx.execute(sql`UPDATE ruta_paradas SET orden = ${datos.orden} WHERE id = ${paradaId}`);
      }
      if (datos.tarifaDesdeOrigen !== undefined) {
        await tx.execute(sql`UPDATE ruta_paradas SET tarifa_desde_origen = ${String(datos.tarifaDesdeOrigen)} WHERE id = ${paradaId}`);
      }
      if (datos.tiempoEstimadoDesdeOrigenMinutos !== undefined) {
        await tx.execute(sql`UPDATE ruta_paradas SET tiempo_estimado_desde_origen_minutos = ${datos.tiempoEstimadoDesdeOrigenMinutos} WHERE id = ${paradaId}`);
      }
      return { ok: true as const };
    });
  }

  async eliminarParada(cooperativaId: string, paradaId: string): Promise<{ ok: true } | { ok: false; motivo: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`SELECT id FROM ruta_paradas WHERE id = ${paradaId}`);
      if (filas.rows.length === 0) {
        return { ok: false as const, motivo: 'Esta parada no existe.' };
      }
      await tx.execute(sql`DELETE FROM ruta_paradas WHERE id = ${paradaId}`);
      return { ok: true as const };
    });
  }

  async editarRuta(
    cooperativaId: string,
    rutaId: string,
    datos: DatosEditarRuta,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        SELECT id FROM rutas WHERE id = ${rutaId} AND cooperativa_id = ${cooperativaId}
      `);
      if (filas.rows.length === 0) {
        return { ok: false as const, motivo: 'Esta ruta no existe.' };
      }

      if (datos.nombre !== undefined) {
        await tx.execute(sql`UPDATE rutas SET nombre = ${datos.nombre} WHERE id = ${rutaId}`);
      }
      if (datos.precioBaseReferencia !== undefined) {
        await tx.execute(sql`UPDATE rutas SET precio_base_referencia = ${String(datos.precioBaseReferencia)} WHERE id = ${rutaId}`);
      }
      if (datos.activa !== undefined) {
        await tx.execute(sql`UPDATE rutas SET activa = ${datos.activa} WHERE id = ${rutaId}`);
      }
      return { ok: true as const };
    });
  }

  async crearViaje(
    cooperativaId: string,
    datos: DatosNuevoViaje,
  ): Promise<{ id: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        INSERT INTO viajes (cooperativa_id, ruta_id, unidad_id, fecha_salida, hora_salida_programada, hora_llegada_estimada, recargo_vip, precio_base, estado)
        VALUES (
          ${cooperativaId}, ${datos.rutaId}, ${datos.unidadId}, ${datos.fechaSalida}, ${datos.horaSalidaProgramada}, ${datos.horaLlegadaEstimada ?? null},
          COALESCE(${datos.recargoVip ?? null}, (SELECT recargo_vip_default FROM cooperativas WHERE id = ${cooperativaId}), 0),
          ${datos.precioBase}, 'programado'
        )
        RETURNING id
      `);
      return { id: (filas.rows[0] as { id: string }).id };
    });
  }

  async cancelarViaje(
    cooperativaId: string,
    viajeId: string,
  ): Promise<
    { ok: true; boletosCancelados: number } | { ok: false; motivo: string }
  > {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        SELECT estado FROM viajes WHERE id = ${viajeId} AND cooperativa_id = ${cooperativaId}
      `);
      const fila = filas.rows[0] as { estado: string } | undefined;
      if (!fila) {
        return { ok: false as const, motivo: 'Este viaje no existe.' };
      }
      if (fila.estado !== 'programado') {
        return {
          ok: false as const,
          motivo: `Este viaje ya está "${fila.estado}" — solo se puede cancelar un viaje que todavía está programado.`,
        };
      }

      await tx.execute(sql`
        UPDATE viajes SET estado = 'cancelado' WHERE id = ${viajeId}
      `);

      // Cascada: todo boleto vigente de este viaje se cancela también —
      // un pasajero no debería tener que darse cuenta solo de que su
      // viaje ya no existe.
      const boletosCancelados = await tx.execute(sql`
        UPDATE boletos SET estado = 'cancelado'
        WHERE estado = 'vigente' AND viaje_asiento_id IN (
          SELECT id FROM viaje_asientos WHERE viaje_id = ${viajeId}
        )
        RETURNING id
      `);

      // 03-ago-2026 -- crédito automático por cada boleto cancelado,
      // mismo mecanismo que reprogramación (creditos_pasajero), monto
      // igual al precio pagado. Decisión del director: cancelar por
      // causa operativa debe compensar al pasajero, no dejarlo sin nada.
      const idsBoletos = boletosCancelados.rows.map((r) => (r as { id: string }).id);
      if (idsBoletos.length > 0) {
        await tx.execute(sql`
          INSERT INTO creditos_pasajero (usuario_id, cooperativa_id, monto, boleto_origen_id)
          SELECT c.comprador_usuario_id, ${cooperativaId}, b.precio_pagado, b.id
          FROM boletos b
          JOIN compras c ON c.id = b.compra_id
          WHERE b.id IN (${sql.join(idsBoletos, sql`, `)})
        `);
      }

      return {
        ok: true as const,
        boletosCancelados: boletosCancelados.rows.length,
      };
    });
  }

  /**
   * Horarios recurrentes (plantilla) — ítem 7, RF-COOP-002.
   */
  async crearHorarioRuta(
    cooperativaId: string,
    datos: DatosNuevoHorarioRuta,
  ): Promise<{ id: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        INSERT INTO horarios_ruta (ruta_id, hora_salida, dias_semana, tipo_vehiculo_predeterminado_id, activo)
        VALUES (
          ${datos.rutaId},
          ${datos.horaSalida},
          ${JSON.stringify(datos.diasSemana)}::jsonb,
          ${datos.tipoVehiculoPredeterminadoId},
          true
        )
        RETURNING id
      `);
      return { id: (resultado.rows[0] as { id: string }).id };
    });
  }

  async listarHorariosRuta(
    cooperativaId: string,
    rutaId?: string,
  ): Promise<HorarioRutaResumen[]> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const condicionRuta = rutaId ? sql`AND hr.ruta_id = ${rutaId}` : sql``;
      const resultado = await tx.execute(sql`
        SELECT hr.id, hr.ruta_id, hr.hora_salida, hr.dias_semana,
               hr.tipo_vehiculo_predeterminado_id, tv.nombre AS tipo_vehiculo_nombre,
               hr.activo
        FROM horarios_ruta hr
        JOIN rutas r ON r.id = hr.ruta_id
        LEFT JOIN tipos_vehiculo tv ON tv.id = hr.tipo_vehiculo_predeterminado_id
        WHERE r.cooperativa_id = ${cooperativaId} ${condicionRuta}
        ORDER BY hr.hora_salida
      `);
      return resultado.rows.map((fila) => {
        const f = fila as {
          id: string;
          ruta_id: string;
          hora_salida: string;
          dias_semana: number[];
          tipo_vehiculo_predeterminado_id: string | null;
          tipo_vehiculo_nombre: string | null;
          activo: boolean;
        };
        return {
          id: f.id,
          rutaId: f.ruta_id,
          horaSalida: f.hora_salida,
          diasSemana: f.dias_semana,
          tipoVehiculoPredeterminadoId: f.tipo_vehiculo_predeterminado_id ?? '',
          tipoVehiculoNombre: f.tipo_vehiculo_nombre ?? '',
          activo: f.activo,
        };
      });
    });
  }

  async actualizarEstadoHorarioRuta(
    cooperativaId: string,
    horarioId: string,
    activo: boolean,
  ): Promise<void> {
    await ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      await tx.execute(sql`
        UPDATE horarios_ruta hr SET activo = ${activo}
        FROM rutas r
        WHERE hr.id = ${horarioId} AND hr.ruta_id = r.id AND r.cooperativa_id = ${cooperativaId}
      `);
    });
  }

  /**
   * Cancelación/suspensión masiva — solo devuelve ids en estado
   * 'programado'; el service orquesta llamando a cancelarViaje() por
   * cada uno (reutiliza la misma lógica de crédito + cascada de
   * boletos, sin duplicarla).
   */
  async listarViajesProgramadosEnRango(
    cooperativaId: string,
    rutaId: string,
    fechaInicio: string,
    fechaFin: string,
  ): Promise<string[]> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT id FROM viajes
        WHERE cooperativa_id = ${cooperativaId} AND ruta_id = ${rutaId}
          AND fecha_salida BETWEEN ${fechaInicio} AND ${fechaFin}
          AND estado = 'programado'
      `);
      return resultado.rows.map((f) => (f as { id: string }).id);
    });
  }

  async cambiarUnidadViaje(
    cooperativaId: string,
    viajeId: string,
    nuevaUnidadId: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const viajeFilas = await tx.execute(sql`
        SELECT v.estado, tv.capacidad_total AS capacidad_actual
        FROM viajes v
        JOIN unidades u ON u.id = v.unidad_id
        JOIN tipos_vehiculo tv ON tv.id = u.tipo_vehiculo_id
        WHERE v.id = ${viajeId} AND v.cooperativa_id = ${cooperativaId}
      `);
      const viaje = viajeFilas.rows[0] as
        { estado: string; capacidad_actual: number } | undefined;
      if (!viaje) {
        return { ok: false as const, motivo: 'Este viaje no existe.' };
      }
      if (viaje.estado !== 'programado') {
        return {
          ok: false as const,
          motivo: `Este viaje ya está "${viaje.estado}" — solo se puede cambiar la unidad de un viaje programado.`,
        };
      }

      const unidadFilas = await tx.execute(sql`
        SELECT tv.capacidad_total AS capacidad_nueva, u.activo
        FROM unidades u
        JOIN tipos_vehiculo tv ON tv.id = u.tipo_vehiculo_id
        WHERE u.id = ${nuevaUnidadId} AND u.cooperativa_id = ${cooperativaId}
      `);
      const unidadNueva = unidadFilas.rows[0] as
        { capacidad_nueva: number; activo: boolean } | undefined;
      if (!unidadNueva) {
        return {
          ok: false as const,
          motivo: 'Esa unidad no existe o no pertenece a tu cooperativa.',
        };
      }
      if (!unidadNueva.activo) {
        return {
          ok: false as const,
          motivo:
            'Esa unidad está inactiva — actívala primero en Unidades si quieres asignarla a un viaje.',
        };
      }
      if (unidadNueva.capacidad_nueva < viaje.capacidad_actual) {
        return {
          ok: false as const,
          motivo: `La unidad nueva tiene menos capacidad (${unidadNueva.capacidad_nueva}) que la actual (${viaje.capacidad_actual}) — cambiarla dejaría inválidos asientos ya vendidos.`,
        };
      }

      await tx.execute(sql`
        UPDATE viajes SET unidad_id = ${nuevaUnidadId} WHERE id = ${viajeId}
      `);
      return { ok: true as const };
    });
  }

  async editarViaje(
    cooperativaId: string,
    viajeId: string,
    datos: { horaSalidaProgramada?: string; precioBase?: number },
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        SELECT v.estado,
               (SELECT COUNT(*) FROM boletos b
                JOIN viaje_asientos va ON va.id = b.viaje_asiento_id
                WHERE va.viaje_id = v.id AND b.estado != 'cancelado') AS boletos_vendidos
        FROM viajes v
        WHERE v.id = ${viajeId} AND v.cooperativa_id = ${cooperativaId}
      `);
      const viaje = filas.rows[0] as
        { estado: string; boletos_vendidos: number } | undefined;
      if (!viaje) {
        return { ok: false as const, motivo: 'Este viaje no existe.' };
      }
      if (viaje.estado !== 'programado') {
        return {
          ok: false as const,
          motivo: `Este viaje ya está "${viaje.estado}" — solo se puede editar un viaje programado.`,
        };
      }
      if (Number(viaje.boletos_vendidos) > 0) {
        return {
          ok: false as const,
          motivo:
            'Este viaje ya tiene boletos vendidos — cambiar la hora o el precio dejaría a esos pasajeros sin enterarse. Usa "Cambiar unidad" o "Cancelar viaje" en su lugar.',
        };
      }

      if (datos.horaSalidaProgramada !== undefined) {
        await tx.execute(sql`
          UPDATE viajes SET hora_salida_programada = ${datos.horaSalidaProgramada}
          WHERE id = ${viajeId}
        `);
      }
      if (datos.precioBase !== undefined) {
        await tx.execute(sql`
          UPDATE viajes SET precio_base = ${String(datos.precioBase)}
          WHERE id = ${viajeId}
        `);
      }
      return { ok: true as const };
    });
  }

  async listarViajes(cooperativaId: string): Promise<ViajeResumen[]> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT v.id, v.fecha_salida, v.hora_salida_programada, v.precio_base, v.estado,
               r.nombre AS ruta_nombre_raw, ori.ciudad AS origen_ciudad, dest.ciudad AS destino_ciudad,
               u.placa AS unidad_placa, tv.nombre AS tipo_vehiculo_nombre
        FROM viajes v
        JOIN rutas r ON r.id = v.ruta_id
        JOIN puntos_operacion ori ON ori.id = r.origen_punto_operacion_id
        JOIN puntos_operacion dest ON dest.id = r.destino_punto_operacion_id
        JOIN unidades u ON u.id = v.unidad_id
        JOIN tipos_vehiculo tv ON tv.id = u.tipo_vehiculo_id
        WHERE v.cooperativa_id = ${cooperativaId}
        ORDER BY v.fecha_salida DESC, v.hora_salida_programada DESC
      `);
      return resultado.rows.map((fila) => {
        const f = fila as {
          id: string;
          fecha_salida: string;
          hora_salida_programada: string;
          precio_base: string;
          estado: string;
          ruta_nombre_raw: string | null;
          origen_ciudad: string;
          destino_ciudad: string;
          unidad_placa: string;
          tipo_vehiculo_nombre: string;
        };
        return {
          id: f.id,
          rutaNombre:
            f.ruta_nombre_raw ?? `${f.origen_ciudad} → ${f.destino_ciudad}`,
          origenCiudad: f.origen_ciudad,
          destinoCiudad: f.destino_ciudad,
          fechaSalida: f.fecha_salida,
          horaSalidaProgramada: f.hora_salida_programada,
          precioBase: Number(f.precio_base),
          estado: f.estado,
          unidadPlaca: f.unidad_placa,
          tipoVehiculoNombre: f.tipo_vehiculo_nombre,
        };
      });
    });
  }

  async listarPasajerosDeViaje(cooperativaId: string, viajeId: string) {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT va.numero_asiento, pc.nombres || ' ' || pc.apellidos AS nombre_completo, pc.documento,
               pc.tipo_tarifa, pc.es_menor_edad, b.estado
        FROM viaje_asientos va
        JOIN boletos b ON b.viaje_asiento_id = va.id
        JOIN pasajeros_compra pc ON pc.id = b.pasajero_compra_id
        JOIN viajes v ON v.id = va.viaje_id
        WHERE va.viaje_id = ${viajeId} AND v.cooperativa_id = ${cooperativaId}
        ORDER BY va.numero_asiento
      `);
      return resultado.rows.map((fila) => {
        const f = fila as {
          numero_asiento: string;
          nombre_completo: string;
          documento: string;
          tipo_tarifa: string;
          es_menor_edad: boolean;
          estado: string;
        };
        return {
          numeroAsiento: f.numero_asiento,
          nombreCompleto: f.nombre_completo,
          documento: f.documento,
          tipoTarifa: f.tipo_tarifa,
          esMenorEdad: f.es_menor_edad,
          estadoBoleto: f.estado,
        };
      });
    });
  }

  async crearUsuarioStaff(
    cooperativaId: string,
    datos: DatosNuevoUsuarioStaff,
  ): Promise<{ usuarioId: string }> {
    const passwordHash = await this.hasher.hash(datos.password);
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        INSERT INTO usuarios (rol, cooperativa_id, correo, password_hash, nombre_completo)
        VALUES (${datos.rol}, ${cooperativaId}, ${datos.correo}, ${passwordHash}, ${datos.nombreCompleto})
        RETURNING id
      `);
      return { usuarioId: (filas.rows[0] as { id: string }).id };
    });
  }

  async listarUsuariosStaff(cooperativaId: string) {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        SELECT id, correo, nombre_completo, rol, activo
        FROM usuarios
        WHERE cooperativa_id = ${cooperativaId} AND rol IN ('vendedor', 'admin_cooperativa')
        ORDER BY creado_en DESC
      `);
      return filas.rows.map((f) => {
        const fila = f as {
          id: string;
          correo: string;
          nombre_completo: string;
          rol: 'vendedor' | 'admin_cooperativa';
          activo: boolean;
        };
        return {
          id: fila.id,
          correo: fila.correo,
          nombreCompleto: fila.nombre_completo,
          rol: fila.rol,
          activo: fila.activo,
        };
      });
    });
  }

  async crearConductor(
    cooperativaId: string,
    datos: DatosNuevoConductor,
  ): Promise<{ id: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        INSERT INTO conductores (cooperativa_id, nombre_completo, cedula, licencia_numero, licencia_categoria, telefono)
        VALUES (${cooperativaId}, ${datos.nombreCompleto}, ${datos.cedula}, ${datos.licenciaNumero ?? null}, ${datos.licenciaCategoria ?? null}, ${datos.telefono ?? null})
        RETURNING id
      `);
      return { id: (filas.rows[0] as { id: string }).id };
    });
  }

  async listarConductores(cooperativaId: string) {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        SELECT id, nombre_completo, cedula, licencia_numero, licencia_categoria, telefono
        FROM conductores
        WHERE cooperativa_id = ${cooperativaId}
        ORDER BY creado_en DESC
      `);
      return filas.rows.map((f) => {
        const fila = f as {
          id: string;
          nombre_completo: string;
          cedula: string;
          licencia_numero: string | null;
          licencia_categoria: string | null;
          telefono: string | null;
        };
        return {
          id: fila.id,
          nombreCompleto: fila.nombre_completo,
          cedula: fila.cedula,
          licenciaNumero: fila.licencia_numero,
          licenciaCategoria: fila.licencia_categoria,
          telefono: fila.telefono,
        };
      });
    });
  }

  /**
   * Carga masiva — ver comentario largo de `DatosImportacion` en
   * ventas.ports.ts / panel-empresa.ports.ts. Todo el paquete corre en
   * UNA sola transacción de cooperativa: si algo falla a la mitad (ej.
   * un `ref` mal escrito), no queda nada a medias — se revierte
   * completo, no parcialmente.
   */
  async importarDatos(
    cooperativaId: string,
    datos: DatosImportacion,
  ): Promise<ResultadoImportacionRepo> {
    try {
      return await ejecutarComoCooperativa(
        this.db,
        cooperativaId,
        async (tx) => {
          const refsTipoVehiculo = new Map<string, string>();
          const refsConductor = new Map<string, string>();
          const refsUnidad = new Map<string, string>();
          const refsRuta = new Map<string, string>();

          for (const item of datos.tiposVehiculo ?? []) {
            const filas = await tx.execute(sql`
            INSERT INTO tipos_vehiculo (cooperativa_id, nombre, capacidad_total, distribucion_asientos)
            VALUES (${cooperativaId}, ${item.nombre}, ${item.capacidadTotal}, ${JSON.stringify(item.distribucionAsientos ?? {})})
            RETURNING id
          `);
            if (item.ref) {
              refsTipoVehiculo.set(
                item.ref,
                (filas.rows[0] as { id: string }).id,
              );
            }
          }

          for (const item of datos.conductores ?? []) {
            const filas = await tx.execute(sql`
            INSERT INTO conductores (cooperativa_id, nombre_completo, cedula, licencia_numero, licencia_categoria, telefono)
            VALUES (${cooperativaId}, ${item.nombreCompleto}, ${item.cedula}, ${item.licenciaNumero ?? null}, ${item.licenciaCategoria ?? null}, ${item.telefono ?? null})
            RETURNING id
          `);
            if (item.ref) {
              refsConductor.set(item.ref, (filas.rows[0] as { id: string }).id);
            }
          }

          for (const item of datos.unidades ?? []) {
            // Permite referenciar un tipo_vehiculo creado en ESTE mismo
            // paquete (por su `ref`) o uno ya existente de antes (pasando
            // directamente su id real) — ver comentario de diseño en
            // panel-empresa.ports.ts.
            const tipoVehiculoId =
              refsTipoVehiculo.get(item.tipoVehiculoRef) ??
              item.tipoVehiculoRef;
            const filas = await tx.execute(sql`
            INSERT INTO unidades (cooperativa_id, tipo_vehiculo_id, placa, identificador_operativo)
            VALUES (${cooperativaId}, ${tipoVehiculoId}, ${item.placa}, ${item.identificadorOperativo})
            RETURNING id
          `);
            if (item.ref) {
              refsUnidad.set(item.ref, (filas.rows[0] as { id: string }).id);
            }
          }

          for (const item of datos.rutas ?? []) {
            const filas = await tx.execute(sql`
            INSERT INTO rutas (cooperativa_id, origen_punto_operacion_id, destino_punto_operacion_id, precio_base_referencia, nombre)
            VALUES (${cooperativaId}, ${item.origenPuntoOperacionId}, ${item.destinoPuntoOperacionId}, ${item.precioBaseReferencia}, ${item.nombre ?? null})
            RETURNING id
          `);
            if (item.ref) {
              refsRuta.set(item.ref, (filas.rows[0] as { id: string }).id);
            }
          }

          let horariosCreados = 0;
          const horarioIds: string[] = [];

          for (const item of datos.horarios ?? []) {
            const rutaId = refsRuta.get(item.rutaRef) ?? item.rutaRef;
            // 04-ago-2026 -- mismo patrón de resolución de ref que
            // tipoVehiculoRef ya usa en unidades, arriba.
            const tipoVehiculoId =
              refsTipoVehiculo.get(item.tipoVehiculoRef) ??
              item.tipoVehiculoRef;

            const filas = await tx.execute(sql`
            INSERT INTO horarios_ruta (ruta_id, hora_salida, dias_semana, tipo_vehiculo_predeterminado_id, activo)
            VALUES (${rutaId}, ${item.horaSalida}, ${JSON.stringify(item.diasSemana)}::jsonb, ${tipoVehiculoId}, true)
            RETURNING id
          `);
            horariosCreados++;
            horarioIds.push((filas.rows[0] as { id: string }).id);
          }

          // 04-ago-2026 -- la generación de viajes concretos se movió a
          // GeneradorViajesService (aplicación), mismo mecanismo que el
          // cron del ítem 7 -- ya no hay un camino paralelo más débil
          // aquí (no duplicaba correctamente, no enlazaba
          // horario_ruta_origen_id). El service llama a
          // generarViajesParaHorarios(horarioIds, desde, hasta) después
          // de que esta transacción confirme.

          return {
            tiposVehiculoCreados: datos.tiposVehiculo?.length ?? 0,
            conductoresCreados: datos.conductores?.length ?? 0,
            unidadesCreadas: datos.unidades?.length ?? 0,
            rutasCreadas: datos.rutas?.length ?? 0,
            horariosCreados,
            horarioIds,
          };
        },
      );
    } catch (error) {
      // Envuelve cualquier error de SQL (ej. un `ref` mal escrito que
      // resulta en una FK inexistente) en un mensaje entendible — la
      // transacción ya se revirtió completa en este punto.
      const mensaje =
        error instanceof Error ? error.message : 'Error desconocido';
      throw new BadRequestException(
        `La importación falló y se revirtió por completo (no quedó nada a medias). Verifica que todas las referencias (\`ref\`) estén bien escritas y no se repitan. Detalle técnico: ${mensaje}`,
      );
    }
  }

  async dashboardVentasDelDia(
    cooperativaId: string,
  ): Promise<FilaVentaDelDia[]> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT r.nombre AS ruta_nombre_raw,
               ori.ciudad AS origen_ciudad,
               dest.ciudad AS destino_ciudad,
               u.nombre_completo AS vendedor_nombre,
               COUNT(b.id)::int AS total_boletos,
               COALESCE(SUM(b.precio_pagado), 0)::float AS total_ventas
        FROM boletos b
        JOIN compras co ON co.id = b.compra_id
        JOIN viaje_asientos va ON va.id = b.viaje_asiento_id
        JOIN viajes v ON v.id = va.viaje_id
        JOIN rutas r ON r.id = v.ruta_id
        JOIN puntos_operacion ori ON ori.id = r.origen_punto_operacion_id
        JOIN puntos_operacion dest ON dest.id = r.destino_punto_operacion_id
        LEFT JOIN usuarios u ON u.id = co.vendedor_usuario_id
        WHERE b.cooperativa_id = ${cooperativaId}
          AND b.creado_en >= CURRENT_DATE
        GROUP BY r.id, r.nombre, ori.ciudad, dest.ciudad, u.nombre_completo
      `);
      return resultado.rows.map((fila) => {
        const f = fila as {
          ruta_nombre_raw: string | null;
          origen_ciudad: string;
          destino_ciudad: string;
          vendedor_nombre: string | null;
          total_boletos: number;
          total_ventas: number;
        };
        return {
          rutaNombre:
            f.ruta_nombre_raw ?? `${f.origen_ciudad} → ${f.destino_ciudad}`,
          vendedorNombre: f.vendedor_nombre,
          totalBoletos: f.total_boletos,
          totalVentas: f.total_ventas,
        };
      });
    });
  }

  async obtenerPerfil(
    cooperativaId: string,
  ): Promise<{ logoUrl: string | null }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT logo_url FROM cooperativas WHERE id = ${cooperativaId}
      `);
      const f = resultado.rows[0] as { logo_url: string | null } | undefined;
      return { logoUrl: f?.logo_url ?? null };
    });
  }

  async actualizarPerfil(
    cooperativaId: string,
    datos: { logoUrl: string | null },
  ): Promise<void> {
    await ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      await tx.execute(sql`
        UPDATE cooperativas SET logo_url = ${datos.logoUrl} WHERE id = ${cooperativaId}
      `);
    });
  }

  async obtenerConfiguracionFiscal(cooperativaId: string): Promise<{
    ivaPorcentaje: number;
    ivaVisibleEnBoleto: boolean;
    ivaSigueTasaNacional: boolean;
  }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT iva_porcentaje, iva_visible_en_boleto, iva_sigue_tasa_nacional
        FROM cooperativas
        WHERE id = ${cooperativaId}
      `);
      const f = resultado.rows[0] as {
        iva_porcentaje: string;
        iva_visible_en_boleto: boolean;
        iva_sigue_tasa_nacional: boolean;
      };
      return {
        ivaPorcentaje: Number(f.iva_porcentaje),
        ivaVisibleEnBoleto: f.iva_visible_en_boleto,
        ivaSigueTasaNacional: f.iva_sigue_tasa_nacional,
      };
    });
  }

  async actualizarConfiguracionFiscal(
    cooperativaId: string,
    datos: {
      ivaPorcentaje: number;
      ivaVisibleEnBoleto: boolean;
      ivaSigueTasaNacional: boolean;
    },
  ): Promise<void> {
    await ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      await tx.execute(sql`
        UPDATE cooperativas
        SET iva_porcentaje = ${datos.ivaPorcentaje},
            iva_visible_en_boleto = ${datos.ivaVisibleEnBoleto},
            iva_sigue_tasa_nacional = ${datos.ivaSigueTasaNacional}
        WHERE id = ${cooperativaId}
      `);
    });
  }

  async obtenerConfiguracionVip(cooperativaId: string): Promise<{ recargoVipDefault: number }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT recargo_vip_default FROM cooperativas WHERE id = ${cooperativaId}
      `);
      const f = resultado.rows[0] as { recargo_vip_default: string };
      return { recargoVipDefault: Number(f.recargo_vip_default) };
    });
  }

  async actualizarConfiguracionVip(cooperativaId: string, recargoVipDefault: number): Promise<void> {
    await ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      await tx.execute(sql`
        UPDATE cooperativas SET recargo_vip_default = ${recargoVipDefault} WHERE id = ${cooperativaId}
      `);
    });
  }

  async obtenerHorasLimiteReprogramacion(cooperativaId: string): Promise<number | null> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT horas_limite_reprogramacion FROM cooperativas WHERE id = ${cooperativaId}
      `);
      const f = resultado.rows[0] as { horas_limite_reprogramacion: number | null };
      return f.horas_limite_reprogramacion;
    });
  }

  async actualizarHorasLimiteReprogramacion(
    cooperativaId: string,
    horas: number,
  ): Promise<void> {
    await ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      await tx.execute(sql`
        UPDATE cooperativas SET horas_limite_reprogramacion = ${horas} WHERE id = ${cooperativaId}
      `);
    });
  }

  async obtenerPoliticaCancelacionReprogramacion(cooperativaId: string) {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT permite_cancelacion, horas_limite_cancelacion,
               permite_reprogramacion, horas_limite_reprogramacion
        FROM cooperativas WHERE id = ${cooperativaId}
      `);
      const f = resultado.rows[0] as {
        permite_cancelacion: boolean;
        horas_limite_cancelacion: number | null;
        permite_reprogramacion: boolean;
        horas_limite_reprogramacion: number | null;
      };
      return {
        permiteCancelacion: f.permite_cancelacion,
        horasLimiteCancelacion: f.horas_limite_cancelacion,
        permiteReprogramacion: f.permite_reprogramacion,
        horasLimiteReprogramacion: f.horas_limite_reprogramacion,
      };
    });
  }

  async actualizarPoliticaCancelacionReprogramacion(
    cooperativaId: string,
    datos: {
      permiteCancelacion?: boolean;
      horasLimiteCancelacion?: number;
      permiteReprogramacion?: boolean;
      horasLimiteReprogramacion?: number;
    },
  ): Promise<void> {
    await ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      if (datos.permiteCancelacion !== undefined) {
        await tx.execute(sql`UPDATE cooperativas SET permite_cancelacion = ${datos.permiteCancelacion} WHERE id = ${cooperativaId}`);
      }
      if (datos.horasLimiteCancelacion !== undefined) {
        await tx.execute(sql`UPDATE cooperativas SET horas_limite_cancelacion = ${datos.horasLimiteCancelacion} WHERE id = ${cooperativaId}`);
      }
      if (datos.permiteReprogramacion !== undefined) {
        await tx.execute(sql`UPDATE cooperativas SET permite_reprogramacion = ${datos.permiteReprogramacion} WHERE id = ${cooperativaId}`);
      }
      if (datos.horasLimiteReprogramacion !== undefined) {
        await tx.execute(sql`UPDATE cooperativas SET horas_limite_reprogramacion = ${datos.horasLimiteReprogramacion} WHERE id = ${cooperativaId}`);
      }
    });
  }

  async listarMetodosPago(cooperativaId: string): Promise<MetodoPagoCooperativa[]> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT id, tipo, activo, datos_cuenta, entidad_financiera
        FROM metodos_pago_cooperativa
        WHERE cooperativa_id = ${cooperativaId}
        ORDER BY creado_en ASC
      `);
      return resultado.rows.map((fila) => {
        const f = fila as {
          id: string;
          tipo: string;
          activo: boolean;
          datos_cuenta: Record<string, string>;
          entidad_financiera: string | null;
        };
        return {
          id: f.id,
          tipo: f.tipo as MetodoPagoCooperativa['tipo'],
          activo: f.activo,
          datosCuenta: f.datos_cuenta,
          entidadFinanciera: f.entidad_financiera as MetodoPagoCooperativa['entidadFinanciera'],
        };
      });
    });
  }

  /**
   * Ítem 21/22 (06-ago-2026) -- entidadFinanciera solo aplica a
   * transferencia_bancaria, null en el resto -- catálogo cerrado,
   * reemplaza el texto libre sin estructura que vivía dentro de
   * datosCuenta.
   */
  async guardarMetodoPago(
    cooperativaId: string,
    tipo: string,
    datosCuenta: Record<string, string>,
    activo: boolean,
    entidadFinanciera: string | null,
  ): Promise<{ id: string }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      // "Upsert" manual sobre la restricción única (cooperativa_id, tipo)
      // -- si ya existe ese tipo configurado, se actualiza en vez de
      // duplicar (evita el error de la restricción única y confusión de
      // "¿cuál cuenta uso?").
      const resultado = await tx.execute(sql`
        INSERT INTO metodos_pago_cooperativa (cooperativa_id, tipo, datos_cuenta, activo, entidad_financiera)
        VALUES (${cooperativaId}, ${tipo}, ${JSON.stringify(datosCuenta)}, ${activo}, ${entidadFinanciera})
        ON CONFLICT (cooperativa_id, tipo)
        DO UPDATE SET datos_cuenta = ${JSON.stringify(datosCuenta)}, activo = ${activo}, entidad_financiera = ${entidadFinanciera}, actualizado_en = now()
        RETURNING id
      `);
      return { id: (resultado.rows[0] as { id: string }).id };
    });
  }

  async eliminarMetodoPago(cooperativaId: string, metodoPagoId: string): Promise<void> {
    await ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      await tx.execute(sql`
        DELETE FROM metodos_pago_cooperativa
        WHERE id = ${metodoPagoId} AND cooperativa_id = ${cooperativaId}
      `);
    });
  }

  /**
   * Credenciales API -- Modelo B (02-ago-2026). Genera un identificador
   * público (idPublico) y un secreto -- el prefijo (tkya_live_<idPublico>)
   * se guarda en texto plano para poder BUSCAR la credencial rápido;
   * el secreto nunca se guarda en texto plano, solo su hash (mismo
   * principio que contraseñas de usuario). La llave completa que se le
   * entrega al cliente es "prefijo.secreto" -- se arma aquí y se
   * devuelve UNA sola vez; después de esto, ni el backend puede volver
   * a reconstruirla (el hash no es reversible).
   */
  private async generarCredencialApi(): Promise<{
    apiKeyPrefix: string;
    apiKeyHash: string;
    apiKeyCompleta: string;
  }> {
    const idPublico = randomBytes(6).toString('hex'); // 12 caracteres
    const secreto = randomBytes(24).toString('hex'); // 48 caracteres
    const apiKeyPrefix = `tkya_live_${idPublico}`;
    const apiKeyCompleta = `${apiKeyPrefix}.${secreto}`;
    const apiKeyHash = await this.hasher.hash(secreto);
    return { apiKeyPrefix, apiKeyHash, apiKeyCompleta };
  }

  async listarCredencialesApi(cooperativaId: string): Promise<CredencialApiCooperativa[]> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT id, tipo, api_key_prefix, webhook_url, activo, creado_en, revocado_en
        FROM credenciales_api
        WHERE cooperativa_id = ${cooperativaId}
        ORDER BY creado_en DESC
      `);
      return resultado.rows.map((fila) => {
        const f = fila as {
          id: string;
          tipo: string;
          api_key_prefix: string | null;
          webhook_url: string | null;
          activo: boolean;
          creado_en: string;
          revocado_en: string | null;
        };
        return {
          id: f.id,
          tipo: f.tipo as 'api_key',
          apiKeyPrefix: f.api_key_prefix ?? '',
          webhookUrl: f.webhook_url,
          activo: f.activo,
          creadoEn: f.creado_en,
          revocadoEn: f.revocado_en,
        };
      });
    });
  }

  async crearCredencialApi(
    cooperativaId: string,
    webhookUrl: string | null,
  ): Promise<CredencialApiRecienCreada> {
    const { apiKeyPrefix, apiKeyHash, apiKeyCompleta } = await this.generarCredencialApi();
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        INSERT INTO credenciales_api (cooperativa_id, tipo, api_key_prefix, api_key_hash, webhook_url, activo)
        VALUES (${cooperativaId}, 'api_key', ${apiKeyPrefix}, ${apiKeyHash}, ${webhookUrl}, true)
        RETURNING id
      `);
      return {
        id: (resultado.rows[0] as { id: string }).id,
        apiKeyPrefix,
        apiKeyCompleta,
      };
    });
  }

  async rotarCredencialApi(
    cooperativaId: string,
    credencialId: string,
  ): Promise<CredencialApiRecienCreada> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const existente = await tx.execute(sql`
        SELECT webhook_url FROM credenciales_api
        WHERE id = ${credencialId} AND cooperativa_id = ${cooperativaId} AND activo = true
      `);
      if (existente.rows.length === 0) {
        throw new BadRequestException(
          'No existe una credencial activa con ese id para rotar.',
        );
      }
      const webhookUrl = (existente.rows[0] as { webhook_url: string | null }).webhook_url;

      // Se revoca ANTES de crear la nueva a propósito -- no debe existir
      // ninguna ventana de tiempo donde la llave vieja y la nueva sirvan
      // las dos a la vez.
      await tx.execute(sql`
        UPDATE credenciales_api SET activo = false, revocado_en = now()
        WHERE id = ${credencialId} AND cooperativa_id = ${cooperativaId}
      `);

      const { apiKeyPrefix, apiKeyHash, apiKeyCompleta } = await this.generarCredencialApi();
      const nueva = await tx.execute(sql`
        INSERT INTO credenciales_api (cooperativa_id, tipo, api_key_prefix, api_key_hash, webhook_url, activo)
        VALUES (${cooperativaId}, 'api_key', ${apiKeyPrefix}, ${apiKeyHash}, ${webhookUrl}, true)
        RETURNING id
      `);
      return {
        id: (nueva.rows[0] as { id: string }).id,
        apiKeyPrefix,
        apiKeyCompleta,
      };
    });
  }

  async revocarCredencialApi(cooperativaId: string, credencialId: string): Promise<void> {
    await ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      await tx.execute(sql`
        UPDATE credenciales_api SET activo = false, revocado_en = now()
        WHERE id = ${credencialId} AND cooperativa_id = ${cooperativaId}
      `);
    });
  }

  async actualizarWebhookCredencialApi(
    cooperativaId: string,
    credencialId: string,
    webhookUrl: string | null,
  ): Promise<void> {
    await ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      await tx.execute(sql`
        UPDATE credenciales_api SET webhook_url = ${webhookUrl}
        WHERE id = ${credencialId} AND cooperativa_id = ${cooperativaId}
      `);
    });
  }

  async validarBoletoPorQr(
    cooperativaId: string,
    codigoQr: string,
    validadoPorUsuarioId: string,
  ): Promise<ResultadoValidacionQr> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const filas = await tx.execute(sql`
        SELECT b.id, b.estado, b.compra_id, b.precio_pagado, c.comprador_usuario_id,
               pc.id AS pasajero_compra_id, pc.nombres || ' ' || pc.apellidos AS nombre_completo, pc.es_menor_edad,
               pc.tipo_tarifa, pc.numero_documento_discapacidad
        FROM boletos b
        JOIN pasajeros_compra pc ON pc.id = b.pasajero_compra_id
        JOIN compras c ON c.id = b.compra_id
        WHERE b.codigo_qr = ${codigoQr}
      `);

      // RLS ya garantiza que, si el boleto existe pero es de otra
      // cooperativa, esta consulta simplemente no lo ve — por eso el
      // mensaje de "no encontrado" cubre ambos casos sin distinguirlos,
      // que es lo correcto de cara al usuario (no hay que revelar si el
      // QR pertenece a otra cooperativa).
      if (filas.rows.length === 0) {
        return { valido: false, mensaje: 'Boleto no encontrado.' };
      }

      const fila = filas.rows[0] as {
        id: string;
        estado: string;
        compra_id: string;
        precio_pagado: string;
        comprador_usuario_id: string | null;
        pasajero_compra_id: string;
        nombre_completo: string;
        es_menor_edad: boolean;
        tipo_tarifa: string;
        numero_documento_discapacidad: string | null;
      };

      if (fila.estado === 'usado') {
        return {
          valido: false,
          mensaje: 'Este boleto ya fue utilizado anteriormente.',
        };
      }
      if (fila.estado === 'cancelado') {
        return { valido: false, mensaje: 'Este boleto fue cancelado.' };
      }

      // Solo puede pasar de 'vigente' a 'usado' — el WHERE estado='vigente'
      // hace que, bajo concurrencia (dos escaneos casi simultáneos), solo
      // el primero realmente actualice la fila.
      const actualizado = await tx.execute(sql`
        UPDATE boletos SET estado = 'usado', validado_en = now(), validado_por_usuario_id = ${validadoPorUsuarioId}
        WHERE id = ${fila.id} AND estado = 'vigente'
        RETURNING id
      `);

      if (actualizado.rows.length === 0) {
        return {
          valido: false,
          mensaje: 'Este boleto ya fue validado por otra persona justo ahora.',
        };
      }

      let menor: ResultadoValidacionQr['menor'];
      if (fila.es_menor_edad) {
        const autRows = await tx.execute(sql`
          SELECT am.tipo_acompanamiento, am.adulto_responsable_nombre,
                 am.adulto_responsable_documento, am.adulto_responsable_telefono,
                 am.documento_autorizacion_url, acompanante.nombres || ' ' || acompanante.apellidos AS adulto_acompanante_nombre,
                 vm.id AS verificacion_id
          FROM autorizaciones_menor am
          LEFT JOIN pasajeros_compra acompanante ON acompanante.id = am.adulto_acompanante_en_compra_id
          LEFT JOIN verificaciones_menor vm ON vm.boleto_id = ${fila.id}
          WHERE am.pasajero_compra_id = ${fila.pasajero_compra_id}
        `);
        if (autRows.rows.length > 0) {
          const a = autRows.rows[0] as {
            tipo_acompanamiento: 'con_padre_madre_tutor' | 'con_autorizacion';
            adulto_responsable_nombre: string | null;
            adulto_responsable_documento: string | null;
            adulto_responsable_telefono: string | null;
            documento_autorizacion_url: string | null;
            adulto_acompanante_nombre: string | null;
            verificacion_id: string | null;
          };
          menor = {
            boletoId: fila.id,
            tipoAcompanamiento: a.tipo_acompanamiento,
            adultoAcompananteNombre: a.adulto_acompanante_nombre,
            adultoResponsableNombre: a.adulto_responsable_nombre,
            adultoResponsableDocumento: a.adulto_responsable_documento,
            adultoResponsableTelefono: a.adulto_responsable_telefono,
            documentoAutorizacionUrl: a.documento_autorizacion_url,
            yaVerificado: a.verificacion_id !== null,
          };
        }
      }

      return {
        valido: true,
        mensaje: 'Boleto válido. Abordaje confirmado.',
        pasajeroNombre: fila.nombre_completo,
        menor,
        // Discapacidad, captura real (13-ago-2026) -- el personal en
        // el andén ve el número declarado para poder pedir el
        // carné/cédula físico y compararlo con sus propios ojos.
        // Nunca se verifica automáticamente contra ningún sistema.
        documentoDiscapacidad:
          fila.tipo_tarifa === 'discapacidad'
            ? { numeroDeclarado: fila.numero_documento_discapacidad }
            : undefined,
        // Wallet/cashback Fase 1 (13-ago-2026) -- datos que
        // PanelEmpresaService necesita para acreditar cashback justo
        // después de esta validación, sin tener que volver a consultar.
        compraId: fila.compra_id,
        precioPagado: Number(fila.precio_pagado),
        compradorUsuarioId: fila.comprador_usuario_id,
        // Programa de referidos (13-ago-2026) -- el id real del boleto,
        // necesario para marcar la relación de referido como disparada.
        boletoId: fila.id,
      };
    });
  }

  async verificarMenor(
    cooperativaId: string,
    boletoId: string,
    verificadoPorUsuarioId: string,
    documentoIdentidadVerificado: boolean,
    documentoAutorizacionVerificado: boolean,
  ): Promise<void> {
    await ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO verificaciones_menor (boleto_id, verificado_por_usuario_id, documento_identidad_verificado, documento_autorizacion_verificado)
        VALUES (${boletoId}, ${verificadoPorUsuarioId}, ${documentoIdentidadVerificado}, ${documentoAutorizacionVerificado})
      `);
    });
  }

  /**
   * Ítem 10, Fase 2 (04-ago-2026) -- actualización periódica
   * obligatoria de datos de cooperativa.
   */
  async obtenerEstadoActualizacionDatos(cooperativaId: string): Promise<{
    ultimaConfirmacion: Date | null;
    fechaAfiliacion: Date | null;
    datosActuales: DatosLegalesCooperativa;
  }> {
    return ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const resultado = await tx.execute(sql`
        SELECT razon_social, ruc, direccion_legal, contacto_nombre, contacto_correo,
               contacto_telefono, fecha_afiliacion, datos_actualizados_en
        FROM cooperativas
        WHERE id = ${cooperativaId}
      `);
      const f = resultado.rows[0] as {
        razon_social: string;
        ruc: string;
        direccion_legal: string | null;
        contacto_nombre: string | null;
        contacto_correo: string | null;
        contacto_telefono: string | null;
        fecha_afiliacion: Date | null;
        datos_actualizados_en: Date | null;
      };
      return {
        // Conversión explícita a Date real -- bug real encontrado por
        // las propias pruebas: sql`` crudo devuelve las columnas
        // timestamp como texto, no como Date, aunque el tipo de
        // TypeScript diga Date | null. calcularEstadoActualizacionDatos
        // llama .getTime() y fallaba en tiempo de ejecución.
        ultimaConfirmacion: f.datos_actualizados_en ? new Date(f.datos_actualizados_en) : null,
        fechaAfiliacion: f.fecha_afiliacion ? new Date(f.fecha_afiliacion) : null,
        datosActuales: {
          razonSocial: f.razon_social,
          ruc: f.ruc,
          direccionLegal: f.direccion_legal,
          contactoNombre: f.contacto_nombre,
          contactoCorreo: f.contacto_correo,
          contactoTelefono: f.contacto_telefono,
        },
      };
    });
  }

  async confirmarDatosCooperativa(
    cooperativaId: string,
    datos: Partial<DatosLegalesCooperativa>,
  ): Promise<void> {
    await ejecutarComoCooperativa(this.db, cooperativaId, async (tx) => {
      const valores: Record<string, unknown> = { datosActualizadosEn: sql`now()` };
      if (datos.razonSocial !== undefined) valores.razonSocial = datos.razonSocial;
      if (datos.ruc !== undefined) valores.ruc = datos.ruc;
      if (datos.direccionLegal !== undefined) valores.direccionLegal = datos.direccionLegal;
      if (datos.contactoNombre !== undefined) valores.contactoNombre = datos.contactoNombre;
      if (datos.contactoCorreo !== undefined) valores.contactoCorreo = datos.contactoCorreo;
      if (datos.contactoTelefono !== undefined) valores.contactoTelefono = datos.contactoTelefono;

      await tx
        .update(cooperativas)
        .set(valores)
        .where(eq(cooperativas.id, cooperativaId));
    });
  }
}
