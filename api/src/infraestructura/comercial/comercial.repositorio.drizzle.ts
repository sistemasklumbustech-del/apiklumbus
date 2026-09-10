import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, lte } from 'drizzle-orm';
import {
  espaciosPublicitarios,
  planesComerciales,
  leadsAnunciantes,
  campanasPublicitarias,
  metricasPublicitarias,
} from '@columbus/db';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import type {
  ComercialRepositorio,
  DatosNuevoEspacioPublicitario,
  DatosNuevoPlanComercial,
  DatosNuevoLead,
  DatosNuevaCampana,
  EspacioPublicitarioResumen,
  PlanComercialResumen,
  LeadResumen,
  CampanaResumen,
  CampanaActiva,
  MetricaDia,
  EstadoLead,
} from '../../dominio/comercial/comercial.ports';

@Injectable()
export class ComercialRepositorioDrizzle implements ComercialRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async crearEspacioPublicitario(
    datos: DatosNuevoEspacioPublicitario,
  ): Promise<{ id: string }> {
    const [fila] = await this.db
      .insert(espaciosPublicitarios)
      .values({
        nombre: datos.nombre,
        descripcion: datos.descripcion,
        anchoPx: datos.anchoPx,
        altoPx: datos.altoPx,
        ubicacion: datos.ubicacion,
        permiteRotacion: datos.permiteRotacion ?? true,
      })
      .returning();
    return { id: fila.id };
  }

  async listarEspaciosPublicitarios(): Promise<EspacioPublicitarioResumen[]> {
    const filas = await this.db.select().from(espaciosPublicitarios);
    return filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      descripcion: f.descripcion,
      anchoPx: f.anchoPx,
      altoPx: f.altoPx,
      ubicacion: f.ubicacion,
      permiteRotacion: f.permiteRotacion,
      activo: f.activo,
    }));
  }

  async crearPlanComercial(
    datos: DatosNuevoPlanComercial,
  ): Promise<{ id: string }> {
    const [fila] = await this.db
      .insert(planesComerciales)
      .values({
        nombre: datos.nombre,
        precioMensual: datos.precioMensual?.toFixed(2),
        duracionDiasDefault: datos.duracionDiasDefault,
        formatosPermitidos: datos.formatosPermitidos,
      })
      .returning();
    return { id: fila.id };
  }

  async listarPlanesComerciales(): Promise<PlanComercialResumen[]> {
    const filas = await this.db.select().from(planesComerciales);
    return filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      precioMensual: f.precioMensual ? Number(f.precioMensual) : null,
      duracionDiasDefault: f.duracionDiasDefault,
      formatosPermitidos: f.formatosPermitidos,
      activo: f.activo,
    }));
  }

  async crearLead(datos: DatosNuevoLead): Promise<{ id: string }> {
    const [fila] = await this.db
      .insert(leadsAnunciantes)
      .values({
        nombreEmpresa: datos.nombreEmpresa,
        contactoNombre: datos.contactoNombre,
        contactoCorreo: datos.contactoCorreo,
        contactoTelefono: datos.contactoTelefono,
        mensaje: datos.mensaje,
      })
      .returning();
    return { id: fila.id };
  }

  async listarLeads(): Promise<LeadResumen[]> {
    const filas = await this.db.select().from(leadsAnunciantes);
    return filas.map((f) => ({
      id: f.id,
      nombreEmpresa: f.nombreEmpresa,
      contactoNombre: f.contactoNombre,
      contactoCorreo: f.contactoCorreo,
      contactoTelefono: f.contactoTelefono,
      mensaje: f.mensaje,
      estado: f.estado as EstadoLead,
      notasSeguimiento: f.notasSeguimiento,
      creadoEn: f.creadoEn,
    }));
  }

  async actualizarEstadoLead(
    id: string,
    datos: { estado?: EstadoLead; notasSeguimiento?: string },
  ): Promise<void> {
    const valores: Record<string, unknown> = {};
    if (datos.estado !== undefined) valores.estado = datos.estado;
    if (datos.notasSeguimiento !== undefined)
      valores.notasSeguimiento = datos.notasSeguimiento;
    if (Object.keys(valores).length === 0) return;

    // Mismo hallazgo y mismo fix que en admin.repositorio.drizzle.ts
    // (auditoría 28-jul-2026): antes este UPDATE no revisaba si el id
    // realmente existía.
    const filasActualizadas = await this.db
      .update(leadsAnunciantes)
      .set(valores)
      .where(eq(leadsAnunciantes.id, id))
      .returning({ id: leadsAnunciantes.id });

    if (filasActualizadas.length === 0) {
      throw new NotFoundException(`No existe un lead con id ${id}.`);
    }
  }

  async crearCampana(datos: DatosNuevaCampana): Promise<{ id: string }> {
    const [fila] = await this.db
      .insert(campanasPublicitarias)
      .values({
        espacioPublicitarioId: datos.espacioPublicitarioId,
        planComercialId: datos.planComercialId,
        leadAnuncianteId: datos.leadAnuncianteId,
        nombreAnunciante: datos.nombreAnunciante,
        formato: datos.formato,
        archivoUrl: datos.archivoUrl,
        fechaInicio: datos.fechaInicio,
        fechaFin: datos.fechaFin,
        estado: 'pendiente_revision',
      })
      .returning();
    return { id: fila.id };
  }

  async listarCampanas(): Promise<CampanaResumen[]> {
    const filas = await this.db.query.campanasPublicitarias.findMany({
      with: { espacioPublicitario: true, planComercial: true },
    });
    return filas.map((f) => ({
      id: f.id,
      espacioPublicitarioId: f.espacioPublicitarioId,
      espacioNombre: f.espacioPublicitario?.nombre ?? '',
      planNombre: f.planComercial?.nombre ?? '',
      nombreAnunciante: f.nombreAnunciante,
      formato: f.formato,
      archivoUrl: f.archivoUrl,
      fechaInicio: f.fechaInicio,
      fechaFin: f.fechaFin,
      estado: f.estado,
      aprobadoPorUsuarioId: f.aprobadoPorUsuarioId,
      aprobadoEn: f.aprobadoEn,
    }));
  }

  async aprobarCampana(
    campanaId: string,
    usuarioId: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    const campana = await this.db.query.campanasPublicitarias.findFirst({
      where: eq(campanasPublicitarias.id, campanaId),
    });
    if (!campana) {
      return { ok: false, motivo: 'Esta campana no existe.' };
    }
    if (campana.estado !== 'pendiente_revision') {
      return {
        ok: false,
        motivo: `Esta campana ya esta "${campana.estado}" -- solo se puede aprobar una campana pendiente de revision.`,
      };
    }
    await this.db
      .update(campanasPublicitarias)
      .set({
        estado: 'activa',
        aprobadoPorUsuarioId: usuarioId,
        aprobadoEn: new Date(),
      })
      .where(eq(campanasPublicitarias.id, campanaId));
    return { ok: true };
  }

  async rechazarCampana(
    campanaId: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    const campana = await this.db.query.campanasPublicitarias.findFirst({
      where: eq(campanasPublicitarias.id, campanaId),
    });
    if (!campana) {
      return { ok: false, motivo: 'Esta campana no existe.' };
    }
    if (campana.estado !== 'pendiente_revision') {
      return {
        ok: false,
        motivo: `Esta campana ya esta "${campana.estado}" -- solo se puede rechazar una campana pendiente de revision.`,
      };
    }
    await this.db
      .update(campanasPublicitarias)
      .set({ estado: 'rechazada' })
      .where(eq(campanasPublicitarias.id, campanaId));
    return { ok: true };
  }

  async listarCampanasActivas(ubicacion: string): Promise<CampanaActiva[]> {
    const hoy = new Date().toISOString().slice(0, 10);
    const filas = await this.db
      .select({
        campanaId: campanasPublicitarias.id,
        nombreAnunciante: campanasPublicitarias.nombreAnunciante,
        formato: campanasPublicitarias.formato,
        archivoUrl: campanasPublicitarias.archivoUrl,
        anchoPx: espaciosPublicitarios.anchoPx,
        altoPx: espaciosPublicitarios.altoPx,
      })
      .from(campanasPublicitarias)
      .innerJoin(
        espaciosPublicitarios,
        eq(campanasPublicitarias.espacioPublicitarioId, espaciosPublicitarios.id),
      )
      .where(
        and(
          eq(campanasPublicitarias.estado, 'activa'),
          eq(espaciosPublicitarios.ubicacion, ubicacion),
          eq(espaciosPublicitarios.activo, true),
          lte(campanasPublicitarias.fechaInicio, hoy),
          gte(campanasPublicitarias.fechaFin, hoy),
        ),
      );
    return filas;
  }

  /**
   * Verifica primero, luego inserta o actualiza -- no hay restriccion
   * unica (campana, fecha) en la base todavia (solo un indice), asi que
   * no se usa un upsert real de SQL. Aceptable para el volumen del
   * piloto; si el trafico crece mucho, conviene agregar la restriccion
   * unica en una migracion futura.
   */
  private async incrementarMetrica(
    campanaId: string,
    tipo: 'impresiones' | 'clics',
  ): Promise<void> {
    const campana = await this.db.query.campanasPublicitarias.findFirst({
      where: eq(campanasPublicitarias.id, campanaId),
    });
    if (!campana || campana.estado !== 'activa') return;

    const hoy = new Date().toISOString().slice(0, 10);
    const existente = await this.db.query.metricasPublicitarias.findFirst({
      where: and(
        eq(metricasPublicitarias.campanaPublicitariaId, campanaId),
        eq(metricasPublicitarias.fecha, hoy),
      ),
    });

    if (existente) {
      if (tipo === 'impresiones') {
        await this.db
          .update(metricasPublicitarias)
          .set({ impresiones: existente.impresiones + 1 })
          .where(eq(metricasPublicitarias.id, existente.id));
      } else {
        await this.db
          .update(metricasPublicitarias)
          .set({ clics: existente.clics + 1 })
          .where(eq(metricasPublicitarias.id, existente.id));
      }
    } else {
      await this.db.insert(metricasPublicitarias).values({
        campanaPublicitariaId: campanaId,
        fecha: hoy,
        impresiones: tipo === 'impresiones' ? 1 : 0,
        clics: tipo === 'clics' ? 1 : 0,
      });
    }
  }

  async registrarImpresion(campanaId: string): Promise<void> {
    await this.incrementarMetrica(campanaId, 'impresiones');
  }

  async registrarClic(campanaId: string): Promise<void> {
    await this.incrementarMetrica(campanaId, 'clics');
  }

  async obtenerMetricasCampana(campanaId: string): Promise<MetricaDia[]> {
    const filas = await this.db
      .select({
        fecha: metricasPublicitarias.fecha,
        impresiones: metricasPublicitarias.impresiones,
        clics: metricasPublicitarias.clics,
      })
      .from(metricasPublicitarias)
      .where(eq(metricasPublicitarias.campanaPublicitariaId, campanaId))
      .orderBy(metricasPublicitarias.fecha);
    return filas;
  }
}
