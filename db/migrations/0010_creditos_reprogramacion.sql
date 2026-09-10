-- Fase C: reprogramación con crédito (28-jul-2026).
-- Base del sistema: horas límite por cooperativa + tabla de créditos.
-- El flujo que realmente reprograma boletos es una entrega separada,
-- deliberadamente no incluida aquí — ver plan de corrección.

ALTER TABLE "cooperativas" ADD COLUMN "horas_limite_reprogramacion" integer;
--> statement-breakpoint

CREATE TABLE "creditos_pasajero" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"monto" numeric(8, 2) NOT NULL,
	"boleto_origen_id" uuid,
	"boleto_usado_id" uuid,
	"usado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "creditos_pasajero" ADD CONSTRAINT "creditos_pasajero_usuario_id_usuarios_id_fk"
  FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "creditos_pasajero" ADD CONSTRAINT "creditos_pasajero_cooperativa_id_cooperativas_id_fk"
  FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "creditos_pasajero" ADD CONSTRAINT "creditos_pasajero_boleto_origen_id_boletos_id_fk"
  FOREIGN KEY ("boleto_origen_id") REFERENCES "public"."boletos"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "creditos_pasajero" ADD CONSTRAINT "creditos_pasajero_boleto_usado_id_boletos_id_fk"
  FOREIGN KEY ("boleto_usado_id") REFERENCES "public"."boletos"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_creditos_pasajero_usuario" ON "creditos_pasajero" USING btree ("usuario_id");
--> statement-breakpoint
CREATE INDEX "idx_creditos_pasajero_cooperativa" ON "creditos_pasajero" USING btree ("cooperativa_id");

-- ⚠ Deliberadamente SIN política RLS todavía. A diferencia de las
-- tablas de flota/rutas/viajes (que las consulta el STAFF de una
-- cooperativa, siempre con app.current_cooperativa_id seteado), esta
-- tabla la consulta el PASAJERO dueño del crédito, que puede tener
-- créditos de varias cooperativas distintas a la vez — el patrón de
-- aislamiento "una sola cooperativa a la vez" no le queda. Se diseña
-- bien cuando se construya el endpoint real de consulta (evita repetir
-- el mismo error que encontramos en la auditoría del 28-jul-2026: una
-- política mal pensada que bloquea acceso legítimo en silencio).
