import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { sql, eq, inArray } from 'drizzle-orm';
import {
  cooperativas,
  usuarios,
  puntosOperacion,
  bannersPropios,
} from '@columbus/db';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import { BcryptHasher } from '../auth/bcrypt.hasher';
import type {
  AdminRepositorio,
  DatosNuevaCooperativa,
  DatosPrimerUsuarioCooperativa,
  DatosNuevoPuntoOperacion,
  FilaVentaNacional,
  FilaConteoUsuariosPorRol,
  ModoIvaBoleto,
  DatosNuevoAdministrador,
  AdministradorResumen,
} from '../../dominio/admin/admin.ports';

/**
 * Todas las operaciones de este repositorio usan DRIZZLE_DB_PUBLICO
 * (rol con BYPASSRLS) a propósito: dar de alta una cooperativa o ver el
 * dashboard nacional son, por definición, operaciones de plataforma que
 * no pertenecen a ninguna cooperativa en particular — es exactamente el
 * mismo razonamiento que ya se aplicó a la búsqueda pública de viajes.
 */
@Injectable()
export class AdminRepositorioDrizzle implements AdminRepositorio {
  constructor(
    @Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb,
    private readonly hasher: BcryptHasher,
  ) {}

  async crearCooperativaConPrimerUsuarioAtomico(
    datosCooperativa: DatosNuevaCooperativa,
    datosUsuario: DatosPrimerUsuarioCooperativa,
  ): Promise<{ cooperativaId: string; usuarioId: string }> {
    // Mismo patrón que AuthService.registrar (revisar primero, en vez
    // de dejar que el error crudo de Postgres llegue al usuario) —
    // hallazgo real del 22-jul-2026: antes de esto, un correo duplicado
    // se veía como "Internal server error" sin ninguna pista de la
    // causa real.
    const [correoExistente] = await this.db
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.correo, datosUsuario.correo));
    if (correoExistente) {
      throw new ConflictException(
        `Ya existe un usuario registrado con el correo ${datosUsuario.correo}.`,
      );
    }

    // El hash de la contraseña se calcula ANTES de abrir la transacción
    // a propósito: bcrypt es intencionalmente lento (RNF-SEG-002), y no
    // hay razón para mantener la transacción de base de datos abierta
    // (con sus locks) mientras se espera ese cómputo en CPU.
    const passwordHash = await this.hasher.hash(datosUsuario.password);

    try {
      return await this.db.transaction(async (tx) => {
        const [filaCooperativa] = await tx
          .insert(cooperativas)
          .values({
            ruc: datosCooperativa.ruc,
            razonSocial: datosCooperativa.razonSocial,
            nombreComercial: datosCooperativa.nombreComercial,
            modeloIntegracion: datosCooperativa.modeloIntegracion,
            estado: 'aprobada',
            contactoNombre: datosCooperativa.contactoNombre,
            contactoCorreo: datosCooperativa.contactoCorreo,
            contactoTelefono: datosCooperativa.contactoTelefono,
            fechaAfiliacion: new Date(),
          })
          .returning();

        const [filaUsuario] = await tx
          .insert(usuarios)
          .values({
            rol: 'admin_cooperativa',
            cooperativaId: filaCooperativa.id,
            correo: datosUsuario.correo,
            passwordHash,
            nombreCompleto: datosUsuario.nombreCompleto,
          })
          .returning();

        return { cooperativaId: filaCooperativa.id, usuarioId: filaUsuario.id };
      });
    } catch (error) {
      // Respaldo para la carrera de condición (dos solicitudes con el
      // mismo correo llegando casi al mismo tiempo, entre el SELECT de
      // arriba y este INSERT) — muy improbable, pero si pasa, el
      // mensaje debe seguir siendo claro, no un error crudo de Postgres.
      const errorTipado = error as { cause?: { constraint?: string } };
      if (errorTipado?.cause?.constraint === 'uq_usuarios_correo') {
        throw new ConflictException(
          `Ya existe un usuario registrado con el correo ${datosUsuario.correo}.`,
        );
      }
      throw error;
    }
  }

  async listarCooperativas() {
    return this.db
      .select({
        id: cooperativas.id,
        nombreComercial: cooperativas.nombreComercial,
        estado: cooperativas.estado,
      })
      .from(cooperativas);
  }

  async listarPuntosOperacion() {
    const filas = await this.db
      .select({
        id: puntosOperacion.id,
        tipo: puntosOperacion.tipo,
        nombre: puntosOperacion.nombre,
        ciudad: puntosOperacion.ciudad,
        provincia: puntosOperacion.provincia,
        tasaMonto: puntosOperacion.tasaMonto,
        logoUrl: puntosOperacion.logoUrl,
        latitud: puntosOperacion.latitud,
        longitud: puntosOperacion.longitud,
        cooperativaPropietariaNombre: cooperativas.nombreComercial,
      })
      .from(puntosOperacion)
      .leftJoin(
        cooperativas,
        eq(puntosOperacion.cooperativaPropietariaId, cooperativas.id),
      );
    return filas.map((f) => ({
      ...f,
      tasaMonto: f.tasaMonto !== null ? Number(f.tasaMonto) : null,
    }));
  }

  async crearPuntoOperacion(
    datos: DatosNuevoPuntoOperacion,
  ): Promise<{ puntoOperacionId: string }> {
    const [fila] = await this.db
      .insert(puntosOperacion)
      .values({
        tipo: datos.tipo,
        nombre: datos.nombre,
        ciudad: datos.ciudad,
        provincia: datos.provincia,
        cooperativaPropietariaId: datos.cooperativaPropietariaId,
        tasaMonto:
          datos.tasaMonto !== undefined ? String(datos.tasaMonto) : undefined,
      })
      .returning();
    return { puntoOperacionId: fila.id };
  }

  async actualizarPuntoOperacion(
    id: string,
    datos: Partial<DatosNuevoPuntoOperacion>,
  ): Promise<void> {
    const valores: Record<string, unknown> = {};
    if (datos.tipo !== undefined) valores.tipo = datos.tipo;
    if (datos.nombre !== undefined) valores.nombre = datos.nombre;
    if (datos.ciudad !== undefined) valores.ciudad = datos.ciudad;
    if (datos.provincia !== undefined) valores.provincia = datos.provincia;
    if (datos.cooperativaPropietariaId !== undefined)
      valores.cooperativaPropietariaId = datos.cooperativaPropietariaId;
    if (datos.tasaMonto !== undefined)
      valores.tasaMonto = String(datos.tasaMonto);
    if (datos.logoUrl !== undefined) valores.logoUrl = datos.logoUrl;
    if (datos.latitud !== undefined) valores.latitud = datos.latitud;
    if (datos.longitud !== undefined) valores.longitud = datos.longitud;

    if (Object.keys(valores).length === 0) return; // nada que actualizar

    // Hallazgo real de auditoría (28-jul-2026): antes este UPDATE no
    // revisaba si el id realmente existía — un id inválido "tenía éxito"
    // en silencio, sin cambiar nada, sin avisarle al admin.
    const filasActualizadas = await this.db
      .update(puntosOperacion)
      .set(valores)
      .where(eq(puntosOperacion.id, id))
      .returning({ id: puntosOperacion.id });

    if (filasActualizadas.length === 0) {
      throw new NotFoundException(
        `No existe un punto de operación con id ${id}.`,
      );
    }
  }

  /**
   * Cooperativas proponen sus propios puntos de operación (13-ago-2026).
   * Inserta directo en 'pendiente_revision' -- el default de la
   * columna es 'aprobado' (para no romper crearPuntoOperacion, que no
   * lo especifica), así que aquí SÍ hay que setearlo explícito.
   */
  async proponerPuntoOperacion(datos: {
    tipo: 'oficina_agencia' | 'parada_intermedia';
    nombre: string;
    ciudad: string;
    provincia: string;
    cooperativaPropietariaId: string;
  }): Promise<{ puntoOperacionId: string }> {
    const [fila] = await this.db
      .insert(puntosOperacion)
      .values({
        tipo: datos.tipo,
        nombre: datos.nombre,
        ciudad: datos.ciudad,
        provincia: datos.provincia,
        cooperativaPropietariaId: datos.cooperativaPropietariaId,
        estado: 'pendiente_revision',
      })
      .returning();
    return { puntoOperacionId: fila.id };
  }

  async listarPuntosOperacionPendientes(): Promise<
    {
      id: string;
      tipo: string;
      nombre: string;
      ciudad: string;
      provincia: string;
      cooperativaPropietariaId: string | null;
      cooperativaPropietariaNombre: string | null;
      creadoEn: Date;
    }[]
  > {
    const filas = await this.db
      .select({
        id: puntosOperacion.id,
        tipo: puntosOperacion.tipo,
        nombre: puntosOperacion.nombre,
        ciudad: puntosOperacion.ciudad,
        provincia: puntosOperacion.provincia,
        cooperativaPropietariaId: puntosOperacion.cooperativaPropietariaId,
        cooperativaPropietariaNombre: cooperativas.nombreComercial,
        creadoEn: puntosOperacion.creadoEn,
      })
      .from(puntosOperacion)
      .leftJoin(cooperativas, eq(puntosOperacion.cooperativaPropietariaId, cooperativas.id))
      .where(eq(puntosOperacion.estado, 'pendiente_revision'))
      .orderBy(puntosOperacion.creadoEn);
    return filas;
  }

  /** Mismo patrón exacto que aprobarCampana -- ok:false con motivo si ya no está pendiente. */
  async aprobarPuntoOperacion(
    id: string,
    usuarioId: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    const punto = await this.db.query.puntosOperacion.findFirst({
      where: eq(puntosOperacion.id, id),
    });
    if (!punto) {
      return { ok: false, motivo: 'Este punto de operación no existe.' };
    }
    if (punto.estado !== 'pendiente_revision') {
      return {
        ok: false,
        motivo: `Este punto de operación ya está "${punto.estado}" -- solo se puede aprobar uno pendiente de revisión.`,
      };
    }
    await this.db
      .update(puntosOperacion)
      .set({ estado: 'aprobado', aprobadoPorUsuarioId: usuarioId, aprobadoEn: new Date() })
      .where(eq(puntosOperacion.id, id));
    return { ok: true };
  }

  async rechazarPuntoOperacion(
    id: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    const punto = await this.db.query.puntosOperacion.findFirst({
      where: eq(puntosOperacion.id, id),
    });
    if (!punto) {
      return { ok: false, motivo: 'Este punto de operación no existe.' };
    }
    if (punto.estado !== 'pendiente_revision') {
      return {
        ok: false,
        motivo: `Este punto de operación ya está "${punto.estado}" -- solo se puede rechazar uno pendiente de revisión.`,
      };
    }
    await this.db
      .update(puntosOperacion)
      .set({ estado: 'rechazado' })
      .where(eq(puntosOperacion.id, id));
    return { ok: true };
  }

  async dashboardNacional(): Promise<FilaVentaNacional[]> {
    // Hallazgo real del director (25-ago-2026): esta consulta cruda
    // devolvia columnas en snake_case (asi las nombra Postgres por
    // defecto), pero la interfaz FilaVentaNacional espera camelCase --
    // el "as unknown as" de abajo solo enganaba a TypeScript, en
    // tiempo de ejecucion cada v.totalBoletos/v.totalVentas del
    // frontend daba "undefined", mostrando "NaN" en pantalla. Se
    // corrige con alias explicitos entre comillas dobles (Postgres
    // respeta mayusculas solo asi), para que coincidan de verdad.
    const resultado = await this.db.execute(sql`
      SELECT c.nombre_comercial AS "cooperativaNombre",
             COALESCE(SUM(b.precio_pagado), 0)::float AS "totalVentas",
             COUNT(b.id)::int AS "totalBoletos"
      FROM cooperativas c
      LEFT JOIN boletos b ON b.cooperativa_id = c.id
      GROUP BY c.id, c.nombre_comercial
      ORDER BY "totalVentas" DESC
    `);
    return resultado.rows as unknown as FilaVentaNacional[];
  }

  async obtenerIvaNacional(): Promise<number> {
    const resultado = await this.db.execute(sql`
      SELECT iva_porcentaje_nacional FROM configuracion_plataforma LIMIT 1
    `);
    const fila = resultado.rows[0] as
      { iva_porcentaje_nacional: string } | undefined;
    // Nullable-en-la-práctica: si todavía no existe la fila singleton de
    // configuracion_plataforma, se asume el valor por defecto de la
    // columna (15.00) en vez de fallar.
    return fila ? Number(fila.iva_porcentaje_nacional) : 15;
  }

  async actualizarYPropagarIvaNacional(
    nuevoPorcentaje: number,
    usuarioId: string,
  ): Promise<{ cooperativasActualizadas: number }> {
    // 1) Actualiza (o crea, si todavía no existe la fila singleton) la
    //    configuración global.
    const filaExistente = await this.db.execute(
      sql`SELECT id FROM configuracion_plataforma LIMIT 1`,
    );
    let configuracionId: string;
    if (filaExistente.rows.length === 0) {
      const creada = await this.db.execute(sql`
        INSERT INTO configuracion_plataforma (ruc_plataforma, razon_social_plataforma, iva_porcentaje_nacional)
        VALUES ('9999999999001', 'Columbus (pendiente RUC real)', ${nuevoPorcentaje})
        RETURNING id
      `);
      configuracionId = (creada.rows[0] as { id: string }).id;
    } else {
      configuracionId = (filaExistente.rows[0] as { id: string }).id;
      await this.db.execute(sql`
        UPDATE configuracion_plataforma
        SET iva_porcentaje_nacional = ${nuevoPorcentaje}, actualizado_en = now()
        WHERE id = ${configuracionId}
      `);
    }

    // 2) Propaga SOLO a las cooperativas en modo automático — las que
    //    fijaron su propio valor manualmente quedan intactas.
    const propagado = await this.db.execute(sql`
      UPDATE cooperativas
      SET iva_porcentaje = ${nuevoPorcentaje}
      WHERE iva_sigue_tasa_nacional = true
      RETURNING id
    `);

    // 3) Auditoría — acción crítica que afecta a todas las cooperativas.
    await this.db.execute(sql`
      INSERT INTO auditoria_admin (accion, usuario_id, entidad_tipo, entidad_id, detalle)
      VALUES (
        'actualizacion_iva_nacional',
        ${usuarioId},
        'configuracion_plataforma',
        ${configuracionId},
        ${JSON.stringify({ nuevoPorcentaje, cooperativasActualizadas: propagado.rows.length })}
      )
    `);

    return { cooperativasActualizadas: propagado.rows.length };
  }

  async obtenerCargoPlataforma(): Promise<number> {
    const resultado = await this.db.execute(
      sql`SELECT cargo_plataforma_por_pasajero_default FROM configuracion_plataforma LIMIT 1`,
    );
    const fila = resultado.rows[0] as
      { cargo_plataforma_por_pasajero_default: string | null } | undefined;
    return fila?.cargo_plataforma_por_pasajero_default
      ? Number(fila.cargo_plataforma_por_pasajero_default)
      : 0;
  }

  async actualizarCargoPlataforma(nuevoMonto: number, usuarioId: string): Promise<void> {
    const filaExistente = await this.db.execute(
      sql`SELECT id FROM configuracion_plataforma LIMIT 1`,
    );
    let configuracionId: string;
    if (filaExistente.rows.length === 0) {
      const creada = await this.db.execute(sql`
        INSERT INTO configuracion_plataforma (ruc_plataforma, razon_social_plataforma, cargo_plataforma_por_pasajero_default)
        VALUES ('9999999999001', 'Columbus (pendiente RUC real)', ${nuevoMonto})
        RETURNING id
      `);
      configuracionId = (creada.rows[0] as { id: string }).id;
    } else {
      configuracionId = (filaExistente.rows[0] as { id: string }).id;
      await this.db.execute(sql`
        UPDATE configuracion_plataforma
        SET cargo_plataforma_por_pasajero_default = ${nuevoMonto}, actualizado_en = now()
        WHERE id = ${configuracionId}
      `);
    }

    // 04-ago-2026, ítem 9 -- reutiliza 'cambio_comision', que existía
    // en el enum sin usar hasta ahora (el cargo fijo por pasajero es
    // el concepto de comisión de esta plataforma).
    await this.db.execute(sql`
      INSERT INTO auditoria_admin (accion, usuario_id, entidad_tipo, entidad_id, detalle)
      VALUES ('cambio_comision', ${usuarioId}, 'configuracion_plataforma', ${configuracionId}, ${JSON.stringify({ nuevoMonto })})
    `);
  }

  /**
   * Contacto de soporte global (13-ago-2026) -- mismo patrón exacto que
   * obtenerCargoPlataforma / actualizarCargoPlataforma.
   */
  async obtenerContactoSoporte(): Promise<{ correo: string | null; telefono: string | null }> {
    const resultado = await this.db.execute(
      sql`SELECT soporte_correo, soporte_telefono FROM configuracion_plataforma LIMIT 1`,
    );
    const fila = resultado.rows[0] as
      | { soporte_correo: string | null; soporte_telefono: string | null }
      | undefined;
    return {
      correo: fila?.soporte_correo ?? null,
      telefono: fila?.soporte_telefono ?? null,
    };
  }

  async actualizarContactoSoporte(
    datos: { correo: string | null; telefono: string | null },
    usuarioId: string,
  ): Promise<void> {
    const filaExistente = await this.db.execute(
      sql`SELECT id FROM configuracion_plataforma LIMIT 1`,
    );
    let configuracionId: string;
    if (filaExistente.rows.length === 0) {
      const creada = await this.db.execute(sql`
        INSERT INTO configuracion_plataforma (ruc_plataforma, razon_social_plataforma, soporte_correo, soporte_telefono)
        VALUES ('9999999999001', 'Columbus (pendiente RUC real)', ${datos.correo}, ${datos.telefono})
        RETURNING id
      `);
      configuracionId = (creada.rows[0] as { id: string }).id;
    } else {
      configuracionId = (filaExistente.rows[0] as { id: string }).id;
      await this.db.execute(sql`
        UPDATE configuracion_plataforma
        SET soporte_correo = ${datos.correo}, soporte_telefono = ${datos.telefono}, actualizado_en = now()
        WHERE id = ${configuracionId}
      `);
    }

    await this.db.execute(sql`
      INSERT INTO auditoria_admin (accion, usuario_id, entidad_tipo, entidad_id, detalle)
      VALUES ('cambio_contacto_soporte', ${usuarioId}, 'configuracion_plataforma', ${configuracionId}, ${JSON.stringify(datos)})
    `);
  }

  async listarBannersPropios() {
    return this.db
      .select({
        id: bannersPropios.id,
        titulo: bannersPropios.titulo,
        imagenUrl: bannersPropios.imagenUrl,
        enlaceUrl: bannersPropios.enlaceUrl,
        activo: bannersPropios.activo,
        orden: bannersPropios.orden,
      })
      .from(bannersPropios)
      .orderBy(bannersPropios.orden);
  }

  async crearBannerPropio(datos: {
    titulo: string;
    imagenUrl: string;
    enlaceUrl: string;
    orden?: number;
  }): Promise<{ id: string }> {
    const [fila] = await this.db
      .insert(bannersPropios)
      .values({
        titulo: datos.titulo,
        imagenUrl: datos.imagenUrl,
        enlaceUrl: datos.enlaceUrl,
        orden: datos.orden ?? 0,
      })
      .returning();
    return { id: fila.id };
  }

  async actualizarBannerPropio(
    id: string,
    datos: { activo?: boolean; orden?: number },
  ): Promise<void> {
    const filasActualizadas = await this.db
      .update(bannersPropios)
      .set(datos)
      .where(eq(bannersPropios.id, id))
      .returning({ id: bannersPropios.id });

    if (filasActualizadas.length === 0) {
      throw new NotFoundException(`No existe un banner con id ${id}.`);
    }
  }

  async eliminarBannerPropio(id: string): Promise<void> {
    const filasBorradas = await this.db
      .delete(bannersPropios)
      .where(eq(bannersPropios.id, id))
      .returning({ id: bannersPropios.id });

    if (filasBorradas.length === 0) {
      throw new NotFoundException(`No existe un banner con id ${id}.`);
    }
  }

  async obtenerModoIvaBoleto(): Promise<ModoIvaBoleto> {
    const resultado = await this.db.execute(
      sql`SELECT modo_iva_boleto FROM configuracion_plataforma LIMIT 1`,
    );
    const fila = resultado.rows[0] as { modo_iva_boleto: string } | undefined;
    return (fila?.modo_iva_boleto as ModoIvaBoleto) ?? 'calculado';
  }

  async actualizarModoIvaBoleto(modo: ModoIvaBoleto, usuarioId: string): Promise<void> {
    const filaExistente = await this.db.execute(
      sql`SELECT id FROM configuracion_plataforma LIMIT 1`,
    );
    let configuracionId: string;
    if (filaExistente.rows.length === 0) {
      const creada = await this.db.execute(sql`
        INSERT INTO configuracion_plataforma (ruc_plataforma, razon_social_plataforma, modo_iva_boleto)
        VALUES ('9999999999001', 'Columbus (pendiente RUC real)', ${modo})
        RETURNING id
      `);
      configuracionId = (creada.rows[0] as { id: string }).id;
    } else {
      configuracionId = (filaExistente.rows[0] as { id: string }).id;
      await this.db.execute(sql`
        UPDATE configuracion_plataforma
        SET modo_iva_boleto = ${modo}, actualizado_en = now()
        WHERE id = ${configuracionId}
      `);
    }

    // 04-ago-2026, ítem 9 -- valor nuevo del enum, sin equivalente existente.
    await this.db.execute(sql`
      INSERT INTO auditoria_admin (accion, usuario_id, entidad_tipo, entidad_id, detalle)
      VALUES ('cambio_modo_iva_boleto', ${usuarioId}, 'configuracion_plataforma', ${configuracionId}, ${JSON.stringify({ modo })})
    `);
  }

  /**
   * 02-ago-2026 -- RF-ADMIN sección 3.13. Solo cuenta usuarios con
   * activo=true (decisión del director, confirmada 02-ago-2026): un
   * usuario inactivo no debe pesar en "cuántos usuarios hay" desde el
   * punto de vista operativo. Roles sin ningún usuario activo no
   * aparecen en el resultado -- el service se encarga de completar el
   * desglose con cantidad=0 para los roles que falten.
   */
  async contarUsuariosPorRol(): Promise<FilaConteoUsuariosPorRol[]> {
    const resultado = await this.db.execute(sql`
      SELECT rol, COUNT(*)::int AS cantidad
      FROM usuarios
      WHERE activo = true
      GROUP BY rol
      ORDER BY rol
    `);
    return resultado.rows as unknown as FilaConteoUsuariosPorRol[];
  }

  /**
   * Ítem 9, Fase 2 (04-ago-2026) -- mismo patrón que
   * crearCooperativaConPrimerUsuarioAtomico: revisa el correo duplicado
   * ANTES de intentar, hash de contraseña antes de la operación real.
   */
  async crearAdministrador(
    datos: DatosNuevoAdministrador,
    creadoPorUsuarioId: string,
  ): Promise<{ id: string }> {
    const [correoExistente] = await this.db
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.correo, datos.correo));
    if (correoExistente) {
      throw new ConflictException(
        `Ya existe un usuario registrado con el correo ${datos.correo}.`,
      );
    }

    const passwordHash = await this.hasher.hash(datos.password);
    const [fila] = await this.db
      .insert(usuarios)
      .values({
        rol: datos.rol,
        correo: datos.correo,
        passwordHash,
        nombreCompleto: datos.nombreCompleto,
      })
      .returning();

    await this.db.execute(sql`
      INSERT INTO auditoria_admin (accion, usuario_id, entidad_tipo, entidad_id, detalle)
      VALUES ('creacion_administrador', ${creadoPorUsuarioId}, 'usuario', ${fila.id}, ${JSON.stringify({ correo: datos.correo, rol: datos.rol })})
    `);

    return { id: fila.id };
  }

  async listarAdministradores(): Promise<AdministradorResumen[]> {
    const filas = await this.db
      .select({
        id: usuarios.id,
        correo: usuarios.correo,
        nombreCompleto: usuarios.nombreCompleto,
        rol: usuarios.rol,
        activo: usuarios.activo,
        creadoEn: usuarios.creadoEn,
      })
      .from(usuarios)
      .where(inArray(usuarios.rol, ['admin_plataforma', 'super_admin']));
    return filas as unknown as AdministradorResumen[];
  }

  /**
   * Baja lógica (`activo = false`), NO DELETE físico -- un DELETE real
   * violaría la llave foránea de auditoria_admin.usuario_id (el propio
   * registro de auditoría que se acaba de crear al eliminar a alguien
   * referencia a ESE mismo usuario), además de perder la trazabilidad
   * de qué hizo ese admin mientras estuvo activo.
   */
  async eliminarAdministrador(
    id: string,
    eliminadoPorUsuarioId: string,
  ): Promise<void> {
    const filas = await this.db
      .update(usuarios)
      .set({ activo: false })
      .where(eq(usuarios.id, id))
      .returning({ id: usuarios.id });

    if (filas.length === 0) {
      throw new NotFoundException(`No existe un administrador con id ${id}.`);
    }

    await this.db.execute(sql`
      INSERT INTO auditoria_admin (accion, usuario_id, entidad_tipo, entidad_id, detalle)
      VALUES ('eliminacion_administrador', ${eliminadoPorUsuarioId}, 'usuario', ${id}, '{}')
    `);
  }

  /**
   * Baja lógica (`estado = 'dada_de_baja'`, valor que ya existía en el
   * enum sin usar) -- NO elimina boletos/pagos/liquidaciones históricos.
   * Decisión del director: destruir esos registros sería peligroso e
   * irreversible.
   */
  async eliminarCooperativa(
    id: string,
    eliminadoPorUsuarioId: string,
  ): Promise<void> {
    const filas = await this.db
      .update(cooperativas)
      .set({ estado: 'dada_de_baja' })
      .where(eq(cooperativas.id, id))
      .returning({ id: cooperativas.id });

    if (filas.length === 0) {
      throw new NotFoundException(`No existe una cooperativa con id ${id}.`);
    }

    await this.db.execute(sql`
      INSERT INTO auditoria_admin (accion, usuario_id, entidad_tipo, entidad_id, detalle)
      VALUES ('baja_cooperativa', ${eliminadoPorUsuarioId}, 'cooperativa', ${id}, '{}')
    `);
  }
}
