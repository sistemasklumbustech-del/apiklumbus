-- 16-oct-2026: dispositivos para notificaciones push de la app móvil.
-- Una fila por teléfono (token de Expo) con la cuenta que lo usa. Pertenece a una persona, no a una
-- cooperativa, así que no lleva RLS por cooperativa (mismo criterio que `referidos` y `wallet`); la
-- aplicación la consulta con la conexión de plataforma. Las tablas nuevas heredan los permisos del
-- rol de la aplicación por los DEFAULT PRIVILEGES de la migración manual 005.
CREATE TABLE IF NOT EXISTS "dispositivos_push" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "usuario_id" uuid NOT NULL,
  "token" varchar(200) NOT NULL,
  "plataforma" varchar(10) NOT NULL,
  "activo" boolean DEFAULT true NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  "actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispositivos_push" ADD CONSTRAINT "dispositivos_push_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dispositivos_push_token" ON "dispositivos_push" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dispositivos_push_usuario" ON "dispositivos_push" USING btree ("usuario_id");
