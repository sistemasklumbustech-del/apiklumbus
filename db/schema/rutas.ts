/**
 * Rutas, paradas intermedias, horarios recurrentes y viajes.
 *
 * Se separa deliberadamente la ruta (definición estática: origen, destino,
 * paradas intermedias — RF-COOP-002, RF-FLOTA-004) del viaje (instancia
 * concreta en una fecha/hora con una unidad asignada — lo que RF-BUS
 * realmente busca y RF-SEAT realmente reserva). Mezclarlas en una sola
 * tabla obligaría a duplicar la ruta completa por cada salida.
 */
import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  boolean,
  timestamp,
  time,
  date,
  jsonb,
  index,
  pgPolicy,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { cooperativas } from './tenancy';
import { puntosOperacion } from './tenancy';
import { unidades, conductores } from './flota';
import { estadoViajeEnum } from './enums';
import { appRole, platformAdminRole, filtroCooperativaActual } from './rls';

export const rutas = pgTable(
  'rutas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),

    nombre: varchar('nombre', { length: 150 }),
    origenPuntoOperacionId: uuid('origen_punto_operacion_id')
      .references(() => puntosOperacion.id)
      .notNull(),
    destinoPuntoOperacionId: uuid('destino_punto_operacion_id')
      .references(() => puntosOperacion.id)
      .notNull(),

    // RN-002 — tarifa base del pasaje completo (origen → destino final),
    // definida por la cooperativa. Un viaje concreto puede sobreescribirla
    // puntualmente (ver `viajes.precioBase`); este es el valor de
    // referencia/planificación.
    precioBaseReferencia: numeric('precio_base_referencia', { precision: 8, scale: 2 }).notNull(),

    duracionEstimadaMinutos: integer('duracion_estimada_minutos'),
    // Hallazgo real del director (21-ago-2026) -- dato informativo real
    // para el pasajero, junto a la duracion estimada.
    distanciaKm: integer('distancia_km'),

    activa: boolean('activa').default(true).notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_rutas_cooperativa').on(t.cooperativaId),
    index('idx_rutas_origen_destino').on(t.origenPuntoOperacionId, t.destinoPuntoOperacionId),
    pgPolicy('aislamiento_cooperativa_rutas', {
      for: 'all',
      to: [appRole, platformAdminRole],
      using: filtroCooperativaActual,
      withCheck: filtroCooperativaActual,
    }),
  ],
).enableRLS();

/**
 * RF-FLOTA-004 (Fase 2) — paradas intermedias de embarque/desembarque.
 * `tarifaDesdeOrigen` permite cobrar el tramo correcto a un pasajero que
 * compra hasta una parada intermedia, no el pasaje completo.
 */
export const rutaParadas = pgTable(
  'ruta_paradas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    rutaId: uuid('ruta_id')
      .references(() => rutas.id)
      .notNull(),
    puntoOperacionId: uuid('punto_operacion_id')
      .references(() => puntosOperacion.id)
      .notNull(),
    orden: integer('orden').notNull(), // 1 = primera parada tras el origen
    tarifaDesdeOrigen: numeric('tarifa_desde_origen', { precision: 8, scale: 2 }).notNull(),
    tiempoEstimadoDesdeOrigenMinutos: integer('tiempo_estimado_desde_origen_minutos'),
  },
  (t) => [
    index('idx_ruta_paradas_ruta').on(t.rutaId),
    index('idx_ruta_paradas_orden').on(t.rutaId, t.orden),
    // Correccion real de seguridad (20-ago-2026): esta tabla no tenia
    // RLS activado -- mismo patron real que viaje_asientos (sin
    // cooperativa_id propio, aislamiento via el padre `rutas`).
    // Correccion real (20-ago-2026, migracion 0040): la primera
    // version copiaba el patron viejo y obsoleto de solo listar el
    // rol en `to`, esperando BYPASSRLS -- eso nunca funciona en un
    // Postgres administrado (Render). Patron correcto real, mismo
    // que ya usa el resto de la plataforma desde la migracion 0028:
    // excepcion explicita dentro de using/withCheck.
    pgPolicy('aislamiento_cooperativa_ruta_paradas', {
      for: 'all',
      to: [appRole, platformAdminRole],
      using: sql`current_user = 'ticketya_platform_admin' OR ruta_id IN (SELECT id FROM rutas WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)`,
      withCheck: sql`current_user = 'ticketya_platform_admin' OR ruta_id IN (SELECT id FROM rutas WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)`,
    }),
  ],
).enableRLS();

/**
 * RF-COOP-002 — frecuencias/horarios recurrentes que la cooperativa opera
 * para una ruta (ej. "todos los días a las 08:00"). Se usa como plantilla
 * para generar filas de `viajes`; no reemplaza a `viajes`, que es donde
 * vive la disponibilidad real consultada por RF-BUS.
 */
export const horariosRuta = pgTable(
  'horarios_ruta',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    rutaId: uuid('ruta_id')
      .references(() => rutas.id)
      .notNull(),
    horaSalida: time('hora_salida').notNull(),
    // Días de la semana en los que aplica, 0=domingo..6=sábado.
    diasSemana: jsonb('dias_semana').notNull(),
    tipoVehiculoPredeterminadoId: uuid('tipo_vehiculo_predeterminado_id'),
    activo: boolean('activo').default(true).notNull(),
  },
  (t) => [index('idx_horarios_ruta_ruta').on(t.rutaId)],
);

