-- API externa, fase B (07-oct-2026): viajes y asientos desde el sistema de la
-- cooperativa.
--
-- * viajes.referencia_externa: el identificador del viaje en el sistema de la
--   cooperativa. Permite crear o actualizar el viaje de forma idempotente (el
--   mismo envío dos veces no duplica nada) y reconciliar ambos sistemas.
-- * viaje_asientos.ocupado_por_cooperativa: el asiento lo vendió la
--   cooperativa en su ventanilla y lo reportó. Se distingue de un asiento
--   vendido por Klumbus para que la cooperativa solo pueda liberar lo que ella
--   misma ocupó, nunca una venta de Klumbus.
-- * viaje_asientos.referencia_externa: el boleto o venta de la cooperativa que
--   ocupa ese asiento.

ALTER TABLE "viajes" ADD COLUMN "referencia_externa" varchar(100);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_viajes_referencia_externa" ON "viajes" USING btree ("cooperativa_id","referencia_externa") WHERE "referencia_externa" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "viaje_asientos" ADD COLUMN "ocupado_por_cooperativa" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "viaje_asientos" ADD COLUMN "referencia_externa" varchar(100);
