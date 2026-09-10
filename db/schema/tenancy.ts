/**
 * Tenancy: cooperativas y puntos de operación.
 *
 * `cooperativas` es el tenant raíz del sistema multi-tenant (RNF-ESC-001,
 * RNF-SEG-003). `puntos_operacion` modela RF-FLOTA-003: un único tipo con
 * discriminador para terminal terrestre / oficina-agencia / parada
 * intermedia, en vez de tres tablas separadas — comparten casi todos los
 * atributos (ubicación, regla de tasa) y participan de la misma jerarquía
 * en rutas y viajes.
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  doublePrecision,
  timestamp,
  boolean,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { estadoCooperativaEnum, modeloIntegracionEnum, tipoPuntoOperacionEnum, estadoPuntoOperacionEnum } from './enums';
import { usuarios } from './usuarios';

export const cooperativas = pgTable(
  'cooperativas',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // RL-006 / RN-007 — sujeto tributario propio, RUC obligatorio para
    // poder emitir su comprobante de la venta.
    ruc: varchar('ruc', { length: 13 }).notNull(),
    razonSocial: varchar('razon_social', { length: 200 }).notNull(),
    nombreComercial: varchar('nombre_comercial', { length: 150 }).notNull(),

    // RF-COOP-001 — autoregistro sujeto a aprobación.
    estado: estadoCooperativaEnum('estado').default('pendiente_revision').notNull(),

    // SRS 3.11 (corrección v1.2) — Modelo A y Modelo B son opciones
    // permanentes y paralelas, elegidas por la cooperativa al afiliarse.
    // No hay valor por defecto implícito: se exige elegir explícitamente
    // en el flujo de afiliación (RF-COOP-001), por eso no tiene .default().
    modeloIntegracion: modeloIntegracionEnum('modelo_integracion').notNull(),

    contactoNombre: varchar('contacto_nombre', { length: 150 }),
    contactoCorreo: varchar('contacto_correo', { length: 200 }),
    contactoTelefono: varchar('contacto_telefono', { length: 20 }),

    fechaAfiliacion: timestamp('fecha_afiliacion', { withTimezone: true }),

    // IVA (impuesto al valor agregado) — se asume, por defecto, YA
    // incluido dentro del precio del boleto (así opera hoy la mayoría de
    // cooperativas en Ecuador, tasa vigente 15%). Configurable por
    // cooperativa porque cada una puede tener un caso distinto: alguna
    // podría manejar 0% (exenta), o simplemente no querer mostrarlo
    // desglosado en el boleto aunque sí lo esté pagando. No se guarda
    // como parte de "configuracion_plataforma" (esa es global) porque
    // esta decisión es explícitamente por cooperativa.
    ivaPorcentaje: numeric('iva_porcentaje', { precision: 5, scale: 2 })
      .default('15.00')
      .notNull(),
    ivaVisibleEnBoleto: boolean('iva_visible_en_boleto').default(true).notNull(),
    // Corrección real (18-ago-2026, hallazgo del director comparando
    // con FlixBus): el recargo VIP es una política fija de la
    // cooperativa (como el precio de un tipo de asiento), no algo que
    // se vuelve a escribir en cada viaje nuevo. Este es el valor por
    // defecto -- el campo del formulario de "Crear viaje" sigue
    // existiendo para ajustarlo puntualmente si un viaje lo necesita.
    recargoVipDefault: numeric('recargo_vip_default', { precision: 8, scale: 2 })
      .default('0')
      .notNull(),
    // true = el valor de arriba se actualiza solo cuando el admin de
    // plataforma cambia el IVA nacional (comportamiento por defecto).
    // false = la cooperativa fijó su propio valor manualmente (ej.
    // exenta, o caso especial) y las actualizaciones masivas no la
    // tocan. Al editar su propio ivaPorcentaje desde el Panel Empresa,
    // esto pasa a false automáticamente — puede volver a true cuando
    // quiera "seguir de nuevo" el valor nacional.
    ivaSigueTasaNacional: boolean('iva_sigue_tasa_nacional').default(true).notNull(),

    // Logo de la cooperativa (22-jul-2026) — se guarda solo la URL, no
    // el archivo en sí. La imagen vive en un servicio externo de
    // almacenamiento (ej. Cloudinary) que la cooperativa ya usa o
    // configura aparte; aquí no se construye un pipeline de subida de
    // archivos propio todavía, sería sobre-construcción para lo que se
    // necesita hoy. Nullable: no toda cooperativa tiene logo cargado.
    logoUrl: text('logo_url'),

    // Reprogramación con crédito (28-jul-2026, Fase C) — horas mínimas
    // antes de la salida programada para poder reprogramar un boleto.
    // Configurable por cooperativa: no todas manejan la misma ventana
    // (confirmado en análisis de negocio con el usuario, comparado
    // contra prácticas reales de la industria — Flixbus, Peter Pan,
    // OurBus usan entre 15 min y 24h según el operador). Nullable: si
    // no está configurado, la capa de aplicación usa un valor de
    // reserva conservador — mismo patrón que
    // configuracionPlataforma.cancelacionHorasMinimasAntes.
    horasLimiteReprogramacion: integer('horas_limite_reprogramacion'),

    // Política de cancelación/reprogramación por cooperativa
    // (29-jul-2026) — hallazgo real: Transportes Occidental (Machala)
    // no permite cambios NI devoluciones, si el pasajero no viaja
    // pierde el boleto completo. No todas las cooperativas operan
    // igual, así que cada una decide por separado (una empresa puede
    // permitir reprogramar sin permitir cancelar — son cosas distintas
    // de negocio: cancelar es una venta perdida, reprogramar no).
    // Default `true` a propósito: es el comportamiento que ya existía
    // y estaba probado antes de esta pieza — una cooperativa que no
    // configura nada explícitamente sigue funcionando exactamente
    // igual que hoy, no se le restringe nada en silencio.
    permiteCancelacion: boolean('permite_cancelacion').default(true).notNull(),
    permiteReprogramacion: boolean('permite_reprogramacion').default(true).notNull(),

    // Mismo patrón que horasLimiteReprogramacion, pero para
    // cancelación -- antes solo existía un valor único de toda la
    // plataforma (configuracionPlataforma.cancelacionHorasMinimasAntes).
    horasLimiteCancelacion: integer('horas_limite_cancelacion'),

    // Ítem 10, Fase 2 (04-ago-2026) -- actualización periódica
    // obligatoria de datos. Hallazgo real: no existía ninguna columna
    // de dirección legal, se agrega aquí junto con la marca de tiempo
    // de confirmación. Nullable: null = nunca se ha confirmado, la
    // capa de aplicación usa fechaAfiliacion como referencia en ese
    // caso (ver panel-empresa.ports.ts, calcularEstadoActualizacionDatos).
    direccionLegal: text('direccion_legal'),
    datosActualizadosEn: timestamp('datos_actualizados_en', { withTimezone: true }),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_cooperativas_ruc').on(t.ruc),
    index('idx_cooperativas_estado').on(t.estado),
  ],
);

export const puntosOperacion = pgTable(
  'puntos_operacion',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    tipo: tipoPuntoOperacionEnum('tipo').notNull(),
    nombre: varchar('nombre', { length: 150 }).notNull(),

    // Para 'oficina_agencia': la oficina suele pertenecer y ser operada
    // por una única cooperativa en su parroquia/pueblo. Para
    // 'terminal_terrestre': es infraestructura pública/independiente,
    // compartida por muchas cooperativas — por eso esta columna es
    // nullable, no obligatoria.
    cooperativaPropietariaId: uuid('cooperativa_propietaria_id').references(() => cooperativas.id),

    ciudad: varchar('ciudad', { length: 100 }).notNull(),
    provincia: varchar('provincia', { length: 100 }).notNull(),
    direccion: text('direccion'),

    // Geolocalización (Arquitectura Técnica 4.1 — PostGIS). Se modelan
    // lat/lng como columnas simples aquí porque drizzle-orm no tiene un
    // builder nativo para el tipo `geography` de PostGIS en esta versión;
    // si se necesitan consultas espaciales reales (distancia, radio), debe
    // añadirse una columna `geography(Point, 4326)` vía migración SQL
    // manual (ver migrations/manual/002_postgis_puntos_operacion.sql) y
    // mantenerla sincronizada con lat/lng mediante trigger o en la capa de
    // aplicación.
    latitud: doublePrecision('latitud'),
    longitud: doublePrecision('longitud'),

    // RF-FLOTA-003 — "su propia regla de tasa (incluyendo $0 si no
    // aplica)". Nullable: un punto sin regla definida no debe asumirse
    // como $0 silenciosamente, debe tratarse como "regla pendiente de
    // configurar" a nivel de aplicación.
    tasaMonto: numeric('tasa_monto', { precision: 8, scale: 2 }),

    // RL-006 / decisión pendiente #4 del traspaso — un terminal terrestre
    // es su propio sujeto tributario y necesita RUC propio para emitir su
    // comprobante (RF-TICKET-002). Solo aplica a tipo='terminal_terrestre';
    // se deja nullable en vez de crear una tabla separada solo por esto.
    rucTerminal: varchar('ruc_terminal', { length: 13 }),

    // RN-007 / decisión pendiente #4 del traspaso: cuenta bancaria y
    // periodicidad de liquidación con el Terminal de Machala, aún no
    // confirmadas. Se dejan como columnas nullable con nota explícita en
    // vez de inventar un valor o una estructura rígida antes de tiempo.
    liquidacionBanco: varchar('liquidacion_banco', { length: 100 }),
    liquidacionNumeroCuenta: varchar('liquidacion_numero_cuenta', { length: 50 }),
    liquidacionTipoCuenta: varchar('liquidacion_tipo_cuenta', { length: 20 }),
    liquidacionTitular: varchar('liquidacion_titular', { length: 150 }),
    liquidacionPeriodicidadDias: numeric('liquidacion_periodicidad_dias', { precision: 3, scale: 0 }),

    // Vacío real de diseño encontrado el 29-jul-2026: cooperativas ya
    // tenía su propio logo, los terminales no. Agregado para que la
    // plataforma se vea profesional en cada punto de operación, no
    // solo en las cooperativas.
    logoUrl: text('logo_url'),

    // Cooperativas proponen sus propios puntos de operación (13-ago-2026)
    // -- default 'aprobado' a propósito: el admin sigue creando puntos
    // directo sin pasar por revisión (crearPuntoOperacion, sin tocar),
    // así que el default hace que ese flujo existente siga funcionando
    // exactamente igual, sin necesitar modificarlo. Solo el endpoint
    // NUEVO de panel-empresa inserta explícitamente en
    // 'pendiente_revision'.
    estado: estadoPuntoOperacionEnum('estado').default('aprobado').notNull(),
    // Mismo patrón de auditoría real que campanasPublicitarias -- quién
    // aprobó (o revisó) esta propuesta y cuándo, no solo el estado final.
    aprobadoPorUsuarioId: uuid('aprobado_por_usuario_id').references(() => usuarios.id),
    aprobadoEn: timestamp('aprobado_en', { withTimezone: true }),

    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_puntos_operacion_tipo').on(t.tipo),
    index('idx_puntos_operacion_ciudad').on(t.ciudad),
    index('idx_puntos_operacion_cooperativa_propietaria').on(t.cooperativaPropietariaId),
    index('idx_puntos_operacion_estado').on(t.estado),
  ],
);

export const cooperativasRelations = relations(cooperativas, ({ many }) => ({
  puntosOperacionPropios: many(puntosOperacion),
}));

export const puntosOperacionRelations = relations(puntosOperacion, ({ one }) => ({
  cooperativaPropietaria: one(cooperativas, {
    fields: [puntosOperacion.cooperativaPropietariaId],
    references: [cooperativas.id],
  }),
}));
