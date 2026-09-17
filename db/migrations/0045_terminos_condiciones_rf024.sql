-- RF-024 -- versionado de Términos y Condiciones y registro de quién
-- aceptó cada versión. Ver comentario completo del diseño en
-- db/schema/terminos.ts (por qué es insert-only, por qué la versión
-- vigente se calcula en vez de marcarse con un booleano, por qué
-- usuario_id y compra_id son ambos nullable con un CHECK).

CREATE TABLE "terminos_condiciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" varchar(20) NOT NULL,
	"contenido" text NOT NULL,
	"vigente_desde" timestamp with time zone NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terminos_condiciones_version_unique" UNIQUE("version")
);
--> statement-breakpoint

CREATE INDEX "idx_terminos_condiciones_vigente_desde" ON "terminos_condiciones" USING btree ("vigente_desde");
--> statement-breakpoint

CREATE TABLE "terminos_aceptaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminos_version_id" uuid NOT NULL,
	"usuario_id" uuid,
	"compra_id" uuid,
	"direccion_ip" varchar(45),
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_terminos_aceptacion_actor" CHECK ("usuario_id" IS NOT NULL OR "compra_id" IS NOT NULL)
);
--> statement-breakpoint

ALTER TABLE "terminos_aceptaciones" ADD CONSTRAINT "terminos_aceptaciones_terminos_version_id_terminos_condiciones_id_fk"
  FOREIGN KEY ("terminos_version_id") REFERENCES "public"."terminos_condiciones"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "terminos_aceptaciones" ADD CONSTRAINT "terminos_aceptaciones_usuario_id_usuarios_id_fk"
  FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "terminos_aceptaciones" ADD CONSTRAINT "terminos_aceptaciones_compra_id_compras_id_fk"
  FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_terminos_aceptaciones_usuario" ON "terminos_aceptaciones" USING btree ("usuario_id");
--> statement-breakpoint
CREATE INDEX "idx_terminos_aceptaciones_compra" ON "terminos_aceptaciones" USING btree ("compra_id");
--> statement-breakpoint
CREATE INDEX "idx_terminos_aceptaciones_version" ON "terminos_aceptaciones" USING btree ("terminos_version_id");
