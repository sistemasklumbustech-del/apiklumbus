-- Integración con el sistema de tasas del Terminal (SIAT3000 / Derpacif),
-- CONTEXT.md sección 5.3 y Requerimiento Funcional TTM (RF-016, sección 8).
-- Escrita a mano en vez de con `drizzle-kit generate`: el journal de
-- drizzle-kit (db/migrations/meta) solo tiene snapshots hasta la 0001,
-- todas las migraciones 0002-0041 se escribieron a mano igual que esta,
-- así que generar automáticamente aquí producía un diff completo y
-- redundante contra todo el esquema (descartado, no se aplica).
--
-- Nunca se guarda el secreto real de autenticación en estas tablas —
-- solo una referencia (`secreto_ref`), porque el mecanismo real de
-- autenticación de SIAT3000 todavía no está confirmado por Derpacif
-- (Fase 0, bloqueada — CONTEXT.md sección 5.4).

CREATE TYPE "public"."modo_integracion_terminal" AS ENUM('unico', 'por_cooperativa');
--> statement-breakpoint
CREATE TYPE "public"."tipo_entidad_terminal" AS ENUM('bus', 'ruta', 'destino_ruta', 'frecuencia', 'viaje');
--> statement-breakpoint
CREATE TYPE "public"."estado_registro_tasa" AS ENUM('pendiente', 'exitosa', 'fallida');
--> statement-breakpoint

-- Una fila por terminal físico (RF-016). Sin RLS a propósito: es
-- infraestructura compartida por todas las cooperativas que operan desde
-- ese terminal, igual que `puntos_operacion` mismo — la administra el
-- Administrador TIC de plataforma, no cada cooperativa.
CREATE TABLE "credenciales_integracion_terminal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"punto_operacion_id" uuid NOT NULL,
	"proveedor_siat" varchar(3) NOT NULL,
	"sucursal_siat" varchar(3) NOT NULL,
	"punto_venta_siat" varchar(10),
	"modo" "modo_integracion_terminal" NOT NULL,
	"wsdl_url" text NOT NULL,
	"ambiente" varchar(20) DEFAULT 'certificacion' NOT NULL,
	"usuario_ttm_unico" varchar(20),
	"secreto_ref_unico" varchar(200),
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Modo B (USUARIO_TTM_POR_COOPERATIVA) — cada RUC de cooperativa usa el
-- nick que SIAT3000 tenga registrado para esa empresa (RF-016). Con RLS:
-- una cooperativa nunca debe poder leer el nick/secreto de otra.
CREATE TABLE "credenciales_terminal_por_cooperativa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credencial_integracion_id" uuid NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"usuario_ttm" varchar(20) NOT NULL,
	"secreto_ref" varchar(200) NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Traduce IDs locales ↔ IDs que devuelve SIAT3000 (getBus/getRuta/
-- getDestinoRuta/getFrecuenciaRuta/setCrearViaje). `entidad_local_id` es
-- deliberadamente polimórfico sin FK formal — el tipo real depende de
-- `tipo_entidad`, mismo patrón que otras referencias de auditoría del
-- proyecto sin FK formal (ver CONTEXT.md "Relaciones inversas").
CREATE TABLE "mapeo_entidades_terminal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"tipo_entidad" "tipo_entidad_terminal" NOT NULL,
	"entidad_local_id" uuid NOT NULL,
	"codigo_terminal" varchar(20) NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Auditoría + idempotencia de cada llamada real a `setVentaPasaje` — acá
-- vive el código de tasa de 20 dígitos que se convierte en QR (RF-010).
-- Una fila por compra (RN-004). `clave_idempotencia` es la defensa real
-- contra RN-005/RN-007: ante timeout de SIAT3000 la aplicación reconsulta
-- esta fila por su clave antes de reintentar, en vez de repetir la venta
-- a ciegas. `solicitud_payload`/`respuesta_payload` nunca deben contener
-- el secreto de autenticación (RF-021).
CREATE TABLE "registros_tasa_terminal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"compra_id" uuid NOT NULL,
	"clave_idempotencia" varchar(100) NOT NULL,
	"estado" "estado_registro_tasa" DEFAULT 'pendiente' NOT NULL,
	"codigo_tasa" varchar(20),
	"mensaje_terminal" text,
	"saldo_reportado" numeric(10, 2),
	"solicitud_payload" jsonb NOT NULL,
	"respuesta_payload" jsonb,
	"intentos" integer DEFAULT 0 NOT NULL,
	"ultimo_intento_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "credenciales_integracion_terminal" ADD CONSTRAINT "credenciales_integracion_terminal_punto_operacion_id_puntos_operacion_id_fk"
  FOREIGN KEY ("punto_operacion_id") REFERENCES "public"."puntos_operacion"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credenciales_terminal_por_cooperativa" ADD CONSTRAINT "credenciales_terminal_por_cooperativa_credencial_integracion_id_fk"
  FOREIGN KEY ("credencial_integracion_id") REFERENCES "public"."credenciales_integracion_terminal"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credenciales_terminal_por_cooperativa" ADD CONSTRAINT "credenciales_terminal_por_cooperativa_cooperativa_id_cooperativas_id_fk"
  FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mapeo_entidades_terminal" ADD CONSTRAINT "mapeo_entidades_terminal_cooperativa_id_cooperativas_id_fk"
  FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registros_tasa_terminal" ADD CONSTRAINT "registros_tasa_terminal_cooperativa_id_cooperativas_id_fk"
  FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registros_tasa_terminal" ADD CONSTRAINT "registros_tasa_terminal_compra_id_compras_id_fk"
  FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_credenciales_integracion_terminal_punto" ON "credenciales_integracion_terminal" USING btree ("punto_operacion_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_credenciales_terminal_por_cooperativa" ON "credenciales_terminal_por_cooperativa" USING btree ("credencial_integracion_id", "cooperativa_id");
--> statement-breakpoint
CREATE INDEX "idx_credenciales_terminal_por_cooperativa_coop" ON "credenciales_terminal_por_cooperativa" USING btree ("cooperativa_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mapeo_entidades_terminal_local" ON "mapeo_entidades_terminal" USING btree ("cooperativa_id", "tipo_entidad", "entidad_local_id");
--> statement-breakpoint
CREATE INDEX "idx_mapeo_entidades_terminal_codigo" ON "mapeo_entidades_terminal" USING btree ("cooperativa_id", "tipo_entidad", "codigo_terminal");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_registros_tasa_terminal_compra" ON "registros_tasa_terminal" USING btree ("compra_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_registros_tasa_terminal_idempotencia" ON "registros_tasa_terminal" USING btree ("clave_idempotencia");
--> statement-breakpoint
CREATE INDEX "idx_registros_tasa_terminal_cooperativa" ON "registros_tasa_terminal" USING btree ("cooperativa_id");
--> statement-breakpoint
CREATE INDEX "idx_registros_tasa_terminal_estado" ON "registros_tasa_terminal" USING btree ("estado");
--> statement-breakpoint

ALTER TABLE "credenciales_terminal_por_cooperativa" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_credenciales_terminal" ON "credenciales_terminal_por_cooperativa"
  AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin"
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "mapeo_entidades_terminal" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_mapeo_entidades_terminal" ON "mapeo_entidades_terminal"
  AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin"
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "registros_tasa_terminal" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_registros_tasa_terminal" ON "registros_tasa_terminal"
  AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin"
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);
