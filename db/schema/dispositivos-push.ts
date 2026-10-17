/**
 * Dispositivos para notificaciones push de la app móvil (oct-2026).
 *
 * Cada fila es un teléfono donde una persona con cuenta inició sesión en la app y aceptó recibir
 * avisos. El token es el de Expo (`ExponentPushToken[...]`). Es único: si el mismo teléfono inicia
 * sesión con otra cuenta, la fila pasa a esa cuenta (un token solo avisa a una persona). Un token
 * que Expo reporta como inválido se marca `activo = false` y deja de usarse.
 */
import { pgTable, uuid, varchar, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { usuarios } from './usuarios';

export const dispositivosPush = pgTable(
  'dispositivos_push',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    usuarioId: uuid('usuario_id')
      .references(() => usuarios.id, { onDelete: 'cascade' })
      .notNull(),
    token: varchar('token', { length: 200 }).notNull(),
    plataforma: varchar('plataforma', { length: 10 }).notNull(), // 'android' | 'ios'
    activo: boolean('activo').default(true).notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_dispositivos_push_token').on(t.token),
    index('idx_dispositivos_push_usuario').on(t.usuarioId),
  ],
);

export const dispositivosPushRelations = relations(dispositivosPush, ({ one }) => ({
  usuario: one(usuarios, { fields: [dispositivosPush.usuarioId], references: [usuarios.id] }),
}));
