/**
 * Cuenta de cobro de la cooperativa (24-sep-2026).
 *
 * Modelo de cobro: el pasajero paga EN LÍNEA (tarjeta o DeUna) y el
 * dinero entra a la cuenta de la plataforma; luego la plataforma liquida
 * a cada cooperativa (ver liquidaciones). Para poder liquidar, cada
 * cooperativa registra aquí la cuenta bancaria donde quiere recibir el
 * dinero de sus boletos.
 *
 * Verificación: la cooperativa registra la cuenta y queda
 * `pendiente_verificacion`; el admin de plataforma la revisa (titular,
 * RUC/cédula) y la marca `verificada` o `rechazada` con motivo. Solo una
 * cuenta `verificada` recibe liquidaciones. Si la cooperativa registra
 * otra, la vigente sigue vigente hasta que la nueva se verifique; en ese
 * momento la anterior pasa a `reemplazada` (se conserva como historial).
 */
import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { cooperativas } from './tenancy';
import { usuarios } from './usuarios';
import {
  entidadFinancieraEnum,
  estadoCuentaCobroEnum,
  tipoCuentaBancariaEnum,
  tipoIdentificacionTitularEnum,
} from './enums';

export const cuentasCobroCooperativa = pgTable(
  'cuentas_cobro_cooperativa',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cooperativaId: uuid('cooperativa_id')
      .references(() => cooperativas.id)
      .notNull(),
    entidadFinanciera: entidadFinancieraEnum('entidad_financiera').notNull(),
    tipoCuenta: tipoCuentaBancariaEnum('tipo_cuenta').notNull(),
    numeroCuenta: varchar('numero_cuenta', { length: 30 }).notNull(),
    titularNombre: varchar('titular_nombre', { length: 150 }).notNull(),
    titularTipoIdentificacion: tipoIdentificacionTitularEnum('titular_tipo_identificacion').notNull(),
    titularIdentificacion: varchar('titular_identificacion', { length: 13 }).notNull(),
    correoNotificacion: varchar('correo_notificacion', { length: 150 }).notNull(),
    estado: estadoCuentaCobroEnum('estado').default('pendiente_verificacion').notNull(),
    motivoRechazo: text('motivo_rechazo'),
    registradaPorUsuarioId: uuid('registrada_por_usuario_id').references(() => usuarios.id),
    verificadaPorUsuarioId: uuid('verificada_por_usuario_id').references(() => usuarios.id),
    verificadaEn: timestamp('verificada_en', { withTimezone: true }),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_cuentas_cobro_estado').on(t.estado, t.creadoEn)],
);
