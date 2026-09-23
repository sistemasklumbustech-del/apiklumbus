-- RF-019 -- reclamos del pasajero (23-sep-2026). Ver el comentario
-- completo del diseño en db/schema/reclamos.ts (quién resuelve, estados,
-- por qué el dinero solo se registra y no se mueve, por qué hay un
-- único reclamo activo por boleto y tipo).

CREATE TYPE "public"."tipo_reclamo" AS ENUM('cobro_reembolso', 'servicio_viaje', 'boleto_qr');
--> statement-breakpoint
CREATE TYPE "public"."estado_reclamo" AS ENUM('abierto', 'en_revision', 'resuelto', 'rechazado');
--> statement-breakpoint

CREATE TABLE "reclamos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"boleto_id" uuid NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"pasajero_usuario_id" uuid NOT NULL,
	"tipo" "tipo_reclamo" NOT NULL,
	"descripcion" text NOT NULL,
	"estado" "estado_reclamo" DEFAULT 'abierto' NOT NULL,
	"respuesta" text,
	"monto_reconocido" numeric(8, 2),
	"gestionado_por_usuario_id" uuid,
	"resuelto_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_reclamos_monto" CHECK ("monto_reconocido" IS NULL OR "monto_reconocido" >= 0)
);
--> statement-breakpoint

ALTER TABLE "reclamos" ADD CONSTRAINT "reclamos_boleto_id_boletos_id_fk"
  FOREIGN KEY ("boleto_id") REFERENCES "public"."boletos"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reclamos" ADD CONSTRAINT "reclamos_cooperativa_id_cooperativas_id_fk"
  FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reclamos" ADD CONSTRAINT "reclamos_pasajero_usuario_id_usuarios_id_fk"
  FOREIGN KEY ("pasajero_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reclamos" ADD CONSTRAINT "reclamos_gestionado_por_usuario_id_usuarios_id_fk"
  FOREIGN KEY ("gestionado_por_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_reclamos_cooperativa_estado" ON "reclamos" USING btree ("cooperativa_id", "estado");
--> statement-breakpoint
CREATE INDEX "idx_reclamos_pasajero" ON "reclamos" USING btree ("pasajero_usuario_id");
--> statement-breakpoint
CREATE INDEX "idx_reclamos_boleto" ON "reclamos" USING btree ("boleto_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reclamos_activo_boleto_tipo" ON "reclamos" USING btree ("boleto_id", "tipo")
  WHERE "estado" IN ('abierto', 'en_revision');
--> statement-breakpoint

-- Aislamiento entre cooperativas (misma política que el resto de las
-- tablas multi-tenant). El backend accede con el rol de plataforma
-- (BYPASSRLS) y filtra por cooperativa de forma explícita -- esta
-- política es la red de seguridad si algún código futuro usa el rol de
-- aplicación sin filtrar.
ALTER TABLE "reclamos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_reclamos" ON "reclamos"
  AS PERMISSIVE FOR ALL TO "ticketya_app"
  USING (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);
