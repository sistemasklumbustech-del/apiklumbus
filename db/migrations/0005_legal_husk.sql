CREATE TABLE "calificaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"boleto_id" uuid NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"pasajero_usuario_id" uuid NOT NULL,
	"puntuacion" smallint NOT NULL,
	"comentario" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calificaciones" ADD CONSTRAINT "calificaciones_boleto_id_boletos_id_fk" FOREIGN KEY ("boleto_id") REFERENCES "public"."boletos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calificaciones" ADD CONSTRAINT "calificaciones_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calificaciones" ADD CONSTRAINT "calificaciones_pasajero_usuario_id_usuarios_id_fk" FOREIGN KEY ("pasajero_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_calificaciones_boleto" ON "calificaciones" USING btree ("boleto_id");--> statement-breakpoint
CREATE INDEX "idx_calificaciones_cooperativa" ON "calificaciones" USING btree ("cooperativa_id");