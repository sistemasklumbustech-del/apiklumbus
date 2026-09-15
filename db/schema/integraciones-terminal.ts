/**
 * Integración con el sistema de tasas del Terminal (SIAT3000 / Derpacif).
 *
 * Diseño según CONTEXT.md sección 5.3 y el Requerimiento Funcional TTM
 * (RF-016, sección 8 "Modelo de USUARIO_TTM y autorización de
 * cooperativas"). Recreado a partir de esas dos fuentes — el archivo
 * original se diseñó en una conversación previa pero nunca se guardó en
 * el repo.
 *
 * Nunca se guarda el secreto real de autenticación en estas tablas —
 * solo una referencia (`secretoRef`, ej. la clave de un vault externo),
 * porque el mecanismo real de autenticación de SIAT3000 todavía no está
 * confirmado por Derpacif (Fase 0, bloqueada — CONTEXT.md sección 5.4).
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  pgPolicy,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { cooperativas, puntosOperacion } from './tenancy';
import { compras } from './ventas';
import {
  modoIntegracionTerminalEnum,
  tipoEntidadTerminalEnum,
  estadoRegistroTasaEnum,
} from './enums';
import { appRole, platformAdminRole, filtroCooperativaActual } from './rls';

/**
 * Una fila por terminal físico (RF-016) — el `puntoOperacionId` referencia
 * el `puntos_operacion` con tipo 'terminal_terrestre'. Sin RLS a propósito:
 * es infraestructura compartida por todas las cooperativas que operan
 * desde ese terminal, igual que `puntos_operacion` mismo — la administra
 * el Administrador TIC de plataforma, no cada cooperativa.
 *
 * `sucursalSiat` y `puntoVentaSiat` son códigos del terminal físico ante
 * SIAT3000 (no de cada cooperativa — el RUC de cooperativa ya vive en
 * `cooperativas.ruc` y se envía aparte en cada llamada). El manual de
 * Derpacif (diccionario de datos) es inconsistente sobre la longitud real
 * de "punto": lo describe como "sucursal SRI 3 dígitos" pero en
 * `setVentaPasaje` la longitud declarada es 10 — columna dimensionada al
 * mayor hasta que Derpacif confirme (pregunta pendiente, CONTEXT.md
 * sección 7.1).
 */
export const credencialesIntegracionTerminal = pgTable(
  'credenciales_integracion_terminal',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    puntoOperacionId: uuid('punto_operacion_id')
      .references(() => puntosOperacion.id)
      .notNull(),

    proveedorSiat: varchar('proveedor_siat', { length: 3 }).notNull(),
    sucursalSiat: varchar('sucursal_siat', { length: 3 }).notNull(),
    puntoVentaSiat: varchar('punto_venta_siat', { length: 10 }),

    modo: modoIntegracionTerminalEnum('modo').notNull(),

    // Vigencia del WSDL sin confirmar (diseño 2015, última actualización
    // 14/05/2018) — se guarda igual porque hace falta un valor de
    // configuración, pero no se debe asumir que sigue siendo el correcto
    // sin la certificación de Fase 0.
    wsdlUrl: text('wsdl_url').notNull(),
    ambiente: varchar('ambiente', { length: 20 }).default('certificacion').notNull(), // 'certificacion' | 'produccion'

    // Modo A (USUARIO_TTM_UNICO) — solo aplica cuando modo = 'unico'.
    // En modo 'por_cooperativa' estos dos campos quedan NULL y el nick
    // real vive en credenciales_terminal_por_cooperativa.
    usuarioTtmUnico: varchar('usuario_ttm_unico', { length: 20 }),
    secretoRefUnico: varchar('secreto_ref_unico', { length: 200 }),

    activo: boolean('activo').default(true).notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_credenciales_integracion_terminal_punto').on(t.puntoOperacionId),
  ],
);

/**
 * Modo B (USUARIO_TTM_POR_COOPERATIVA) — solo existen filas acá cuando la
 * credencial del terminal tiene modo = 'por_cooperativa'; cada RUC de
 * cooperativa usa el nick que SIAT3000 tenga registrado para esa empresa
 * (RF-016). Con RLS: una cooperativa nunca debe poder leer el nick/secreto
 * de otra, aunque el Administrador TIC de plataforma sí ve todas.
 */
export const credencialesTerminalPorCooperativa = pgTable(
  'credenciales_terminal_por_cooperativa',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    credencialIntegracionId: uuid('credencial_integracion_id')
      .references(() => credencialesIntegracionTerminal.id)
      .notNull(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),

    usuarioTtm: varchar('usuario_ttm', { length: 20 }).notNull(),
    secretoRef: varchar('secreto_ref', { length: 200 }).notNull(),

    activo: boolean('activo').default(true).notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_credenciales_terminal_por_cooperativa').on(
      t.credencialIntegracionId,
      t.cooperativaId,
    ),
    index('idx_credenciales_terminal_por_cooperativa_coop').on(t.cooperativaId),
    pgPolicy('aislamiento_cooperativa_credenciales_terminal', {
      for: 'all',
      to: [appRole, platformAdminRole],
      using: filtroCooperativaActual,
      withCheck: filtroCooperativaActual,
    }),
  ],
).enableRLS();

