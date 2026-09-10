/**
 * Wallet / cashback, Fase 1 (13-ago-2026) -- ganar y consultar saldo.
 * Diseño investigado contra ClickBus (CashBus), la referencia real de
 * la industria: solo usuarios con cuenta ganan cashback (nunca
 * invitados), y se acredita solo cuando el pasajero de verdad viaja
 * (boleto pasa a 'usado' al validar el QR en la terminal) -- nunca al
 * momento de pagar, para evitar el fraude real de comprar, recibir
 * cashback, cancelar, y quedarse con reembolso Y cashback a la vez.
 *
 * Se modela como historial de movimientos (una fila por crédito), no
 * como un solo campo de saldo acumulado en `usuarios` -- así se puede
 * auditar cada movimiento individualmente y calcular el vencimiento de
 * 180 días por movimiento (ClickBus usa el mismo plazo real), no un
 * vencimiento global de todo el saldo junto.
 *
 * `cooperativaId` NO vive aquí a propósito -- el wallet es del USUARIO,
 * cruza cooperativas por diseño (igual que `calificaciones`), así que
 * esta tabla no tiene política RLS por cooperativa. Se accede siempre
 * con la conexión pública (bypass RLS), mismo criterio que
 * `calificaciones.repositorio.drizzle.ts`.
 */
import { pgTable, uuid, numeric, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { usuarios } from './usuarios';
import { compras } from './ventas';

export const walletMovimientos = pgTable(
  'wallet_movimientos',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    usuarioId: uuid('usuario_id')
      .references(() => usuarios.id)
      .notNull(),

    monto: numeric('monto', { precision: 10, scale: 2 }).notNull(),

    // 'credito_cashback' por ahora -- deja espacio real para más tipos
    // después (ej. 'debito_compra' cuando se construya la Fase 2, gastar
    // el saldo), sin necesitar otra migración de esquema para eso.
    tipo: varchar('tipo', { length: 30 }).notNull(),

    // De qué compra vino este movimiento -- nullable porque tipos
    // futuros (ej. un ajuste manual del admin) podrían no tener una
    // compra de origen.
    compraId: uuid('compra_id').references(() => compras.id),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_wallet_movimientos_usuario').on(t.usuarioId),
    index('idx_wallet_movimientos_creado_en').on(t.creadoEn),
  ],
);

export const walletMovimientosRelations = relations(walletMovimientos, ({ one }) => ({
  usuario: one(usuarios, { fields: [walletMovimientos.usuarioId], references: [usuarios.id] }),
  compra: one(compras, { fields: [walletMovimientos.compraId], references: [compras.id] }),
}));
