/**
 * Solicitud de factura del pasaje (29-jul-2026) — confirmado con el
 * usuario: quien está obligado a emitir la factura del PASAJE es la
 * cooperativa (su propia venta, su propio RUC), no la plataforma.
 * Colombus solo hace de puente: el pasajero pide la factura desde su
 * cuenta, la cooperativa recibe el aviso y la emite en su propio
 * sistema contable (fuera de esta plataforma). No confundir con
 * `comprobantesElectronicos` (facturacion.ts) — esa es la factura del
 * SERVICIO de Colombus, un documento tributario distinto, de una
 * parte distinta.
 */
import { pgTable, uuid, jsonb, text, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { boletos } from './ventas';
import { estadoSolicitudFacturaEnum } from './enums';

export const solicitudesFacturaCooperativa = pgTable(
  'solicitudes_factura_cooperativa',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    boletoId: uuid('boleto_id')
      .references(() => boletos.id)
      .notNull(),

    // Datos tributarios de quien pide la factura -- obligatorios para
    // que la cooperativa pueda emitirla correctamente (cédula/RUC,
    // razón social, dirección). Estructura libre a propósito: persona
    // natural (cédula) vs. jurídica (RUC) piden campos distintos.
    datosTributarios: jsonb('datos_tributarios').notNull(),

    estado: estadoSolicitudFacturaEnum('estado').default('pendiente').notNull(),
    // La cooperativa emite la factura EN SU PROPIO SISTEMA (fuera de
    // esta plataforma) -- este campo es opcional, solo si quiere
    // adjuntar el link/PDF al marcarla como emitida.
    urlFactura: text('url_factura'),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    emitidoEn: timestamp('emitido_en', { withTimezone: true }),
  },
  (t) => [
    index('idx_solicitudes_factura_boleto').on(t.boletoId),
    index('idx_solicitudes_factura_estado').on(t.estado),
  ],
);

export const solicitudesFacturaCooperativaRelations = relations(
  solicitudesFacturaCooperativa,
  ({ one }) => ({
    boleto: one(boletos, {
      fields: [solicitudesFacturaCooperativa.boletoId],
      references: [boletos.id],
    }),
  }),
);
