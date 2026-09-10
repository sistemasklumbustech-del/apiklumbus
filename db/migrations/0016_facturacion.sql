-- Facturación (29-jul-2026): dos piezas distintas.
-- 1) Solicitud de factura del pasaje -- puente con la cooperativa (la
--    cooperativa emite en su propio sistema, nosotros solo avisamos).
-- 2) Factura del servicio de Colombus -- reutiliza comprobantes_electronicos
--    ya existente (sujeto_tributario='plataforma'), solo se conecta el
--    flujo real (simulado hasta tener proveedor certificado real).

CREATE TYPE "public"."estado_solicitud_factura" AS ENUM('pendiente', 'emitida');
--> statement-breakpoint

CREATE TABLE "solicitudes_factura_cooperativa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"boleto_id" uuid NOT NULL,
	"datos_tributarios" jsonb NOT NULL,
	"estado" "estado_solicitud_factura" DEFAULT 'pendiente' NOT NULL,
	"url_factura" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"emitido_en" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "solicitudes_factura_cooperativa" ADD CONSTRAINT "solicitudes_factura_cooperativa_boleto_id_boletos_id_fk"
  FOREIGN KEY ("boleto_id") REFERENCES "public"."boletos"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_solicitudes_factura_boleto" ON "solicitudes_factura_cooperativa" USING btree ("boleto_id");
--> statement-breakpoint
CREATE INDEX "idx_solicitudes_factura_estado" ON "solicitudes_factura_cooperativa" USING btree ("estado");
