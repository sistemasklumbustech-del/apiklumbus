-- Programa de referidos "Invita y Gana" (13-ago-2026). Diseño
-- investigado contra ClickBus ("Indique e Ganhe"): descuento al
-- amigo referido en su primera compra; crédito a quien refiere solo
-- después de que el amigo REALMENTE viaja (boleto validado) -- mismo
-- patrón anti-fraude que el cashback. Reutiliza wallet_movimientos
-- para el crédito del referidor (tipo 'credito_referido').

ALTER TYPE "accion_auditoria" ADD VALUE IF NOT EXISTS 'cambio_config_referidos';
--> statement-breakpoint

ALTER TABLE "configuracion_plataforma" ADD COLUMN "referido_credito_referidor_default" numeric(8, 2);
--> statement-breakpoint
ALTER TABLE "configuracion_plataforma" ADD COLUMN "referido_descuento_referido_default" numeric(8, 2);
--> statement-breakpoint

CREATE TABLE "referidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_referidor_id" uuid NOT NULL,
	"usuario_referido_id" uuid NOT NULL,
	"boleto_que_disparo_credito_id" uuid,
	"descuento_aplicado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "referidos" ADD CONSTRAINT "referidos_usuario_referidor_id_usuarios_id_fk"
  FOREIGN KEY ("usuario_referidor_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "referidos" ADD CONSTRAINT "referidos_usuario_referido_id_usuarios_id_fk"
  FOREIGN KEY ("usuario_referido_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "referidos" ADD CONSTRAINT "referidos_boleto_que_disparo_credito_id_boletos_id_fk"
  FOREIGN KEY ("boleto_que_disparo_credito_id") REFERENCES "public"."boletos"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Único a propósito -- una persona solo puede haber sido referida una
-- vez, por un solo referidor (se decide al registrarse, no se agrega
-- un referidor después).
CREATE UNIQUE INDEX "uq_referidos_usuario_referido" ON "referidos" USING btree ("usuario_referido_id");

-- ⚠ Deliberadamente SIN política RLS, mismo criterio exacto que
-- wallet_movimientos y creditos_pasajero: la relación de referidos es
-- entre 2 usuarios, no pertenece a ninguna cooperativa -- se accede
-- siempre con la conexión pública (bypass RLS).
