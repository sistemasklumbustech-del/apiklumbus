-- Cooperativas proponen sus propios puntos de operación (13-ago-2026).
-- Decisión real del director, investigada contra plataformas
-- marketplace: modelo mixto -- la cooperativa propone su propia
-- oficina/parada, el admin de plataforma aprueba antes de publicarse.
-- terminal_terrestre sigue siendo exclusivo del admin (infraestructura
-- pública), no se abre a cooperativas.

CREATE TYPE "estado_punto_operacion" AS ENUM ('pendiente_revision', 'aprobado', 'rechazado');
--> statement-breakpoint

-- Default 'aprobado' a propósito: el admin sigue creando puntos
-- directo sin pasar por revisión -- ese flujo existente sigue
-- funcionando exactamente igual sin tocarlo. Solo el endpoint nuevo de
-- panel-empresa inserta explícitamente en 'pendiente_revision'.
ALTER TABLE "puntos_operacion" ADD COLUMN "estado" "estado_punto_operacion" DEFAULT 'aprobado' NOT NULL;
--> statement-breakpoint
ALTER TABLE "puntos_operacion" ADD COLUMN "aprobado_por_usuario_id" uuid;
--> statement-breakpoint
ALTER TABLE "puntos_operacion" ADD COLUMN "aprobado_en" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "puntos_operacion" ADD CONSTRAINT "puntos_operacion_aprobado_por_usuario_id_usuarios_id_fk"
  FOREIGN KEY ("aprobado_por_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_puntos_operacion_estado" ON "puntos_operacion" USING btree ("estado");
