/**
 * Flota flexible — RF-FLOTA, RF-COOP-003, RF-SEAT-001/002.
 */
import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  timestamp,
  boolean,
  index,
  pgPolicy,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { cooperativas } from './tenancy';
import { appRole, platformAdminRole, filtroCooperativaActual } from './rls';
import { categoriaVehiculoEnum, amenidadEnum } from './enums';

/**
 * RF-FLOTA-001 — catálogo extensible de tipos de vehículo por cooperativa
 * (bus estándar, buseta, doble piso, van, automóvil, o cualquier otro que
 * la cooperativa quiera dar de alta), cada uno con su propia distribución
 * de asientos, sin tocar código ni requerir despliegue.
 *
 * `distribucionAsientos` guarda la configuración completa del mapa de
 * asientos como JSONB (Arquitectura Técnica 4.1: "columnas JSONB —
 * configuración flexible de distribución de asientos por tipo de
 * vehículo"). No se modela como tabla relacional fila-por-asiento aquí
 * porque el layout (filas, columnas, pasillos, pisos, categorías) varía
 * demasiado entre tipos de vehículo para un esquema relacional fijo, y
 * este documento no impone una forma específica de JSON — eso se define
 * en el contrato de tipos compartido (packages/types del monorepo) y se
 * valida en la capa de aplicación, no en la base de datos.
 */
export const tiposVehiculo = pgTable(
  'tipos_vehiculo',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),

    nombre: varchar('nombre', { length: 100 }).notNull(), // ej. "Doble piso VIP", "Van 15 puestos"

    // Categoría estructurada (29-jul-2026) — separada del nombre libre.
    // Nullable a propósito: los tipos de vehículo creados antes de hoy
    // no tienen categoría, y no se debe asumir "bus" en silencio para
    // ellos — el frontend debe tratar null como "sin categorizar".
    categoria: categoriaVehiculoEnum('categoria'),

    capacidadTotal: integer('capacidad_total').notNull(),
    distribucionAsientos: jsonb('distribucion_asientos').notNull(),

    // Ítem 11, Fase 2 (04-ago-2026) -- amenidades del vehículo, visibles
    // en los resultados de búsqueda antes de que el pasajero elija.
    // Array del catálogo cerrado (no notNull-vacío por accidente:
    // .default([]) cubre los tipos de vehículo creados antes de hoy).
    amenidades: amenidadEnum('amenidades').array().default([]).notNull(),

    activo: boolean('activo').default(true).notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_tipos_vehiculo_cooperativa').on(t.cooperativaId),
    pgPolicy('aislamiento_cooperativa_tipos_vehiculo', {
      for: 'all',
      to: [appRole, platformAdminRole],
      using: filtroCooperativaActual,
      withCheck: filtroCooperativaActual,
    }),
  ],
).enableRLS();

/**
 * RF-COOP-003 — unidades físicas que opera una cooperativa.
 * RF-FLOTA-002 — identificador operativo de unidad (el "disco"/turno del
 * terminal físico). Se modela como campo genérico `identificadorOperativo`
 * a propósito: el término exacto ("disco" según lo señalado por el
 * usuario) no se pudo confirmar en fuentes públicas como estándar
 * documentado — queda pendiente de validación con una cooperativa real
 * durante el piloto (ver SRS 3.12, nota de decisión pendiente). El campo y
 * su función quedan definidos independientemente del nombre que termine
 * usándose.
 */
export const unidades = pgTable(
  'unidades',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),
    tipoVehiculoId: uuid('tipo_vehiculo_id')
      .references(() => tiposVehiculo.id)
      .notNull(),

    placa: varchar('placa', { length: 15 }).notNull(),

    // RF-FLOTA-002 — ver nota de la tabla arriba.
    identificadorOperativo: varchar('identificador_operativo', { length: 30 }).notNull(),

    activo: boolean('activo').default(true).notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_unidades_cooperativa').on(t.cooperativaId),
    index('idx_unidades_tipo_vehiculo').on(t.tipoVehiculoId),
    pgPolicy('aislamiento_cooperativa_unidades', {
      for: 'all',
      to: [appRole, platformAdminRole],
      using: filtroCooperativaActual,
      withCheck: filtroCooperativaActual,
    }),
  ],
).enableRLS();

export const tiposVehiculoRelations = relations(tiposVehiculo, ({ one, many }) => ({
  cooperativa: one(cooperativas, {
    fields: [tiposVehiculo.cooperativaId],
    references: [cooperativas.id],
  }),
  unidades: many(unidades),
}));

export const unidadesRelations = relations(unidades, ({ one }) => ({
  cooperativa: one(cooperativas, {
    fields: [unidades.cooperativaId],
    references: [cooperativas.id],
  }),
  tipoVehiculo: one(tiposVehiculo, {
    fields: [unidades.tipoVehiculoId],
    references: [tiposVehiculo.id],
  }),
}));

/**
 * Conductores — módulo NUEVO, ausente del SRS v1.2 original (ninguna
 * sección lo cubre). Se agrega a pedido explícito del director del
 * proyecto tras identificar que una cooperativa real necesita registrar
 * conductores junto con su flota — un vacío real de la especificación
 * original, no un descuido de esta capa de infraestructura.
 *
 * Deliberadamente simple para este alcance inicial: no es una cuenta de
 * usuario (un conductor no inicia sesión en el sistema en esta fase), es
 * un registro operativo/de cumplimiento que se asigna a un viaje
 * concreto (ver `viajes.conductorId` en rutas.ts). Si más adelante se
 * necesita que el conductor use una app propia (ej. confirmar su turno,
 * ver su ruta del día), esto se puede extender agregando una fila en
 * `usuarios` vinculada, sin romper este diseño.
 */
export const conductores = pgTable(
  'conductores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),

    nombreCompleto: varchar('nombre_completo', { length: 200 }).notNull(),
    cedula: varchar('cedula', { length: 20 }).notNull(),

    // Campos relevantes para cumplimiento ANT/LOTTTSV — no verificados
    // automáticamente contra ningún registro externo en esta fase, solo
    // capturados como dato operativo de la cooperativa.
    licenciaNumero: varchar('licencia_numero', { length: 30 }),
    licenciaCategoria: varchar('licencia_categoria', { length: 10 }), // ej. 'E1' para transporte de pasajeros

    telefono: varchar('telefono', { length: 20 }),
    activo: boolean('activo').default(true).notNull(),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_conductores_cooperativa').on(t.cooperativaId),
    pgPolicy('aislamiento_cooperativa_conductores', {
      for: 'all',
      to: [appRole, platformAdminRole],
      using: filtroCooperativaActual,
      withCheck: filtroCooperativaActual,
    }),
  ],
).enableRLS();

export const conductoresRelations = relations(conductores, ({ one }) => ({
  cooperativa: one(cooperativas, { fields: [conductores.cooperativaId], references: [cooperativas.id] }),
}));