/**
 * Instancia real de un viaje: lo que RF-BUS busca, RF-SEAT reserva y
 * RF-CHECK cobra. Cada fila es una salida concreta con una unidad
 * asignada.
 */
export const viajes = pgTable(
  'viajes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),
    rutaId: uuid('ruta_id')
      .references(() => rutas.id)
      .notNull(),
    unidadId: uuid('unidad_id')
      .references(() => unidades.id)
      .notNull(),
    // Nullable a propósito: asignar conductor es útil pero no debe ser
    // un requisito bloqueante para poder publicar un viaje (una
    // cooperativa podría asignar el conductor más cerca de la fecha).
    conductorId: uuid('conductor_id').references(() => conductores.id),
    horarioRutaOrigenId: uuid('horario_ruta_origen_id').references(() => horariosRuta.id),

    fechaSalida: date('fecha_salida').notNull(),
    horaSalidaProgramada: timestamp('hora_salida_programada', { withTimezone: true }).notNull(),
    horaLlegadaEstimada: timestamp('hora_llegada_estimada', { withTimezone: true }),

    // RN-002 — precio realmente cobrado en esta salida; normalmente igual
    // a rutas.precioBaseReferencia, pero puede diferir puntualmente.
    precioBase: numeric('precio_base', { precision: 8, scale: 2 }).notNull(),

    // Zona VIP de asientos (17-ago-2026, orden real del director): monto
    // FIJO adicional (no porcentaje) para los asientos con etiqueta 'vip'
    // en tiposVehiculo.distribucionAsientos -- decisión explícita del
    // director. Configurable por CADA cooperativa en CADA viaje que
    // crean, mismo nivel real que precioBase -- nunca un valor de
    // plataforma (los precios varían por cooperativa y cambian con el
    // tiempo, según sus propias tarifas reales). Default 0, no NULL --
    // un viaje sin recargo VIP explícito simplemente no cobra de más.
    recargoVip: numeric('recargo_vip', { precision: 8, scale: 2 }).notNull().default('0'),

    estado: estadoViajeEnum('estado').default('programado').notNull(),

    // Ítem 16, Fase 2 (05-ago-2026) -- seguimiento GPS en vivo. Última
    // posición conocida, NO un historial de todo el trayecto -- el
    // requerimiento siempre fue "dónde está el bus ahora", cada ping
    // nuevo sobrescribe el anterior. Nullable: la enorme mayoría de
    // viajes no tienen hardware GPS conectado todavía (bloqueo externo,
    // no técnico -- ver nota de "conector a la medida" en api_externa.ts).
    ubicacionLatitud: numeric('ubicacion_latitud', { precision: 10, scale: 7 }),
    ubicacionLongitud: numeric('ubicacion_longitud', { precision: 10, scale: 7 }),
    ubicacionActualizadaEn: timestamp('ubicacion_actualizada_en', { withTimezone: true }),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_viajes_cooperativa').on(t.cooperativaId),
    index('idx_viajes_ruta_fecha').on(t.rutaId, t.fechaSalida),
    // RF-BUS-001 — la búsqueda filtra por fecha de salida y ordena por
    // hora; este índice sirve directamente a ese patrón de consulta.
    index('idx_viajes_fecha_hora').on(t.fechaSalida, t.horaSalidaProgramada),
    index('idx_viajes_unidad').on(t.unidadId),
    pgPolicy('aislamiento_cooperativa_viajes', {
      for: 'all',
      to: [appRole, platformAdminRole],
      using: filtroCooperativaActual,
      withCheck: filtroCooperativaActual,
    }),
  ],
).enableRLS();

export const rutasRelations = relations(rutas, ({ one, many }) => ({
  cooperativa: one(cooperativas, { fields: [rutas.cooperativaId], references: [cooperativas.id] }),
  origen: one(puntosOperacion, {
    fields: [rutas.origenPuntoOperacionId],
    references: [puntosOperacion.id],
  }),
  destino: one(puntosOperacion, {
    fields: [rutas.destinoPuntoOperacionId],
    references: [puntosOperacion.id],
  }),
  paradas: many(rutaParadas),
  horarios: many(horariosRuta),
  viajes: many(viajes),
}));

export const rutaParadasRelations = relations(rutaParadas, ({ one }) => ({
  ruta: one(rutas, { fields: [rutaParadas.rutaId], references: [rutas.id] }),
  puntoOperacion: one(puntosOperacion, {
    fields: [rutaParadas.puntoOperacionId],
    references: [puntosOperacion.id],
  }),
}));

export const horariosRutaRelations = relations(horariosRuta, ({ one }) => ({
  ruta: one(rutas, { fields: [horariosRuta.rutaId], references: [rutas.id] }),
}));

export const viajesRelations = relations(viajes, ({ one }) => ({
  cooperativa: one(cooperativas, { fields: [viajes.cooperativaId], references: [cooperativas.id] }),
  ruta: one(rutas, { fields: [viajes.rutaId], references: [rutas.id] }),
  unidad: one(unidades, { fields: [viajes.unidadId], references: [unidades.id] }),
  conductor: one(conductores, { fields: [viajes.conductorId], references: [conductores.id] }),
}));
