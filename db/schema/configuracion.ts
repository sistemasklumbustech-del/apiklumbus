/**
 * Configuracion global de la plataforma.
 *
 * Varias filas de este modulo existen especificamente para NO hardcodear
 * decisiones de negocio que el SRS marca explicitamente como pendientes de
 * validacion (seccion 9). En vez de asumir un valor, se modelan como
 * columnas nullable con su propia nota -- quedan vacias hasta que negocio
 * las defina, y el motor de reglas (capa de dominio, ver Arquitectura
 * Tecnica seccion 2) debe rechazar operarlas si estan en null.
 */
import { pgTable, uuid, varchar, numeric, integer, timestamp, text, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Tabla singleton (se espera una sola fila). Se modela como tabla -- no como
 * variables de entorno -- porque el Panel Admin (RF-ADMIN) debe poder
 * editarla en caliente y quedar auditada (RF-ADMIN-005).
 */
export const configuracionPlataforma = pgTable(
  'configuracion_plataforma',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Identidad tributaria propia de TicketYa como persona juridica.
    // Necesaria para RF-COMM-006 (comprobante de venta publicitaria a nombre
    // de la plataforma) y como uno de los 3 sujetos tributarios de RL-006.
    rucPlataforma: varchar('ruc_plataforma', { length: 13 }).notNull(),
    razonSocialPlataforma: varchar('razon_social_plataforma', { length: 200 }).notNull(),

    // RN-003 -- decision pendiente: modelo y porcentaje exacto de comision.
    // Nullable a proposito: no se asume un valor. Ver tambien
    // comisionPorcentajeModeloB si el modelo termina difiriendo por tipo de
    // integracion (pregunta abierta explicita en RN-003).
    comisionPorcentajeModeloADefault: numeric('comision_porcentaje_modelo_a_default', {
      precision: 5,
      scale: 2,
    }),
    comisionPorcentajeModeloBDefault: numeric('comision_porcentaje_modelo_b_default', {
      precision: 5,
      scale: 2,
    }),

    // RN-002 -- "cargo fijo de plataforma por pasajero", parte del desglose
    // de cobro (distinto de la comision de arriba, que es lo que la
    // plataforma retiene de la parte de la cooperativa). Nullable a
    // proposito: no se asume un valor -- si esta en null, la capa de
    // aplicacion lo trata como $0 y debe senalarlo como configuracion
    // pendiente, no como una decision ya tomada.
    cargoPlataformaPorPasajeroDefault: numeric('cargo_plataforma_por_pasajero_default', {
      precision: 8,
      scale: 2,
    }),

    // Cashback/wallet, Fase 1 (13-ago-2026) -- decision del director,
    // investigada contra ClickBus (CashBus), la referencia real de la
    // industria. Nullable a proposito, mismo patron exacto que
    // cargoPlataformaPorPasajeroDefault arriba: si esta en null, la capa
    // de aplicacion lo trata como 0% -- no se asume un numero real hasta
    // que el director lo decida.
    cashbackPorcentajeDefault: numeric('cashback_porcentaje_default', {
      precision: 5,
      scale: 2,
    }),

    // Programa de referidos "Invita y Gana" (13-ago-2026) -- mismo
    // patrón exacto que cashbackPorcentajeDefault arriba: nullable,
    // default 0 en la capa de aplicación hasta que el director decida
    // los números reales.
    referidoCreditoReferidorDefault: numeric('referido_credito_referidor_default', {
      precision: 8,
      scale: 2,
    }),
    referidoDescuentoReferidoDefault: numeric('referido_descuento_referido_default', {
      precision: 8,
      scale: 2,
    }),

    // Contacto de soporte global de la plataforma (13-ago-2026) --
    // decisión real del director, investigada contra FlixBus (mismo
    // modelo: una plataforma, muchos operadores independientes,
    // soporte centralizado en la marca de la plataforma, no en cada
    // operador). Nullable, sin valor por defecto -- hasta que el
    // director los configure, mismo criterio que el resto de esta
    // tabla (nunca inventar un placeholder).
    soporteCorreo: varchar('soporte_correo', { length: 200 }),
    soporteTelefono: varchar('soporte_telefono', { length: 20 }),

    // RN-004 -- decision pendiente: duracion exacta de la ventana de bloqueo
    // temporal de asiento (referencia de industria: 5-10 min, no asumida
    // como definitiva).
    ventanaBloqueoAsientoSegundos: integer('ventana_bloqueo_asiento_segundos'),

    // RN-005 / RF-TICKET-006 -- decision pendiente: politica de cancelacion
    // y reembolso. Se deja como texto libre estructurable a futuro (JSON)
    // en vez de columnas booleanas rigidas, porque ni siquiera el *shape*
    // de la politica esta definido todavia.
    politicaCancelacionNotas: text('politica_cancelacion_notas'),

    // Ventana minima antes de la salida para poder cancelar un boleto
    // (22-jul-2026). Nullable: si esta en null, la capa de aplicacion
    // usa un valor de reserva conservador (2 horas).
    cancelacionHorasMinimasAntes: integer('cancelacion_horas_minimas_antes'),

    // IVA vigente a nivel nacional (Ecuador, 15% al momento de este
    // diseno -- 21-jul-2026). Se propaga a las cooperativas en modo
    // automatico cuando el admin de plataforma actualiza este campo.
    ivaPorcentajeNacional: numeric('iva_porcentaje_nacional', {
      precision: 5,
      scale: 2,
    })
      .default('15.00')
      .notNull(),

    /**
     * 27-jul-2026 -- controla COMO se le muestra el IVA al pasajero en el
     * desglose de pago del checkout, sin afectar nunca el valor REAL que
     * se calcula y se guarda internamente (boletos.iva_monto,
     * compras.monto_impuestos siguen siempre con el numero real, para
     * auditoria). Editable desde el Panel Admin, sin tocar codigo.
     *
     * 'calculado' -- se muestra el valor real (comportamiento por defecto,
     *                igual que siempre).
     * 'cero'      -- se muestra $0.00, sin ocultar la linea.
     * 'oculto'    -- no se muestra ninguna linea de IVA (reutiliza el
     *                flag ivaVisible que el checkout ya devuelve).
     *
     * Motivo de negocio: cada cooperativa maneja su propia relacion con
     * el SRI de forma independiente; Colombus no debe afirmar un IVA que
     * no es su responsabilidad legal declarar por la tarifa del pasaje.
     */
    modoIvaBoleto: varchar('modo_iva_boleto', { length: 20 })
      .default('calculado')
      .notNull(),

    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      'chk_modo_iva_boleto',
      sql`${t.modoIvaBoleto} IN ('calculado', 'cero', 'oculto')`,
    ),
  ],
);
