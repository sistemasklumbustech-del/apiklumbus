/**
 * Notificaciones — RF-NOTIF.
 *
 * Se usa como log/cola de envíos (no solo un disparador de fuego y
 * olvido) porque RNF-DISP-002 exige que ninguna venta confirmada se
 * pierda silenciosamente, y eso incluye poder auditar si su notificación
 * de confirmación realmente salió.
 */
import { pgTable, uuid, varchar, timestamp, text, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { compras } from './ventas';
import { viajes } from './rutas';
import { usuarios } from './usuarios';
import { canalNotificacionEnum, tipoNotificacionEnum } from './enums';

export const notificaciones = pgTable(
  'notificaciones',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    tipo: tipoNotificacionEnum('tipo').notNull(),
    canal: canalNotificacionEnum('canal').notNull(),

    // RF-NOTIF-001 se dispara desde una compra; RF-NOTIF-002/003 se
    // disparan desde un viaje (recordatorio o cambio operativo) y pueden
    // afectar a varios pasajeros/compras de ese mismo viaje, por eso
    // ambas referencias son nullable e independientes.
    compraId: uuid('compra_id').references(() => compras.id),
    viajeId: uuid('viaje_id').references(() => viajes.id),

    // Nullable: el destinatario puede no tener cuenta propia (comprador de
    // ventanilla walk-in); en ese caso se usa el correo/teléfono capturado
    // directamente en el checkout.
    usuarioDestinoId: uuid('usuario_destino_id').references(() => usuarios.id),
    correoDestino: varchar('correo_destino', { length: 200 }),
    telefonoDestino: varchar('telefono_destino', { length: 20 }),

    estadoEnvio: varchar('estado_envio', { length: 20 }).default('pendiente').notNull(), // 'pendiente' | 'enviado' | 'fallido'
    enviadoEn: timestamp('enviado_en', { withTimezone: true }),
    errorDetalle: text('error_detalle'),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_notificaciones_compra').on(t.compraId),
    index('idx_notificaciones_viaje').on(t.viajeId),
    index('idx_notificaciones_estado_envio').on(t.estadoEnvio),
  ],
);

export const notificacionesRelations = relations(notificaciones, ({ one }) => ({
  compra: one(compras, { fields: [notificaciones.compraId], references: [compras.id] }),
  viaje: one(viajes, { fields: [notificaciones.viajeId], references: [viajes.id] }),
  usuarioDestino: one(usuarios, {
    fields: [notificaciones.usuarioDestinoId],
    references: [usuarios.id],
  }),
}));
