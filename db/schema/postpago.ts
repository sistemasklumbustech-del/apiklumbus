/**
 * Tareas posteriores al pago (06-oct-2026) -- ver la migración 0059 para el
 * porqué. Una fila por paso pendiente de una compra ya cobrada: factura del
 * pasaje de cada cooperativa, registro de la tasa en el SIAT 3000 y factura
 * del cargo de servicio de la plataforma.
 */
import { pgTable, pgEnum, uuid, integer, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { compras } from './ventas';
import { cooperativas } from './tenancy';

export const tipoTareaPostpagoEnum = pgEnum('tipo_tarea_postpago', [
  'factura_pasaje',
  'registro_tasa',
  'factura_plataforma',
  // El sistema de la cooperativa debe reportar la factura y el código de tasa de la venta.
  'confirmacion_cooperativa',
]);

export const estadoTareaPostpagoEnum = pgEnum('estado_tarea_postpago', [
  'pendiente',
  'en_proceso',
  'exitosa',
  'agotada',
]);

export const tareasPostpago = pgTable(
  'tareas_postpago',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    compraId: uuid('compra_id')
      .references(() => compras.id)
      .notNull(),
    // NULL en las tareas de la plataforma (factura del cargo de servicio).
    cooperativaId: uuid('cooperativa_id').references(() => cooperativas.id),
    tipo: tipoTareaPostpagoEnum('tipo').notNull(),
    estado: estadoTareaPostpagoEnum('estado').default('pendiente').notNull(),
    intentos: integer('intentos').default(0).notNull(),
    maxIntentos: integer('max_intentos').default(6).notNull(),
    proximoIntentoEn: timestamp('proximo_intento_en', { withTimezone: true }).defaultNow().notNull(),
    // Si un worker se cae a mitad de una tarea, vuelve a estar disponible al vencer esto.
    bloqueadaHasta: timestamp('bloqueada_hasta', { withTimezone: true }),
    ultimoError: text('ultimo_error'),
    resultado: jsonb('resultado'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
    completadoEn: timestamp('completado_en', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_tareas_postpago_cooperativa')
      .on(t.compraId, t.cooperativaId, t.tipo)
      .where(sql`${t.cooperativaId} IS NOT NULL`),
    uniqueIndex('uq_tareas_postpago_plataforma')
      .on(t.compraId, t.tipo)
      .where(sql`${t.cooperativaId} IS NULL`),
    index('idx_tareas_postpago_pendientes').on(t.estado, t.proximoIntentoEn),
    index('idx_tareas_postpago_compra').on(t.compraId),
  ],
);

export const tareasPostpagoRelations = relations(tareasPostpago, ({ one }) => ({
  compra: one(compras, { fields: [tareasPostpago.compraId], references: [compras.id] }),
  cooperativa: one(cooperativas, { fields: [tareasPostpago.cooperativaId], references: [cooperativas.id] }),
}));
