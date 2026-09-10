/**
 * Liquidaciones — RF-ADMIN-003 (a cooperativas), RF-ADMIN-006 (a
 * terminal), RN-007 (distribución de un pago único entre tres
 * beneficiarios).
 *
 * Se modelan como dos tablas separadas (no una genérica "liquidaciones"
 * con un tipo) porque sus criterios de aceptación son explícitamente
 * distintos e independientes: RF-ADMIN-006 exige que el monto liquidado al
 * terminal "no se mezcle con la liquidación de ninguna cooperativa".
 * Mantenerlas separadas hace ese requisito estructuralmente imposible de
 * violar por accidente, en vez de depender de que el código de aplicación
 * siempre filtre correctamente un campo `tipo`.
 */
import {
  pgTable,
  uuid,
  numeric,
  date,
  varchar,
  timestamp,
  text,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { cooperativas, puntosOperacion } from './tenancy';
import { usuarios } from './usuarios';

export const liquidacionesCooperativa = pgTable(
  'liquidaciones_cooperativa',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),

    periodoInicio: date('periodo_inicio').notNull(),
    periodoFin: date('periodo_fin').notNull(),

    montoVentasBruto: numeric('monto_ventas_bruto', { precision: 12, scale: 2 }).notNull(),
    montoComisionPlataforma: numeric('monto_comision_plataforma', { precision: 12, scale: 2 }).notNull(),
    montoAjustes: numeric('monto_ajustes', { precision: 12, scale: 2 }).default('0').notNull(),
    // Criterio de aceptación RF-ADMIN-003: debe coincidir con
    // (ventas − comisión ± ajustes). Se persiste el resultado, no solo se
    // calcula al vuelo, para que una liquidación ya pagada quede
    // congelada aunque cambien datos históricos después.
    montoLiquidado: numeric('monto_liquidado', { precision: 12, scale: 2 }).notNull(),

    estado: varchar('estado', { length: 20 }).default('pendiente').notNull(), // 'pendiente' | 'pagada'
    pagadoEn: timestamp('pagado_en', { withTimezone: true }),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_liquidaciones_cooperativa_cooperativa').on(t.cooperativaId),
    index('idx_liquidaciones_cooperativa_periodo').on(t.periodoInicio, t.periodoFin),
  ],
);

export const liquidacionesTerminal = pgTable(
  'liquidaciones_terminal',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    puntoOperacionId: uuid('punto_operacion_id')
      .references(() => puntosOperacion.id)
      .notNull(),

    periodoInicio: date('periodo_inicio').notNull(),
    periodoFin: date('periodo_fin').notNull(),

    montoTasaRecaudada: numeric('monto_tasa_recaudada', { precision: 12, scale: 2 }).notNull(),
    estado: varchar('estado', { length: 20 }).default('pendiente').notNull(),
    pagadoEn: timestamp('pagado_en', { withTimezone: true }),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_liquidaciones_terminal_punto').on(t.puntoOperacionId),
    index('idx_liquidaciones_terminal_periodo').on(t.periodoInicio, t.periodoFin),
  ],
);

/**
 * Ajustes manuales a una liquidación (nota de crédito, corrección,
 * disputa resuelta). Se referencia como evento propio, aparte del monto
 * agregado en la liquidación, porque RF-ADMIN-005 exige poder auditar
 * quién hizo el ajuste y cuándo — el monto agregado por sí solo no lo
 * permite.
 */
export const ajustesLiquidacion = pgTable(
  'ajustes_liquidacion',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    liquidacionCooperativaId: uuid('liquidacion_cooperativa_id').references(
      () => liquidacionesCooperativa.id,
    ),
    liquidacionTerminalId: uuid('liquidacion_terminal_id').references(() => liquidacionesTerminal.id),

    monto: numeric('monto', { precision: 12, scale: 2 }).notNull(), // puede ser negativo
    motivo: text('motivo').notNull(),
    registradoPorUsuarioId: uuid('registrado_por_usuario_id')
      .references(() => usuarios.id)
      .notNull(),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_ajustes_liquidacion_cooperativa').on(t.liquidacionCooperativaId),
    index('idx_ajustes_liquidacion_terminal').on(t.liquidacionTerminalId),
    // Exactamente una de las dos liquidaciones debe estar seteada — un
    // ajuste pertenece a una liquidación de cooperativa O de terminal,
    // nunca a ambas ni a ninguna. Se aplica como CHECK real de SQL, no
    // solo como convención documentada, porque este es precisamente el
    // tipo de invariante que RF-ADMIN-006 exige que sea imposible de
    // romper por un bug de aplicación.
    check(
      'chk_ajustes_liquidacion_exactamente_una',
      sql`(liquidacion_cooperativa_id IS NOT NULL AND liquidacion_terminal_id IS NULL)
          OR (liquidacion_cooperativa_id IS NULL AND liquidacion_terminal_id IS NOT NULL)`,
    ),
  ],
);

export const liquidacionesCooperativaRelations = relations(liquidacionesCooperativa, ({ one, many }) => ({
  cooperativa: one(cooperativas, {
    fields: [liquidacionesCooperativa.cooperativaId],
    references: [cooperativas.id],
  }),
  ajustes: many(ajustesLiquidacion),
}));

export const liquidacionesTerminalRelations = relations(liquidacionesTerminal, ({ one, many }) => ({
  puntoOperacion: one(puntosOperacion, {
    fields: [liquidacionesTerminal.puntoOperacionId],
    references: [puntosOperacion.id],
  }),
  ajustes: many(ajustesLiquidacion),
}));

export const ajustesLiquidacionRelations = relations(ajustesLiquidacion, ({ one }) => ({
  liquidacionCooperativa: one(liquidacionesCooperativa, {
    fields: [ajustesLiquidacion.liquidacionCooperativaId],
    references: [liquidacionesCooperativa.id],
  }),
  liquidacionTerminal: one(liquidacionesTerminal, {
    fields: [ajustesLiquidacion.liquidacionTerminalId],
    references: [liquidacionesTerminal.id],
  }),
  registradoPor: one(usuarios, {
    fields: [ajustesLiquidacion.registradoPorUsuarioId],
    references: [usuarios.id],
  }),
}));
