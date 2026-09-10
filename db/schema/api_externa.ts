/**
 * Integración API — cooperativas Modelo B (RF-API).
 */
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  jsonb,
  integer,
  timestamp,
  text,
  index,
  uniqueIndex,
  pgPolicy,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { cooperativas } from './tenancy';
import { compras } from './ventas';
import { estadoReservaApiEnum } from './enums';
import { appRole, platformAdminRole, filtroCooperativaActual } from './rls';

/**
 * RF-API-001 — autenticación de sistemas externos con alcance limitado a
 * sus propios datos. El secreto real (API key / client secret) nunca se
 * guarda en texto plano — solo su hash, siguiendo el mismo principio que
 * RNF-SEG-002 aplica a contraseñas de usuario.
 *
 * 02-ago-2026 -- 2 correcciones de esquema (hallazgo real, antes de
 * construir el service/controller encima):
 * 1) `webhookUrl` -- faltaba el destino al que avisar la venta. Sin esto,
 *    el mecanismo de webhooks no tiene a dónde disparar.
 * 2) `apiKeyPrefix` -- un hash por sí solo no se puede *buscar*, solo
 *    *verificar* una vez que ya sabes cuál credencial es. Patrón real de
 *    Stripe/GitHub: se guarda un prefijo público en texto plano (ej.
 *    `tkya_live_a1b2c3`) para el lookup rápido; el resto de la llave
 *    sigue hasheado en apiKeyHash. Único por llave -- por eso lleva su
 *    propio índice unique, no basta con el índice por cooperativa.
 */
export const credencialesApi = pgTable(
  'credenciales_api',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),

    tipo: varchar('tipo', { length: 20 }).notNull(), // 'api_key' | 'oauth2_client'
    apiKeyPrefix: varchar('api_key_prefix', { length: 20 }),
    apiKeyHash: varchar('api_key_hash', { length: 255 }),
    oauthClientId: varchar('oauth_client_id', { length: 100 }),
    oauthClientSecretHash: varchar('oauth_client_secret_hash', { length: 255 }),

    // 02-ago-2026 -- destino del webhook (RF-API-003). Sin este campo no
    // hay a dónde enviar el aviso de venta.
    webhookUrl: text('webhook_url'),

    activo: boolean('activo').default(true).notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    revocadoEn: timestamp('revocado_en', { withTimezone: true }),
  },
  (t) => [
    index('idx_credenciales_api_cooperativa').on(t.cooperativaId),
    uniqueIndex('uq_credenciales_api_prefix').on(t.apiKeyPrefix),
    pgPolicy('aislamiento_cooperativa_credenciales_api', {
      for: 'all',
      to: [appRole, platformAdminRole],
      using: filtroCooperativaActual,
      withCheck: filtroCooperativaActual,
    }),
  ],
).enableRLS();

/**
 * RF-API-003 — notificación de venta en tiempo real (webhook), con
 * reintento automático si el sistema externo no confirma recepción, "sin
 * perder el evento de venta" (criterio de aceptación exacto). Por eso se
 * persiste como cola con `intentos`/`estadoEntrega`, no como un fetch()
 * de una sola vez sin registro.
 */
export const webhooksLog = pgTable(
  'webhooks_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),
    compraId: uuid('compra_id')
      .references(() => compras.id)
      .notNull(),

    evento: varchar('evento', { length: 50 }).notNull(), // ej. 'venta_creada'
    payload: jsonb('payload').notNull(),

    intentos: integer('intentos').default(0).notNull(),
    estadoEntrega: varchar('estado_entrega', { length: 20 }).default('pendiente').notNull(), // 'pendiente' | 'confirmado' | 'fallido'
    ultimoIntentoEn: timestamp('ultimo_intento_en', { withTimezone: true }),
    ultimaRespuesta: text('ultima_respuesta'),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_webhooks_log_cooperativa').on(t.cooperativaId),
    index('idx_webhooks_log_estado').on(t.estadoEntrega),
    pgPolicy('aislamiento_cooperativa_webhooks_log', {
      for: 'all',
      to: [appRole, platformAdminRole],
      using: filtroCooperativaActual,
      withCheck: filtroCooperativaActual,
    }),
  ],
).enableRLS();

/**
 * RF-API-004 — confirmación o reversa de reserva. Modelo B introduce una
 * ventana donde TicketYa ya procesó la venta pero el sistema propio de la
 * cooperativa aún no la confirmó contra su inventario; esta tabla existe
 * para que esa ventana tenga un estado explícito y consultable, en vez de
 * asumir siempre éxito.
 */
export const reservasApiExternas = pgTable(
  'reservas_api_externas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    compraId: uuid('compra_id')
      .references(() => compras.id)
      .notNull(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),

    estado: estadoReservaApiEnum('estado').default('confirmada').notNull(),
    motivoReversa: text('motivo_reversa'),
    respondidoEn: timestamp('respondido_en', { withTimezone: true }),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_reservas_api_externas_compra').on(t.compraId),
    index('idx_reservas_api_externas_cooperativa').on(t.cooperativaId),
    pgPolicy('aislamiento_cooperativa_reservas_api_externas', {
      for: 'all',
      to: [appRole, platformAdminRole],
      using: filtroCooperativaActual,
      withCheck: filtroCooperativaActual,
    }),
  ],
).enableRLS();

export const credencialesApiRelations = relations(credencialesApi, ({ one }) => ({
  cooperativa: one(cooperativas, { fields: [credencialesApi.cooperativaId], references: [cooperativas.id] }),
}));

export const webhooksLogRelations = relations(webhooksLog, ({ one }) => ({
  cooperativa: one(cooperativas, { fields: [webhooksLog.cooperativaId], references: [cooperativas.id] }),
  compra: one(compras, { fields: [webhooksLog.compraId], references: [compras.id] }),
}));

export const reservasApiExternasRelations = relations(reservasApiExternas, ({ one }) => ({
  cooperativa: one(cooperativas, {
    fields: [reservasApiExternas.cooperativaId],
    references: [cooperativas.id],
  }),
  compra: one(compras, { fields: [reservasApiExternas.compraId], references: [compras.id] }),
}));