/**
 * Traduce IDs locales ↔ IDs que devuelve SIAT3000 para bus/ruta/destino de
 * ruta/frecuencia/viaje (`getBus`, `getRuta`, `getDestinoRuta`,
 * `getFrecuenciaRuta`, `setCrearViaje` del manual Derpacif). `entidadLocalId`
 * es deliberadamente polimórfico sin FK formal (mismo patrón ya usado en
 * el proyecto para referencias de auditoría, ver CONTEXT.md "Relaciones
 * inversas") — el tipo real depende de `tipoEntidad`.
 */
export const mapeoEntidadesTerminal = pgTable(
  'mapeo_entidades_terminal',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),

    tipoEntidad: tipoEntidadTerminalEnum('tipo_entidad').notNull(),
    entidadLocalId: uuid('entidad_local_id').notNull(),
    codigoTerminal: varchar('codigo_terminal', { length: 20 }).notNull(),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_mapeo_entidades_terminal_local').on(
      t.cooperativaId,
      t.tipoEntidad,
      t.entidadLocalId,
    ),
    index('idx_mapeo_entidades_terminal_codigo').on(
      t.cooperativaId,
      t.tipoEntidad,
      t.codigoTerminal,
    ),
    pgPolicy('aislamiento_cooperativa_mapeo_entidades_terminal', {
      for: 'all',
      to: [appRole, platformAdminRole],
      using: filtroCooperativaActual,
      withCheck: filtroCooperativaActual,
    }),
  ],
).enableRLS();

/**
 * Auditoría + idempotencia de cada llamada real a `setVentaPasaje` — acá
 * vive el código de tasa de 20 dígitos que se convierte en QR (RF-010).
 * Una fila por compra (RN-004: una orden no genera más de una tasa salvo
 * reemisión controlada). `claveIdempotencia` es la defensa real contra
 * RN-005/RN-007: ante timeout de SIAT3000 la aplicación reconsulta esta
 * fila por su clave antes de reintentar, en vez de asumir éxito o repetir
 * la venta a ciegas.
 *
 * `solicitudPayload`/`respuestaPayload` no deben contener el secreto de
 * autenticación (RF-021, "logs... sin almacenar secretos") — solo los
 * parámetros de negocio enviados (detalle de asientos/tarifas) y la
 * respuesta cruda de SIAT3000 para poder auditar una venta específica.
 */
export const registrosTasaTerminal = pgTable(
  'registros_tasa_terminal',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),
    compraId: uuid('compra_id')
      .references(() => compras.id)
      .notNull(),

    claveIdempotencia: varchar('clave_idempotencia', { length: 100 }).notNull(),
    estado: estadoRegistroTasaEnum('estado').default('pendiente').notNull(),

    // Código de 20 dígitos retornado por SIAT3000, NULL hasta que la
    // llamada tenga éxito (estado = 'exitosa').
    codigoTasa: varchar('codigo_tasa', { length: 20 }),
    mensajeTerminal: text('mensaje_terminal'),
    saldoReportado: numeric('saldo_reportado', { precision: 10, scale: 2 }),

    solicitudPayload: jsonb('solicitud_payload').notNull(),
    respuestaPayload: jsonb('respuesta_payload'),

    intentos: integer('intentos').default(0).notNull(),
    ultimoIntentoEn: timestamp('ultimo_intento_en', { withTimezone: true }),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_registros_tasa_terminal_compra').on(t.compraId),
    uniqueIndex('uq_registros_tasa_terminal_idempotencia').on(t.claveIdempotencia),
    index('idx_registros_tasa_terminal_cooperativa').on(t.cooperativaId),
    index('idx_registros_tasa_terminal_estado').on(t.estado),
    pgPolicy('aislamiento_cooperativa_registros_tasa_terminal', {
      for: 'all',
      to: [appRole, platformAdminRole],
      using: filtroCooperativaActual,
      withCheck: filtroCooperativaActual,
    }),
  ],
).enableRLS();

export const credencialesIntegracionTerminalRelations = relations(
  credencialesIntegracionTerminal,
  ({ one, many }) => ({
    puntoOperacion: one(puntosOperacion, {
      fields: [credencialesIntegracionTerminal.puntoOperacionId],
      references: [puntosOperacion.id],
    }),
    credencialesPorCooperativa: many(credencialesTerminalPorCooperativa),
  }),
);

export const credencialesTerminalPorCooperativaRelations = relations(
  credencialesTerminalPorCooperativa,
  ({ one }) => ({
    credencialIntegracion: one(credencialesIntegracionTerminal, {
      fields: [credencialesTerminalPorCooperativa.credencialIntegracionId],
      references: [credencialesIntegracionTerminal.id],
    }),
    cooperativa: one(cooperativas, {
      fields: [credencialesTerminalPorCooperativa.cooperativaId],
      references: [cooperativas.id],
    }),
  }),
);

export const mapeoEntidadesTerminalRelations = relations(mapeoEntidadesTerminal, ({ one }) => ({
  cooperativa: one(cooperativas, {
    fields: [mapeoEntidadesTerminal.cooperativaId],
    references: [cooperativas.id],
  }),
}));

export const registrosTasaTerminalRelations = relations(registrosTasaTerminal, ({ one }) => ({
  cooperativa: one(cooperativas, {
    fields: [registrosTasaTerminal.cooperativaId],
    references: [cooperativas.id],
  }),
  compra: one(compras, {
    fields: [registrosTasaTerminal.compraId],
    references: [compras.id],
  }),
}));
