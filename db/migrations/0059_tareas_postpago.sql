-- Tareas posteriores al pago (06-oct-2026).
--
-- Después de cobrar una compra hay que (1) emitir la factura del pasaje de cada
-- cooperativa, (2) registrar la venta en el SIAT 3000 con el número de esa
-- factura para obtener el QR, y (3) emitir la factura del cargo de servicio de
-- Klumbus. Cualquiera de esos pasos puede fallar o tardar sin que el cobro
-- haya fallado, así que cada uno es una tarea persistente con reintentos, para
-- que nada se pierda si el servicio se reinicia o un proveedor está caído.
--
-- Sin RLS a propósito (igual que `compras`): la procesa un worker de la
-- plataforma, no una cooperativa. `cooperativa_id` es NULL en las tareas que
-- son de la plataforma (la factura del cargo de servicio).
--
-- Escrita a mano, mismo criterio que las migraciones 0002-0058.

CREATE TYPE "public"."tipo_tarea_postpago" AS ENUM('factura_pasaje', 'registro_tasa', 'factura_plataforma');
--> statement-breakpoint
CREATE TYPE "public"."estado_tarea_postpago" AS ENUM('pendiente', 'en_proceso', 'exitosa', 'agotada');
--> statement-breakpoint
CREATE TABLE "tareas_postpago" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"compra_id" uuid NOT NULL,
	"cooperativa_id" uuid,
	"tipo" "tipo_tarea_postpago" NOT NULL,
	"estado" "estado_tarea_postpago" DEFAULT 'pendiente' NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"max_intentos" integer DEFAULT 6 NOT NULL,
	"proximo_intento_en" timestamp with time zone DEFAULT now() NOT NULL,
	"bloqueada_hasta" timestamp with time zone,
	"ultimo_error" text,
	"resultado" jsonb,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"completado_en" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tareas_postpago" ADD CONSTRAINT "tareas_postpago_compra_id_compras_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tareas_postpago" ADD CONSTRAINT "tareas_postpago_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tareas_postpago_cooperativa" ON "tareas_postpago" USING btree ("compra_id","cooperativa_id","tipo") WHERE "cooperativa_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tareas_postpago_plataforma" ON "tareas_postpago" USING btree ("compra_id","tipo") WHERE "cooperativa_id" IS NULL;
--> statement-breakpoint
CREATE INDEX "idx_tareas_postpago_pendientes" ON "tareas_postpago" USING btree ("estado","proximo_intento_en");
--> statement-breakpoint
CREATE INDEX "idx_tareas_postpago_compra" ON "tareas_postpago" USING btree ("compra_id");
--> statement-breakpoint
ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'postpago_tarea_agotada';
--> statement-breakpoint
ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'postpago_tarea_reintentada';
