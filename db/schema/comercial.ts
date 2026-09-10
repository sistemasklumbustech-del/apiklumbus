/**
 * Módulo comercial y monetización publicitaria — RF-COMM.
 *
 * Ninguna tabla de este módulo lleva `cooperativa_id` ni política RLS: el
 * SRS es explícito en que "la landing page es, en sí misma, un activo
 * comercial de la plataforma (no de las cooperativas)" (intro de sección
 * 3.10). Es contenido y venta gestionados enteramente por el
 * administrador de plataforma.
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  jsonb,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { usuarios } from './usuarios';
import { comprobantesElectronicos } from './facturacion';
import {
  planComercialEnum,
  estadoCampanaEnum,
  estadoLeadEnum,
  formatoCreatividadEnum,
} from './enums';

/** RF-COMM-001 — catálogo de espacios publicitarios disponibles. */
export const espaciosPublicitarios = pgTable('espacios_publicitarios', {
  id: uuid('id').defaultRandom().primaryKey(),
  nombre: varchar('nombre', { length: 100 }).notNull(), // ej. 'banner_principal', 'descubre_tu_destino'
  descripcion: text('descripcion'),
  anchoPx: integer('ancho_px'),
  altoPx: integer('alto_px'),
  ubicacion: varchar('ubicacion', { length: 100 }).notNull(),
  // RF-COMM-001 — "salvo que el espacio soporte rotación explícita": si es
  // true, sí pueden coexistir varias campañas activas simultáneas en este
  // espacio (rotando entre ellas); si es false, una activa bloquea a las
  // demás para ese periodo.
  permiteRotacion: boolean('permite_rotacion').default(false).notNull(),
  activo: boolean('activo').default(true).notNull(),
});

/**
 * RF-COMM-002 — planes con alcance, ubicación, duración y precio
 * configurables. `precioMensual` y `duracionDiasDefault` son nullable a
 * propósito: el modelo comercial (tarifas exactas) es una decisión de
 * negocio explícitamente pendiente (SRS, nota al final de 3.10) — esta
 * tabla define la *forma* que debe soportar el software, no inventa un
 * precio.
 */
export const planesComerciales = pgTable('planes_comerciales', {
  id: uuid('id').defaultRandom().primaryKey(),
  nombre: planComercialEnum('nombre').notNull(),
  precioMensual: numeric('precio_mensual', { precision: 10, scale: 2 }),
  duracionDiasDefault: integer('duracion_dias_default'),
  // RF-COMM-008 — solo el plan Premium soporta video corto silenciado.
  formatosPermitidos: jsonb('formatos_permitidos').notNull(),
  activo: boolean('activo').default(true).notNull(),
});

/** RF-COMM-003 — captación de leads de anunciantes desde el formulario comercial. */
export const leadsAnunciantes = pgTable(
  'leads_anunciantes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    nombreEmpresa: varchar('nombre_empresa', { length: 150 }).notNull(),
    contactoNombre: varchar('contacto_nombre', { length: 150 }),
    contactoCorreo: varchar('contacto_correo', { length: 200 }).notNull(),
    contactoTelefono: varchar('contacto_telefono', { length: 20 }),
    mensaje: text('mensaje'),

    estado: estadoLeadEnum('estado').default('nuevo').notNull(),
    notasSeguimiento: text('notas_seguimiento'),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_leads_anunciantes_estado').on(t.estado)],
);

/**
 * RF-COMM-004/007/008/009 — campaña publicitaria concreta: creatividad,
 * vigencia, moderación y (si aplica) el comprobante de venta a nombre de
 * la plataforma (RF-COMM-006).
 */
