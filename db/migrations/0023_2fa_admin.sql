-- Ítem 19, Fase 3 (05-ago-2026): 2FA obligatorio para las 3 cuentas
-- administrativas (super_admin, admin_plataforma, admin_cooperativa).
-- totp_secret cifrado (AES-256-GCM), no hasheado -- necesita poder
-- leerse de vuelta para calcular el código esperado.

ALTER TABLE "usuarios" ADD COLUMN "totp_secret" text;
--> statement-breakpoint

ALTER TABLE "usuarios" ADD COLUMN "totp_habilitado" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

CREATE TABLE "codigos_recuperacion_2fa" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "usuario_id" uuid NOT NULL REFERENCES "usuarios"("id"),
  "codigo_hash" varchar(255) NOT NULL,
  "usado_en" timestamptz,
  "creado_en" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "idx_codigos_recuperacion_2fa_usuario" ON "codigos_recuperacion_2fa" ("usuario_id");
