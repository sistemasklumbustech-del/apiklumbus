-- Modelo B (02-ago-2026): 2 correcciones de esquema encontradas al
-- revisar api_externa.ts antes de construir el service/controller.
-- 1) webhookUrl -- faltaba el destino al que avisar la venta.
-- 2) apiKeyPrefix -- un hash no se puede buscar, solo verificar. Patrón
--    Stripe/GitHub: prefijo público en texto plano para el lookup rápido,
--    el resto de la llave sigue hasheado en api_key_hash.

ALTER TABLE "credenciales_api" ADD COLUMN "api_key_prefix" varchar(20);
--> statement-breakpoint

ALTER TABLE "credenciales_api" ADD COLUMN "webhook_url" text;
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_credenciales_api_prefix" ON "credenciales_api" USING btree ("api_key_prefix");
