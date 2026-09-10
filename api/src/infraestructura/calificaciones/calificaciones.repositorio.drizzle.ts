import { Inject, Injectable } from '@nestjs/common';
import { eq, sql, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  boletos,
  compras,
  calificaciones,
  viajeAsientos,
  viajes,
  rutas,
  puntosOperacion,
  cooperativas,
  pasajerosCompra,
} from '@columbus/db';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type { CalificacionesRepositorio } from '../../dominio/calificaciones/calificaciones.ports';

/**
 * Usa DRIZZLE_DB_PUBLICO (bypass RLS) a propósito: `calificaciones` no
 * tiene política de aislamiento por cooperativa — es contenido
 * multi-cooperativa por diseño (un pasajero califica un boleto de
 * cualquier cooperativa, y el promedio se muestra en la búsqueda
 * pública, que también es multi-cooperativa), igual que el patrón ya
 * usado en BusquedaService.
 */
@Injectable()
export class CalificacionesRepositorioDrizzle implements CalificacionesRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async obtenerCooperativaSiBoletoPerteneceA(
    boletoId: string,
    usuarioId: string,
  ): Promise<{
    cooperativaId: string;
    horaSalidaProgramada: Date;
    horaLlegadaEstimada: Date | null;
  } | null> {
    const [fila] = await this.db
      .select({
        cooperativaId: boletos.cooperativaId,
        horaSalidaProgramada: viajes.horaSalidaProgramada,
        horaLlegadaEstimada: viajes.horaLlegadaEstimada,
      })
      .from(boletos)
      .innerJoin(compras, eq(boletos.compraId, compras.id))
      .innerJoin(viajeAsientos, eq(boletos.viajeAsientoId, viajeAsientos.id))
      .innerJoin(viajes, eq(viajeAsientos.viajeId, viajes.id))
      .where(
        sql`${boletos.id} = ${boletoId} AND ${compras.compradorUsuarioId} = ${usuarioId}`,
      );
    return fila ?? null;
  }

  async yaExisteCalificacionPara(boletoId: string): Promise<boolean> {
    const [fila] = await this.db
      .select({ id: calificaciones.id })
      .from(calificaciones)
      .where(eq(calificaciones.boletoId, boletoId));
    return !!fila;
  }

  async crear(datos: {
    boletoId: string;
    cooperativaId: string;
    pasajeroUsuarioId: string;
    puntuacion: number;
    comentario?: string;
  }): Promise<{ id: string }> {
    const [fila] = await this.db
      .insert(calificaciones)
      .values({
        boletoId: datos.boletoId,
        cooperativaId: datos.cooperativaId,
        pasajeroUsuarioId: datos.pasajeroUsuarioId,
        puntuacion: datos.puntuacion,
        comentario: datos.comentario,
      })
      .returning();
    return { id: fila.id };
  }

  async resumenPorCooperativa(
    cooperativaId: string,
  ): Promise<{ promedio: number | null; cantidad: number }> {
    const [fila] = await this.db
      .select({
        promedio: sql<string | null>`AVG(${calificaciones.puntuacion})`,
        cantidad: sql<number>`COUNT(*)::int`,
      })
      .from(calificaciones)
      .where(eq(calificaciones.cooperativaId, cooperativaId));
    return {
      promedio: fila?.promedio ? Number(fila.promedio) : null,
      cantidad: fila?.cantidad ?? 0,
    };
  }

  /**
   * Reseñas de texto reales (13-ago-2026) -- une calificaciones con
   * boletos (para llegar a pasajero_compra_id) y pasajeros_compra
   * (para el primer nombre real, campo `nombres` desde el ítem 31.1).
   * Solo filas con comentario no vacío -- una calificación sin texto
   * no cuenta como "reseña".
   *
   * El total se cuenta en una consulta aparte, NUNCA con
   * `COUNT(*) OVER()` en la misma consulta paginada -- bug real
   * encontrado por la prueba e2e propia de este mismo cambio: cuando
   * la página pedida no tiene ninguna fila (ej. página 2 de una lista
   * con 1 sola reseña), la consulta paginada no devuelve ninguna fila,
   * y con eso la función de ventana tampoco devuelve ningún total —
   * `total` volvía 0 en vez del valor real.
   */
  async listarResenasPorCooperativa(
    cooperativaId: string,
    pagina: number,
    porPagina: number,
  ): Promise<{
    resenas: {
      id: string;
      puntuacion: number;
      comentario: string;
      nombreAutor: string;
      creadoEn: Date;
    }[];
    total: number;
  }> {
    const condicion = sql`${calificaciones.cooperativaId} = ${cooperativaId} AND ${calificaciones.comentario} IS NOT NULL AND ${calificaciones.comentario} != ''`;

    const [{ total }] = await this.db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(calificaciones)
      .where(condicion);

    const offset = (pagina - 1) * porPagina;
    const filas = await this.db
      .select({
        id: calificaciones.id,
        puntuacion: calificaciones.puntuacion,
        comentario: calificaciones.comentario,
        nombreAutor: pasajerosCompra.nombres,
        creadoEn: calificaciones.creadoEn,
      })
      .from(calificaciones)
      .innerJoin(boletos, eq(calificaciones.boletoId, boletos.id))
      .innerJoin(pasajerosCompra, eq(boletos.pasajeroCompraId, pasajerosCompra.id))
      .where(condicion)
      .orderBy(desc(calificaciones.creadoEn))
      .limit(porPagina)
      .offset(offset);

    return {
      resenas: filas.map((f) => ({
        id: f.id,
        puntuacion: f.puntuacion,
        comentario: f.comentario as string,
        nombreAutor: f.nombreAutor,
        creadoEn: f.creadoEn,
      })),
      total,
    };
  }

  async listarBoletosDePasajero(usuarioId: string): Promise<
    {
      boletoId: string;
      codigoQr: string;
      cooperativaNombre: string;
      origenCiudad: string;
      destinoCiudad: string;
      fechaSalida: string;
      horaSalidaProgramada: Date;
      horaLlegadaEstimada: Date | null;
      yaCalificado: boolean;
      estado: string;
    }[]
  > {
    const puntosOrigen = alias(puntosOperacion, 'puntos_origen');
    const puntosDestino = alias(puntosOperacion, 'puntos_destino');

    const filas = await this.db
      .select({
        boletoId: boletos.id,
        codigoQr: boletos.codigoQr,
        estado: boletos.estado,
        cooperativaNombre: cooperativas.nombreComercial,
        origenCiudad: puntosOrigen.ciudad,
        destinoCiudad: puntosDestino.ciudad,
        fechaSalida: viajes.fechaSalida,
        horaSalidaProgramada: viajes.horaSalidaProgramada,
        horaLlegadaEstimada: viajes.horaLlegadaEstimada,
        calificacionId: calificaciones.id,
      })
      .from(boletos)
      .innerJoin(compras, eq(boletos.compraId, compras.id))
      .innerJoin(viajeAsientos, eq(boletos.viajeAsientoId, viajeAsientos.id))
      .innerJoin(viajes, eq(viajeAsientos.viajeId, viajes.id))
      .innerJoin(rutas, eq(viajes.rutaId, rutas.id))
      .innerJoin(
        puntosOrigen,
        eq(rutas.origenPuntoOperacionId, puntosOrigen.id),
      )
      .innerJoin(
        puntosDestino,
        eq(rutas.destinoPuntoOperacionId, puntosDestino.id),
      )
      .innerJoin(cooperativas, eq(boletos.cooperativaId, cooperativas.id))
      .leftJoin(calificaciones, eq(calificaciones.boletoId, boletos.id))
      .where(eq(compras.compradorUsuarioId, usuarioId))
      .orderBy(desc(viajes.horaSalidaProgramada));

    return filas.map((f) => ({
      boletoId: f.boletoId,
      codigoQr: f.codigoQr,
      estado: f.estado,
      cooperativaNombre: f.cooperativaNombre,
      origenCiudad: f.origenCiudad,
      destinoCiudad: f.destinoCiudad,
      fechaSalida: f.fechaSalida,
      horaSalidaProgramada: f.horaSalidaProgramada,
      horaLlegadaEstimada: f.horaLlegadaEstimada,
      yaCalificado: f.calificacionId !== null,
    }));
  }
}