export const campanasPublicitarias = pgTable(
  'campanas_publicitarias',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    espacioPublicitarioId: uuid('espacio_publicitario_id')
      .references(() => espaciosPublicitarios.id)
      .notNull(),
    planComercialId: uuid('plan_comercial_id')
      .references(() => planesComerciales.id)
      .notNull(),
    leadAnuncianteId: uuid('lead_anunciante_id').references(() => leadsAnunciantes.id),

    nombreAnunciante: varchar('nombre_anunciante', { length: 150 }).notNull(),
    formato: formatoCreatividadEnum('formato').notNull(),

    // RF-COMM-009 — el archivo lo carga el equipo de TicketYa desde el
    // Panel Admin, nunca el anunciante directamente; esta columna guarda
    // dónde quedó alojado ese archivo ya recortado al tamaño del espacio.
    archivoUrl: text('archivo_url').notNull(),

    fechaInicio: date('fecha_inicio').notNull(),
    fechaFin: date('fecha_fin').notNull(),

    // RF-COMM-007 — moderación: no puede pasar a 'activa' sin aprobación
    // explícita registrada (aprobadoPorUsuarioId + aprobadoEn).
    estado: estadoCampanaEnum('estado').default('pendiente_revision').notNull(),
    aprobadoPorUsuarioId: uuid('aprobado_por_usuario_id').references(() => usuarios.id),
    aprobadoEn: timestamp('aprobado_en', { withTimezone: true }),

    // RF-COMM-006 — nullable hasta que se emita; una campaña recién creada
    // (aún en 'pendiente_revision') todavía no tiene comprobante.
    comprobanteElectronicoId: uuid('comprobante_electronico_id').references(
      () => comprobantesElectronicos.id,
    ),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_campanas_publicitarias_espacio').on(t.espacioPublicitarioId),
    index('idx_campanas_publicitarias_estado').on(t.estado),
    index('idx_campanas_publicitarias_vigencia').on(t.fechaInicio, t.fechaFin),
  ],
);

/**
 * RF-COMM-005 — métricas de desempeño publicitario (impresiones y clics).
 * Se agrega por día en vez de una fila por evento individual, porque el
 * criterio de aceptación solo pide "consultar el número de impresiones...
 * para un rango de fechas" — no un log evento-por-evento, que además
 * crecería sin límite en volumen de tráfico real.
 */
export const metricasPublicitarias = pgTable(
  'metricas_publicitarias',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    campanaPublicitariaId: uuid('campana_publicitaria_id')
      .references(() => campanasPublicitarias.id)
      .notNull(),
    fecha: date('fecha').notNull(),
    impresiones: integer('impresiones').default(0).notNull(),
    clics: integer('clics').default(0).notNull(),
  },
  (t) => [
    index('idx_metricas_publicitarias_campana_fecha').on(t.campanaPublicitariaId, t.fecha),
  ],
);

export const espaciosPublicitariosRelations = relations(espaciosPublicitarios, ({ many }) => ({
  campanas: many(campanasPublicitarias),
}));

export const planesComercialesRelations = relations(planesComerciales, ({ many }) => ({
  campanas: many(campanasPublicitarias),
}));

export const leadsAnunciantesRelations = relations(leadsAnunciantes, ({ many }) => ({
  campanas: many(campanasPublicitarias),
}));

export const campanasPublicitariasRelations = relations(campanasPublicitarias, ({ one, many }) => ({
  espacioPublicitario: one(espaciosPublicitarios, {
    fields: [campanasPublicitarias.espacioPublicitarioId],
    references: [espaciosPublicitarios.id],
  }),
  planComercial: one(planesComerciales, {
    fields: [campanasPublicitarias.planComercialId],
    references: [planesComerciales.id],
  }),
  leadAnunciante: one(leadsAnunciantes, {
    fields: [campanasPublicitarias.leadAnuncianteId],
    references: [leadsAnunciantes.id],
  }),
  aprobadoPor: one(usuarios, {
    fields: [campanasPublicitarias.aprobadoPorUsuarioId],
    references: [usuarios.id],
  }),
  comprobanteElectronico: one(comprobantesElectronicos, {
    fields: [campanasPublicitarias.comprobanteElectronicoId],
    references: [comprobantesElectronicos.id],
  }),
  metricas: many(metricasPublicitarias),
}));

export const metricasPublicitariasRelations = relations(metricasPublicitarias, ({ one }) => ({
  campana: one(campanasPublicitarias, {
    fields: [metricasPublicitarias.campanaPublicitariaId],
    references: [campanasPublicitarias.id],
  }),
}));

/**
 * Banners propios (22-jul-2026) — versión deliberadamente simple, NO
 * parte de RF-COMM. Sirve para que la propia plataforma (o productos
 * hermanos, ej. DevX, Surebets24/7) se promocione en su propia página,
 * o para que un terminal salude a los pasajeros — sin proceso de venta
 * a un tercero, sin métricas de campaña, sin facturación. Cuando de
 * verdad se venda espacio a una marca externa, eso pasa a
 * campanasPublicitarias arriba (que sí tiene todo ese aparato) — este
 * banner simple no debe crecer hacia ese sistema, son cosas distintas
 * a propósito.
 */
export const bannersPropios = pgTable(
  'banners_propios',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    titulo: varchar('titulo', { length: 100 }).notNull(),
    imagenUrl: text('imagen_url').notNull(),
    enlaceUrl: text('enlace_url').notNull(),
    activo: boolean('activo').default(true).notNull(),
    orden: integer('orden').default(0).notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_banners_propios_activo').on(t.activo)],
);

