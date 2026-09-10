/**
 * Programa de referidos "Invita y Gana" (13-ago-2026). Diseño
 * investigado contra ClickBus ("Indique e Ganhe"): el amigo referido
 * recibe descuento en su primera compra; quien refiere gana un
 * crédito solo después de que el amigo REALMENTE viaja (boleto
 * validado en la terminal) -- mismo patrón anti-fraude que el
 * cashback, evita referir + cobrar + que el amigo cancele.
 *
 * Reutiliza el wallet ya construido -- el crédito de quien refiere es
 * un movimiento más en `wallet_movimientos` (tipo 'credito_referido'),
 * esta tabla NO es un saldo, solo la relación quién-refirió-a-quién y
 * el estado de los 2 disparadores (descuento del referido, crédito
 * del referidor).
 */
import { pgTable, uuid, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { usuarios } from './usuarios';
import { boletos } from './ventas';

export const referidos = pgTable(
  'referidos',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    usuarioReferidorId: uuid('usuario_referidor_id')
      .references(() => usuarios.id)
      .notNull(),

    // Único a propósito -- una persona solo puede haber sido referida
    // una vez, por un solo referidor. Se decide en el registro, no se
    // puede agregar un referidor después.
    usuarioReferidoId: uuid('usuario_referido_id')
      .references(() => usuarios.id)
      .notNull(),

    // Disparador del CRÉDITO DEL REFERIDOR -- nulo hasta que el
    // primer boleto real del referido se valida en la terminal. Una
    // vez que tiene valor, nunca se vuelve a disparar para esta
    // relación (aunque el amigo viaje 10 veces más).
    boletoQueDisparoCreditoId: uuid('boleto_que_disparo_credito_id').references(
      () => boletos.id,
    ),

    // Disparador del DESCUENTO DEL REFERIDO -- columna agregada más
    // allá del esquema pedido explícitamente, porque sin ella el
    // descuento se aplicaría en CADA compra del referido, no solo en
    // la primera (el propio alcance pedido dice "aplica el descuento
    // configurado" en la "primera compra del referido" -- sin esto no
    // hay forma real de saber si ya era la primera o no). Nulo hasta
    // que se consume.
    descuentoAplicadoEn: timestamp('descuento_aplicado_en', { withTimezone: true }),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('uq_referidos_usuario_referido').on(t.usuarioReferidoId)],
);

export const referidosRelations = relations(referidos, ({ one }) => ({
  referidor: one(usuarios, {
    fields: [referidos.usuarioReferidorId],
    references: [usuarios.id],
  }),
  referido: one(usuarios, {
    fields: [referidos.usuarioReferidoId],
    references: [usuarios.id],
  }),
  boletoQueDisparoCredito: one(boletos, {
    fields: [referidos.boletoQueDisparoCreditoId],
    references: [boletos.id],
  }),
}));
