/**
 * Viaje de menores de edad — RF-MENOR.
 *
 * RF-MENOR-005 (registro trazable de menores transportados) no requiere
 * una tabla nueva: es una consulta sobre `pasajeros_compra.es_menor_edad`
 * más las filas de este módulo, no un dato adicional que almacenar.
 */
import { pgTable, uuid, varchar, text, timestamp, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { pasajerosCompra, boletos } from './ventas';
import { usuarios } from './usuarios';
import { tipoAcompanamientoMenorEnum } from './enums';

/**
 * RF-MENOR-002/003 — captura de acompañante o autorización, y
 * almacenamiento seguro del documento.
 *
 * ⚠ "Almacenamiento seguro / cifrado" (RF-MENOR-003) se resuelve en la
 * capa de infraestructura de almacenamiento de archivos (cifrado en
 * reposo del bucket/objeto), no en esta tabla — aquí solo se guarda la
 * referencia (URL/key) al documento, nunca el archivo en sí. El control de
 * acceso ("solo personal autorizado") se aplica en la capa de aplicación
 * al generar URLs firmadas de corta duración, y a nivel de base de datos
 * mediante RLS heredado mediante el join mostrado en la política de
 * `boletos`/`pasajeros_compra` mencionada en ventas.ts.
 */
export const autorizacionesMenor = pgTable(
  'autorizaciones_menor',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pasajeroCompraId: uuid('pasajero_compra_id')
      .references(() => pasajerosCompra.id)
      .notNull(),

    tipoAcompanamiento: tipoAcompanamientoMenorEnum('tipo_acompanamiento').notNull(),

    // Solo aplica cuando tipoAcompanamiento = 'con_padre_madre_tutor' Y el
    // adulto viaja en la misma compra (auto-referencia a otro pasajero de
    // la misma compra).
    adultoAcompananteEnCompraId: uuid('adulto_acompanante_en_compra_id').references(
      () => pasajerosCompra.id,
    ),

    // Solo aplica cuando tipoAcompanamiento = 'con_autorizacion' — datos
    // del adulto responsable que firma, que puede no estar viajando.
    adultoResponsableNombre: varchar('adulto_responsable_nombre', { length: 200 }),
    adultoResponsableDocumento: varchar('adulto_responsable_documento', { length: 20 }),
    adultoResponsableTelefono: varchar('adulto_responsable_telefono', { length: 20 }),
    documentoAutorizacionUrl: text('documento_autorizacion_url'),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_autorizaciones_menor_pasajero_compra').on(t.pasajeroCompraId),
    index('idx_autorizaciones_menor_adulto_acompanante').on(t.adultoAcompananteEnCompraId),
  ],
);

/**
 * RF-MENOR-004 — verificación en ventanilla/abordaje. Se referencia el
 * `boleto` (no el `pasajeroCompra` directamente) porque la verificación
 * ocurre en el momento físico de abordar un viaje concreto, y un mismo
 * pasajero menor de un viaje redondo tiene dos boletos (ida/vuelta) que
 * requieren, en principio, verificación independiente cada uno.
 */
export const verificacionesMenor = pgTable(
  'verificaciones_menor',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    boletoId: uuid('boleto_id')
      .references(() => boletos.id)
      .notNull(),
    verificadoPorUsuarioId: uuid('verificado_por_usuario_id')
      .references(() => usuarios.id)
      .notNull(),

    documentoIdentidadVerificado: boolean('documento_identidad_verificado').notNull(),
    documentoAutorizacionVerificado: boolean('documento_autorizacion_verificado').notNull(),

    verificadoEn: timestamp('verificado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_verificaciones_menor_boleto').on(t.boletoId),
    index('idx_verificaciones_menor_verificado_por').on(t.verificadoPorUsuarioId),
  ],
);

export const autorizacionesMenorRelations = relations(autorizacionesMenor, ({ one }) => ({
  pasajeroCompra: one(pasajerosCompra, {
    fields: [autorizacionesMenor.pasajeroCompraId],
    references: [pasajerosCompra.id],
  }),
  adultoAcompanante: one(pasajerosCompra, {
    fields: [autorizacionesMenor.adultoAcompananteEnCompraId],
    references: [pasajerosCompra.id],
  }),
}));

export const verificacionesMenorRelations = relations(verificacionesMenor, ({ one }) => ({
  boleto: one(boletos, { fields: [verificacionesMenor.boletoId], references: [boletos.id] }),
  verificadoPor: one(usuarios, {
    fields: [verificacionesMenor.verificadoPorUsuarioId],
    references: [usuarios.id],
  }),
}));
