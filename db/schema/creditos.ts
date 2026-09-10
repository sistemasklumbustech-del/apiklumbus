/**
 * Créditos de reprogramación — Fase C (28-jul-2026).
 *
 * Modelo confirmado con el usuario, verificado contra prácticas reales
 * de la industria (Flixbus, Peter Pan, OurBus): al reprogramar un
 * boleto por uno más barato, el excedente se convierte en crédito
 * interno — nunca reembolso en efectivo (hoy no hay pasarela de pago
 * real conectada, así que "efectivo" no existe todavía de todas
 * formas). El crédito solo es válido dentro de la MISMA cooperativa que
 * lo generó (confirmado por el usuario) y se usa completo en una sola
 * compra futura (no hay manejo de saldo parcial en esta primera
 * entrega).
 *
 * ⚠ Este archivo define la base (dónde vive el crédito). El flujo que
 * realmente lo GENERA (reprogramar un boleto) es una pieza separada,
 * deliberadamente no incluida en esta entrega — ver nota en
 * ESTADO_Y_RUTA.md / plan de corrección, 28-jul-2026.
 */
import { pgTable, uuid, numeric, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { usuarios } from './usuarios';
import { cooperativas } from './tenancy';
import { boletos } from './ventas';

export const creditosPasajero = pgTable(
  'creditos_pasajero',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    usuarioId: uuid('usuario_id')
      .references(() => usuarios.id)
      .notNull(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),

    monto: numeric('monto', { precision: 8, scale: 2 }).notNull(),

    // El boleto cancelado que generó este crédito — trazabilidad, para
    // poder responder "¿de dónde salió este saldo?" sin ambigüedad.
    boletoOrigenId: uuid('boleto_origen_id').references(() => boletos.id),

    // El boleto nuevo donde se consumió el crédito, si ya se usó.
    // Nullable: un crédito sin usar tiene esto en null.
    boletoUsadoId: uuid('boleto_usado_id').references(() => boletos.id),
    usadoEn: timestamp('usado_en', { withTimezone: true }),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_creditos_pasajero_usuario').on(t.usuarioId),
    index('idx_creditos_pasajero_cooperativa').on(t.cooperativaId),
  ],
);

export const creditosPasajeroRelations = relations(creditosPasajero, ({ one }) => ({
  usuario: one(usuarios, { fields: [creditosPasajero.usuarioId], references: [usuarios.id] }),
  cooperativa: one(cooperativas, {
    fields: [creditosPasajero.cooperativaId],
    references: [cooperativas.id],
  }),
  boletoOrigen: one(boletos, {
    fields: [creditosPasajero.boletoOrigenId],
    references: [boletos.id],
  }),
}));
