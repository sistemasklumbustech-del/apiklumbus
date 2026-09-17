/**
 * Versionado de Términos y Condiciones — RF-024.
 *
 * `terminosCondiciones` es insert-only: publicar una versión nueva es
 * un INSERT, nunca un UPDATE sobre la anterior. La versión "vigente" en
 * un momento dado no se marca con una columna booleana (que habría que
 * mover de una fila a otra cada vez que se publica una nueva versión) —
 * se calcula: es la fila con `vigenteDesde` más reciente que ya haya
 * pasado (`vigenteDesde <= now()`). Esto evita un UPDATE innecesario y
 * de paso deja cada versión con su propia fecha de vigencia trazable.
 *
 * `terminosAceptaciones` registra quién aceptó qué versión y cuándo.
 * Puede ser una cuenta real (`usuarioId`, al registrarse) o una compra
 * de invitado sin cuenta (`compraId`, al pagar) — nunca ambos vacíos a
 * la vez (ver el CHECK abajo). Es insert-only por el mismo motivo que
 * auditoria_admin y compras_transiciones: un registro de aceptación
 * legal que se puede editar o borrar no sirve como evidencia de nada.
 * Ver migrations/manual/007_terminos_aceptaciones_inmutable.sql para el
 * REVOKE UPDATE/DELETE a nivel de Postgres.
 *
 * Decisión de alcance (17-sep-2026): publicar una versión nueva NO
 * fuerza a los usuarios existentes a re-aceptar en su próximo login —
 * solo se registra hacia adelante, en cada cuenta nueva y cada compra
 * de invitado nueva.
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { usuarios } from './usuarios';
import { compras } from './ventas';

export const terminosCondiciones = pgTable(
  'terminos_condiciones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    version: varchar('version', { length: 20 }).notNull().unique(),
    contenido: text('contenido').notNull(),
    vigenteDesde: timestamp('vigente_desde', { withTimezone: true }).notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_terminos_condiciones_vigente_desde').on(t.vigenteDesde)],
);

export const terminosAceptaciones = pgTable(
  'terminos_aceptaciones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    terminosVersionId: uuid('terminos_version_id')
      .references(() => terminosCondiciones.id)
      .notNull(),
    usuarioId: uuid('usuario_id').references(() => usuarios.id),
    compraId: uuid('compra_id').references(() => compras.id),
    direccionIp: varchar('direccion_ip', { length: 45 }),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_terminos_aceptaciones_usuario').on(t.usuarioId),
    index('idx_terminos_aceptaciones_compra').on(t.compraId),
    index('idx_terminos_aceptaciones_version').on(t.terminosVersionId),
    check(
      'chk_terminos_aceptacion_actor',
      sql`${t.usuarioId} IS NOT NULL OR ${t.compraId} IS NOT NULL`,
    ),
  ],
);

export const terminosAceptacionesRelations = relations(terminosAceptaciones, ({ one }) => ({
  version: one(terminosCondiciones, {
    fields: [terminosAceptaciones.terminosVersionId],
    references: [terminosCondiciones.id],
  }),
  usuario: one(usuarios, {
    fields: [terminosAceptaciones.usuarioId],
    references: [usuarios.id],
  }),
  compra: one(compras, {
    fields: [terminosAceptaciones.compraId],
    references: [compras.id],
  }),
}));
