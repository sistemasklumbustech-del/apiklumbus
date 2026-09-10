-- Wallet / cashback, Fase 1 -- ganar y consultar saldo (13-ago-2026).
-- Diseño investigado contra ClickBus (CashBus), la referencia real de
-- la industria: solo usuarios con cuenta ganan cashback (nunca
-- invitados), y se acredita solo cuando el boleto pasa a 'usado' (QR
-- validado en la terminal) -- nunca al pagar, para evitar el fraude
-- real de comprar + recibir cashback + cancelar + quedarse con
-- reembolso Y cashback a la vez.

ALTER TYPE "accion_auditoria" ADD VALUE IF NOT EXISTS 'cambio_cashback_porcentaje';
--> statement-breakpoint

ALTER TABLE "configuracion_plataforma" ADD COLUMN "cashback_porcentaje_default" numeric(5, 2);
--> statement-breakpoint

CREATE TABLE "wallet_movimientos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"monto" numeric(10, 2) NOT NULL,
	"tipo" varchar(30) NOT NULL,
	"compra_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "wallet_movimientos" ADD CONSTRAINT "wallet_movimientos_usuario_id_usuarios_id_fk"
  FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wallet_movimientos" ADD CONSTRAINT "wallet_movimientos_compra_id_compras_id_fk"
  FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_wallet_movimientos_usuario" ON "wallet_movimientos" USING btree ("usuario_id");
--> statement-breakpoint
CREATE INDEX "idx_wallet_movimientos_creado_en" ON "wallet_movimientos" USING btree ("creado_en");

-- ⚠ Deliberadamente SIN política RLS, mismo criterio exacto que
-- creditos_pasajero (migración 0010): esta tabla la consulta el
-- PASAJERO dueño del wallet, que puede tener movimientos de boletos
-- de varias cooperativas distintas a la vez -- el patrón de
-- aislamiento "una sola cooperativa a la vez" no le queda. Se accede
-- siempre con la conexión pública (bypass RLS), mismo patrón que
-- calificaciones.repositorio.drizzle.ts.
