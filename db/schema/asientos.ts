/**
 * Estado de asientos por viaje — RF-SEAT-003/004/005, RF-BUS-006.
 *
 * El *layout* del mapa de asientos (filas, columnas, categorías) vive en
 * `tipos_vehiculo.distribucionAsientos` (JSONB, ver flota.ts) porque es
 * configuración estática del tipo de vehículo. Esta tabla, en cambio,
 * modela el *estado transaccional* de cada asiento para un viaje
 * específico — disponible / bloqueado temporalmente / ocupado — que es lo
 * que cambia constantemente con cada compra en curso.
 *
 * No se referencia aquí ninguna tabla de `ventas.ts` (compras/boletos) a
 * propósito, para evitar una dependencia circular entre módulos: la
 * relación de propiedad se establece en sentido único desde `boletos`
 * (que sí referencia `viajeAsientoId`) hacia acá.
 */
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
  index,
  pgPolicy,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { viajes } from './rutas';
import { usuarios } from './usuarios';
import { estadoAsientoEnum } from './enums';
import { appRole, platformAdminRole } from './rls';

export const viajeAsientos = pgTable(
  'viaje_asientos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    viajeId: uuid('viaje_id')
      .references(() => viajes.id)
      .notNull(),

    // Debe coincidir con un identificador de asiento presente en el JSON
    // de `tipos_vehiculo.distribucionAsientos` de la unidad asignada a
    // este viaje (validado en la capa de aplicación, no en SQL).
    numeroAsiento: varchar('numero_asiento', { length: 10 }).notNull(),
    categoria: varchar('categoria', { length: 30 }), // ej. 'vip' | 'economico'

    estado: estadoAsientoEnum('estado').default('disponible').notNull(),

    // RF-SEAT-004 — bloqueo temporal (hold). RN-004 define la duración
    // exacta (decisión de negocio pendiente, ver configuracion.ts);
    // la fila queda con `holdExpiraEn` en null cuando no hay hold activo.
    holdExpiraEn: timestamp('hold_expira_en', { withTimezone: true }),
    holdUsuarioId: uuid('hold_usuario_id').references(() => usuarios.id),

    // Item 31, Fase 7 (11-ago-2026) -- compra como invitado (sin cuenta).
    // Un invitado no tiene usuarioId real para holdUsuarioId (es FK a
    // usuarios), asi que el bloqueo de un invitado se identifica por
    // este UUID generado en el navegador (mismo patron que
    // idempotencyKey) en vez de una cuenta real. Nunca se llenan los 2
    // a la vez -- un hold es de un usuario logueado O de un invitado.
    holdSesionInvitadoId: varchar('hold_sesion_invitado_id', { length: 100 }),

    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // RF-SEAT-005 — prevención de doble venta: no puede existir más de
    // una fila para el mismo asiento del mismo viaje. Combinado con
    // bloqueo de fila (SELECT ... FOR UPDATE) en la capa de aplicación al
    // hacer la transición de estado, esto es lo que hace que, en una
    // prueba de concurrencia con dos solicitudes simultáneas, solo una se
    // confirme (criterio de aceptación exacto de RF-SEAT-005).
    uniqueIndex('uq_viaje_asientos_viaje_numero').on(t.viajeId, t.numeroAsiento),
    index('idx_viaje_asientos_estado').on(t.estado),
    index('idx_viaje_asientos_hold_expira').on(t.holdExpiraEn),
    // No lleva cooperativa_id propio: hereda el aislamiento de tenant a
    // través de `viajes` (que sí tiene RLS). Aun así se declara una
    // política aquí, verificando la cooperativa del viaje padre via
    // subconsulta, porque RLS no es transitivo entre tablas por defecto.
    pgPolicy('aislamiento_cooperativa_viaje_asientos', {
      for: 'all',
      to: [appRole, platformAdminRole],
      using: sql`viaje_id IN (SELECT id FROM viajes WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)`,
      withCheck: sql`viaje_id IN (SELECT id FROM viajes WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)`,
    }),
  ],
).enableRLS();

export const viajeAsientosRelations = relations(viajeAsientos, ({ one }) => ({
  viaje: one(viajes, { fields: [viajeAsientos.viajeId], references: [viajes.id] }),
  holdUsuario: one(usuarios, { fields: [viajeAsientos.holdUsuarioId], references: [usuarios.id] }),
}));
