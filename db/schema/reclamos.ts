/**
 * Reclamos del pasajero (RF-019, 23-sep-2026).
 *
 * El pasajero (con cuenta) reclama sobre un boleto que compró; lo
 * atiende y resuelve la cooperativa dueña de ese viaje -- decisión del
 * director: sin escalamiento al admin de plataforma por ahora. Tres
 * tipos: cobro/reembolso, servicio del viaje y boleto/QR.
 *
 * Estados: `abierto` (recién creado) -> `en_revision` (la cooperativa
 * lo tomó, opcional) -> `resuelto` (procede a favor del pasajero) o
 * `rechazado` (no procede). Los dos últimos son finales.
 *
 * Dinero: solo se REGISTRA la decisión. `montoReconocido` es un dato
 * informativo (cuánto reconoce devolver la cooperativa); el reembolso
 * real se hace fuera del sistema. No toca pagos ni liquidaciones.
 *
 * `cooperativaId` está denormalizado desde el boleto (igual que
 * calificaciones) para listar por cooperativa sin pasar por boletos, y
 * para la política RLS de aislamiento entre cooperativas.
 *
 * Un solo reclamo ACTIVO por boleto y tipo (índice único parcial): evita
 * que el pasajero llene la bandeja de la cooperativa con duplicados
 * mientras el primero sigue sin resolver.
 */
import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { boletos } from './ventas';
import { cooperativas } from './tenancy';
import { usuarios } from './usuarios';
import { tipoReclamoEnum, estadoReclamoEnum } from './enums';

export const reclamos = pgTable(
  'reclamos',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    boletoId: uuid('boleto_id')
      .references(() => boletos.id)
      .notNull(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),
    pasajeroUsuarioId: uuid('pasajero_usuario_id')
      .references(() => usuarios.id)
      .notNull(),

    tipo: tipoReclamoEnum('tipo').notNull(),
    descripcion: text('descripcion').notNull(),
    estado: estadoReclamoEnum('estado').default('abierto').notNull(),

    // Respuesta de la cooperativa al resolver o rechazar.
    respuesta: text('respuesta'),
    montoReconocido: numeric('monto_reconocido', { precision: 8, scale: 2 }),
    gestionadoPorUsuarioId: uuid('gestionado_por_usuario_id').references(() => usuarios.id),
    resueltoEn: timestamp('resuelto_en', { withTimezone: true }),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_reclamos_cooperativa_estado').on(t.cooperativaId, t.estado),
    index('idx_reclamos_pasajero').on(t.pasajeroUsuarioId),
    index('idx_reclamos_boleto').on(t.boletoId),
    uniqueIndex('uq_reclamos_activo_boleto_tipo')
      .on(t.boletoId, t.tipo)
      .where(sql`${t.estado} IN ('abierto', 'en_revision')`),
    check('chk_reclamos_monto', sql`${t.montoReconocido} IS NULL OR ${t.montoReconocido} >= 0`),
  ],
);

export const reclamosRelations = relations(reclamos, ({ one }) => ({
  boleto: one(boletos, { fields: [reclamos.boletoId], references: [boletos.id] }),
  cooperativa: one(cooperativas, {
    fields: [reclamos.cooperativaId],
    references: [cooperativas.id],
  }),
  pasajero: one(usuarios, {
    fields: [reclamos.pasajeroUsuarioId],
    references: [usuarios.id],
  }),
}));
