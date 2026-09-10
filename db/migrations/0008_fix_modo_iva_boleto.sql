-- Corrige un desfase real entre schema/configuracion.ts y las migraciones
-- aplicadas: la columna modo_iva_boleto se agregó manualmente en pgAdmin
-- (ver etapa_a_schema_iva_boleto.ps1, línea 2) pero nunca se generó ni
-- comprometió la migración correspondiente. Resultado verificado en
-- auditoría del 28-jul-2026: cualquier base de datos creada desde cero
-- a partir de las migraciones versionadas (Render, CI, otra máquina)
-- carece de esta columna, y CheckoutService.procesarCompra() falla con
-- 500 Internal Server Error en el 100% de los intentos de compra.
ALTER TABLE "configuracion_plataforma" ADD COLUMN "modo_iva_boleto" varchar(20) DEFAULT 'calculado' NOT NULL;
--> statement-breakpoint
ALTER TABLE "configuracion_plataforma" ADD CONSTRAINT "chk_modo_iva_boleto" CHECK ("configuracion_plataforma"."modo_iva_boleto" IN ('calculado', 'cero', 'oculto'));
