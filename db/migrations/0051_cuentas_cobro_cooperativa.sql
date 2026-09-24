-- Cuenta de cobro de la cooperativa (24-sep-2026). Ver el comentario
-- completo del diseño en db/schema/cuentas-cobro.ts.

CREATE TYPE "public"."estado_cuenta_cobro" AS ENUM('pendiente_verificacion', 'verificada', 'rechazada', 'reemplazada');
--> statement-breakpoint
CREATE TYPE "public"."tipo_cuenta_bancaria" AS ENUM('ahorros', 'corriente');
--> statement-breakpoint
CREATE TYPE "public"."tipo_identificacion_titular" AS ENUM('cedula', 'ruc');
--> statement-breakpoint

CREATE TABLE "cuentas_cobro_cooperativa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"entidad_financiera" "entidad_financiera" NOT NULL,
	"tipo_cuenta" "tipo_cuenta_bancaria" NOT NULL,
	"numero_cuenta" varchar(30) NOT NULL,
	"titular_nombre" varchar(150) NOT NULL,
	"titular_tipo_identificacion" "tipo_identificacion_titular" NOT NULL,
	"titular_identificacion" varchar(13) NOT NULL,
	"correo_notificacion" varchar(150) NOT NULL,
	"estado" "estado_cuenta_cobro" DEFAULT 'pendiente_verificacion' NOT NULL,
	"motivo_rechazo" text,
	"registrada_por_usuario_id" uuid,
	"verificada_por_usuario_id" uuid,
	"verificada_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "cuentas_cobro_cooperativa" ADD CONSTRAINT "cuentas_cobro_cooperativa_cooperativa_id_fk"
  FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cuentas_cobro_cooperativa" ADD CONSTRAINT "cuentas_cobro_cooperativa_registrada_por_fk"
  FOREIGN KEY ("registrada_por_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cuentas_cobro_cooperativa" ADD CONSTRAINT "cuentas_cobro_cooperativa_verificada_por_fk"
  FOREIGN KEY ("verificada_por_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_cuentas_cobro_estado" ON "cuentas_cobro_cooperativa" USING btree ("estado", "creado_en");
--> statement-breakpoint
-- A lo sumo una cuenta vigente (verificada) y una pendiente por cooperativa.
CREATE UNIQUE INDEX "uq_cuenta_cobro_verificada" ON "cuentas_cobro_cooperativa" USING btree ("cooperativa_id")
  WHERE "estado" = 'verificada';
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cuenta_cobro_pendiente" ON "cuentas_cobro_cooperativa" USING btree ("cooperativa_id")
  WHERE "estado" = 'pendiente_verificacion';
--> statement-breakpoint

ALTER TABLE "cuentas_cobro_cooperativa" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_cuentas_cobro" ON "cuentas_cobro_cooperativa"
  AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin"
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);
--> statement-breakpoint

ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'registro_cuenta_cobro';
--> statement-breakpoint
ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'verificacion_cuenta_cobro';
--> statement-breakpoint
ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'rechazo_cuenta_cobro';
