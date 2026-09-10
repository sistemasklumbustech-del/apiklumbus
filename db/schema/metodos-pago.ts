/**
 * Métodos de pago manuales por cooperativa (29-jul-2026).
 *
 * Contexto real de negocio: no hay una pasarela de pago conectada
 * todavía (decisión de proveedor pendiente — PayPhone vs Kushki). En
 * vez de bloquear todo el lanzamiento hasta esa decisión, cada
 * cooperativa configura los métodos que YA usa hoy en Ecuador
 * (transferencia bancaria, efectivo, DeUna, PayPhone billetera) con
 * sus propios datos para recibir el pago. El pasajero paga por fuera
 * de la plataforma, sube un comprobante, y la cooperativa confirma
 * manualmente — mismo patrón que usan Tiendanube, Billowshop y la
 * mayoría de plataformas de comercio electrónico latinoamericanas
 * (investigado antes de construir, no asumido).
 *
 * Cuando se conecte una pasarela real, se agrega como un método más
 * a este mismo catálogo (`tarjeta_pasarela`) — el diseño ya lo
 * contempla, no hay que rehacer nada.
 */
import { pgTable, uuid, boolean, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { cooperativas } from './tenancy';
import { tipoMetodoPagoEnum, entidadFinancieraEnum } from './enums';

export const metodosPagoCooperativa = pgTable(
  'metodos_pago_cooperativa',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),
    tipo: tipoMetodoPagoEnum('tipo').notNull(),

    // Ítem 21/22 (06-ago-2026) -- solo aplica cuando tipo =
    // 'transferencia_bancaria', null en el resto (efectivo, deuna,
    // payphone, tarjeta_pasarela no tienen "banco receptor"). Catálogo
    // cerrado -- ver nota completa en enums.ts sobre por qué el texto
    // libre que vivía dentro de datosCuenta no era suficiente.
    entidadFinanciera: entidadFinancieraEnum('entidad_financiera'),

    activo: boolean('activo').default(true).notNull(),

    // Estructura libre a propósito -- cada tipo necesita datos
    // distintos: transferencia_bancaria = {banco, tipoCuenta,
    // numeroCuenta, titular, cedulaTitular}; efectivo =
    // {instrucciones}; deuna/payphone = {numeroCelular, titular}.
    datosCuenta: jsonb('datos_cuenta').notNull(),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Una cooperativa no puede configurar el mismo tipo de método dos
    // veces -- evita confusión de "¿cuál cuenta uso, la primera o la
    // segunda que cargué?".
    uniqueIndex('uq_metodos_pago_cooperativa_tipo').on(t.cooperativaId, t.tipo),
    index('idx_metodos_pago_cooperativa').on(t.cooperativaId),
  ],
);

export const metodosPagoCooperativaRelations = relations(metodosPagoCooperativa, ({ one }) => ({
  cooperativa: one(cooperativas, {
    fields: [metodosPagoCooperativa.cooperativaId],
    references: [cooperativas.id],
  }),
}));
