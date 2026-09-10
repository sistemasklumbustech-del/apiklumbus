/**
 * Facturación — RF-TICKET-002/003, RL-006.
 */
import {
  pgTable,
  uuid,
  varchar,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { boletos, compras } from './ventas';
import { puntosOperacion, cooperativas } from './tenancy';
import { sujetoTributarioEnum, estadoComprobanteEnum } from './enums';

/**
 * RF-TICKET-002 — comprobante de tasa de terminal, uno por pasajero
 * (criterio de aceptación: "cada pasajero de la compra recibe su propio
 * comprobante... con código de verificación independiente"). Por eso
 * referencia `boletos` 1:1, no `compras`.
 */
export const comprobantesTasaTerminal = pgTable(
  'comprobantes_tasa_terminal',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    boletoId: uuid('boleto_id')
      .references(() => boletos.id)
      .notNull(),
    puntoOperacionId: uuid('punto_operacion_id')
      .references(() => puntosOperacion.id)
      .notNull(),

    monto: numeric('monto', { precision: 8, scale: 2 }).notNull(),
    codigoVerificacion: varchar('codigo_verificacion', { length: 50 }).notNull(),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_comprobantes_tasa_terminal_boleto').on(t.boletoId),
    uniqueIndex('uq_comprobantes_tasa_terminal_codigo').on(t.codigoVerificacion),
    index('idx_comprobantes_tasa_terminal_punto').on(t.puntoOperacionId),
  ],
);

/**
 * RF-TICKET-003 / RL-006 — comprobante electrónico SRI. Modelado por
 * `compraId` + `sujetoTributario` (no por boleto individual): RL-006
 * plantea hasta 3 comprobantes *por venta*, uno por cada sujeto tributario
 * con RUC propio (cooperativa, terminal, plataforma), cada uno cubriendo
 * su porción agregada del cobro de esa compra — no un comprobante por
 * boleto.
 *
 * `cooperativaId` es nullable y solo se usa cuando
 * `sujetoTributario = 'cooperativa'`: identifica de cuál cooperativa es
 * esta porción, dato necesario porque (ver ventas.ts) una compra puede en
 * teoría involucrar boletos de más de una cooperativa (viaje redondo con
 * tramos de distintas cooperativas). Si esa compra tiene boletos de dos
 * cooperativas distintas, existirían dos filas con
 * sujetoTributario='cooperativa' para esa misma compra, una por cada
 * cooperativa involucrada.
 *
 * ⚠ Esta es exactamente el área que el SRS marca como decisión pendiente
 * de validación con contador/tributarista (sección 6, nota de RL-006) —
 * esta tabla implementa el diseño *propuesto*, no uno ya validado
 * legalmente.
 *
 * `compraId` es nullable porque esta misma tabla también sirve a
 * RF-COMM-006 (facturación a anunciantes): una venta de espacio
 * publicitario no está ligada a ninguna `compra` de boletos, pero sí debe
 * generar su propio comprobante electrónico a nombre de la plataforma
 * (sujetoTributario='plataforma'). En ese caso, es `campanas_publicitarias`
 * (ver comercial.ts) la que referencia el `id` de este comprobante — el
 * enlace se establece en sentido único desde comercial.ts para no crear
 * una dependencia circular entre módulos.
 */
export const comprobantesElectronicos = pgTable(
  'comprobantes_electronicos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    compraId: uuid('compra_id').references(() => compras.id),
    sujetoTributario: sujetoTributarioEnum('sujeto_tributario').notNull(),
    cooperativaId: uuid('cooperativa_id').references(() => cooperativas.id),

    // Snapshot del RUC efectivamente usado al emitir, para no depender de
    // que el RUC de la cooperativa/terminal/plataforma no haya cambiado
    // después — un comprobante ya autorizado por el SRI es inmutable.
    rucEmisor: varchar('ruc_emisor', { length: 13 }).notNull(),
    montoComprobante: numeric('monto_comprobante', { precision: 10, scale: 2 }).notNull(),

    claveAcceso: varchar('clave_acceso', { length: 49 }), // clave de acceso SRI, 49 dígitos
    numeroAutorizacion: varchar('numero_autorizacion', { length: 49 }),
    estado: estadoComprobanteEnum('estado').default('pendiente_autorizacion').notNull(),

    // RF-TICKET-003 — "si la autorización falla, la venta queda marcada
    // para reintento/revisión, no se pierde". Se guarda el motivo textual
    // del último rechazo/reintento para soporte, sin modelar de más.
    ultimoErrorProveedor: text('ultimo_error_proveedor'),

    // Arquitectura Técnica 5.2 — se integra un proveedor certificado
    // externo, no se construye la firma/envío propios. Estas URLs
    // (nullable hasta que el proveedor responda) apuntan a los artefactos
    // que ese proveedor entrega.
    xmlUrl: text('xml_url'),
    pdfUrl: text('pdf_url'),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_comprobantes_electronicos_compra').on(t.compraId),
    index('idx_comprobantes_electronicos_sujeto').on(t.sujetoTributario),
    index('idx_comprobantes_electronicos_estado').on(t.estado),
  ],
);

export const comprobantesTasaTerminalRelations = relations(comprobantesTasaTerminal, ({ one }) => ({
  boleto: one(boletos, { fields: [comprobantesTasaTerminal.boletoId], references: [boletos.id] }),
  puntoOperacion: one(puntosOperacion, {
    fields: [comprobantesTasaTerminal.puntoOperacionId],
    references: [puntosOperacion.id],
  }),
}));

export const comprobantesElectronicosRelations = relations(comprobantesElectronicos, ({ one }) => ({
  compra: one(compras, { fields: [comprobantesElectronicos.compraId], references: [compras.id] }),
  cooperativa: one(cooperativas, {
    fields: [comprobantesElectronicos.cooperativaId],
    references: [cooperativas.id],
  }),
}));
