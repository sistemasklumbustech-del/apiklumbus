/**
 * Calificaciones de viaje — RF nuevo, definido el 22-jul-2026.
 *
 * Se califica el VIAJE (a través del boleto), no la plataforma en
 * general — eso le da valor real a otro pasajero antes de comprar
 * ("esta cooperativa tiene 4.5 estrellas en esta ruta"), a diferencia
 * de retroalimentación genérica sobre la plataforma, que sería para
 * uso interno y no está en este alcance.
 *
 * Una calificación por boleto (uq_calificaciones_boleto): solo quien
 * de verdad compró ese boleto puede calificarlo, y solo una vez — la
 * validación de que el boleto le pertenece al usuario que califica
 * vive en la capa de aplicación (CalificacionesService), no aquí.
 */
import { pgTable, uuid, smallint, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { boletos } from './ventas';
import { cooperativas } from './tenancy';
import { usuarios } from './usuarios';

export const calificaciones = pgTable(
  'calificaciones',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    boletoId: uuid('boleto_id')
      .references(() => boletos.id)
      .notNull(),

    // Denormalizado desde el boleto a propósito — igual que
    // boletos.cooperativaId — para poder calcular el promedio por
    // cooperativa (RF-BUS, mostrado en resultados de búsqueda) sin
    // tener que pasar por boletos -> compras -> etc. en cada consulta
    // pública, que corre en el camino caliente de búsqueda.
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),

    pasajeroUsuarioId: uuid('pasajero_usuario_id')
      .references(() => usuarios.id)
      .notNull(),

    puntuacion: smallint('puntuacion').notNull(), // 1 a 5 — validado en la capa de aplicación, no aquí
    comentario: text('comentario'),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_calificaciones_boleto').on(t.boletoId),
    index('idx_calificaciones_cooperativa').on(t.cooperativaId),
  ],
);

export const calificacionesRelations = relations(calificaciones, ({ one }) => ({
  boleto: one(boletos, { fields: [calificaciones.boletoId], references: [boletos.id] }),
  cooperativa: one(cooperativas, {
    fields: [calificaciones.cooperativaId],
    references: [cooperativas.id],
  }),
  pasajero: one(usuarios, {
    fields: [calificaciones.pasajeroUsuarioId],
    references: [usuarios.id],
  }),
}));
