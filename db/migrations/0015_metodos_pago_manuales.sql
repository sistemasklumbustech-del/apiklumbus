-- Métodos de pago manuales por cooperativa (29-jul-2026) -- mientras
-- no hay pasarela real conectada, cada cooperativa opera con lo que
-- ya usa hoy en Ecuador (transferencia, efectivo, DeUna, PayPhone
-- billetera). El pasajero sube comprobante, la cooperativa confirma
-- manualmente -- mismo patrón que Tiendanube/Billowshop.

ALTER TYPE "estado_asiento" ADD VALUE 'pendiente_confirmacion_pago';
--> statement-breakpoint

CREATE TYPE "public"."tipo_metodo_pago" AS ENUM('transferencia_bancaria', 'efectivo', 'deuna', 'payphone', 'tarjeta_pasarela');
--> statement-breakpoint

CREATE TABLE "metodos_pago_cooperativa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"tipo" "tipo_metodo_pago" NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"datos_cuenta" jsonb NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "metodos_pago_cooperativa" ADD CONSTRAINT "metodos_pago_cooperativa_cooperativa_id_cooperativas_id_fk"
  FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_metodos_pago_cooperativa_tipo" ON "metodos_pago_cooperativa" USING btree ("cooperativa_id", "tipo");
--> statement-breakpoint
CREATE INDEX "idx_metodos_pago_cooperativa" ON "metodos_pago_cooperativa" USING btree ("cooperativa_id");
--> statement-breakpoint

ALTER TABLE "pagos" ADD COLUMN "comprobante_url" text;
--> statement-breakpoint
ALTER TABLE "pagos" ADD COLUMN "confirmado_por_usuario_id" uuid;
--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_confirmado_por_usuario_id_usuarios_id_fk"
  FOREIGN KEY ("confirmado_por_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Persiste la relación pasajero <-> asiento (antes solo vivía en
-- memoria durante la petición) -- necesario para reconstruirla horas
-- después, cuando la cooperativa confirme un pago manual.
ALTER TABLE "pasajeros_compra" ADD COLUMN "viaje_asiento_id" uuid;
--> statement-breakpoint
ALTER TABLE "pasajeros_compra" ADD CONSTRAINT "pasajeros_compra_viaje_asiento_id_viaje_asientos_id_fk"
  FOREIGN KEY ("viaje_asiento_id") REFERENCES "public"."viaje_asientos"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Mismo motivo que viaje_asiento_id: el desglose de precio de cada
-- pasajero (necesario para crear su boleto) solo vivía en memoria
-- durante el checkout -- se persiste para que confirmarPagoManual
-- pueda crear el boleto real horas después, con el desglose exacto.
ALTER TABLE "pasajeros_compra" ADD COLUMN "precio_pagado" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "pasajeros_compra" ADD COLUMN "tasa_terminal" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "pasajeros_compra" ADD COLUMN "cargo_plataforma" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "pasajeros_compra" ADD COLUMN "iva_monto" numeric(10, 2);
