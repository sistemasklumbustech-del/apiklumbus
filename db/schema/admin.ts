/**
 * Auditoría de operaciones administrativas — RF-ADMIN-005.
 *
 * Criterio de aceptación exacto: "sin posibilidad de edición retroactiva
 * del registro". Esta tabla no tiene columna `actualizadoEn` a propósito
 * — no está pensada para actualizarse nunca, solo insertarse. Modelar la
 * inmutabilidad en el esquema (sin UPDATE) es necesario pero no
 * suficiente: además hace falta revocar el privilegio UPDATE/DELETE sobre
 * esta tabla para el rol `ticketya_app` a nivel de Postgres (ver
 * migrations/manual/003_auditoria_inmutable.sql), porque un esquema sin
 * columna de actualización no impide técnicamente un UPDATE de todas
 * formas — solo la convención de código. RLS + falta de privilegio SQL sí
 * lo impide de verdad.
 */
import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { usuarios } from './usuarios';
import { accionAuditoriaEnum } from './enums';

export const auditoriaAdmin = pgTable(
  'auditoria_admin',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    accion: accionAuditoriaEnum('accion').notNull(),
    usuarioId: uuid('usuario_id')
      .references(() => usuarios.id)
      .notNull(),

    // Referencia genérica polimórfica (ej. entidadTipo='cooperativa',
    // entidadId=<uuid de esa cooperativa>). Se opta por esto en vez de
    // una FK tipada por cada posible entidad auditable, porque el listado
    // de qué se audita seguirá creciendo (RF-ADMIN-005 ya cubre
    // aprobaciones, comisiones y bajas; es razonable esperar más
    // categorías) y no vale la pena una tabla de auditoría separada por
    // cada una.
    entidadTipo: varchar('entidad_tipo', { length: 50 }).notNull(),
    entidadId: uuid('entidad_id').notNull(),

    // Snapshot de qué cambió (ej. { antes: {...}, despues: {...} }) —
    // suficientemente flexible para no rediseñar el esquema cada vez que
    // se audita un nuevo tipo de cambio.
    detalle: jsonb('detalle'),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_auditoria_admin_usuario').on(t.usuarioId),
    index('idx_auditoria_admin_entidad').on(t.entidadTipo, t.entidadId),
    index('idx_auditoria_admin_accion').on(t.accion),
  ],
);

export const auditoriaAdminRelations = relations(auditoriaAdmin, ({ one }) => ({
  usuario: one(usuarios, { fields: [auditoriaAdmin.usuarioId], references: [usuarios.id] }),
}));
