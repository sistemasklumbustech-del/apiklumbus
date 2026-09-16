-- Vincula comprobantes_tasa_terminal (1 por boleto, RF-TICKET-002) con
-- registros_tasa_terminal (1 por compra, auditoría real de la llamada a
-- SIAT3000 setVentaPasaje). Derpacif confirmó que la tasa se genera una
-- vez por venta completa, no una vez por pasajero -- este FK deja
-- explícito y auditable que varios boletos de una misma compra comparten
-- la misma fila de registro (y el mismo código de tasa), en vez de
-- depender de que las cadenas de `codigoVerificacion` coincidan.
--
-- Sin riesgo de datos: comprobantes_tasa_terminal nunca tuvo ningún
-- proceso que escribiera en ella todavía (solo se lee, con LEFT JOIN,
-- desde compra.repositorio.drizzle.ts) -- columna NOT NULL sin backfill
-- necesario.

ALTER TABLE "comprobantes_tasa_terminal" ADD COLUMN "registro_tasa_terminal_id" uuid NOT NULL;
--> statement-breakpoint

ALTER TABLE "comprobantes_tasa_terminal" ADD CONSTRAINT "comprobantes_tasa_terminal_registro_tasa_terminal_id_fk"
  FOREIGN KEY ("registro_tasa_terminal_id") REFERENCES "public"."registros_tasa_terminal"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_comprobantes_tasa_terminal_registro" ON "comprobantes_tasa_terminal" USING btree ("registro_tasa_terminal_id");
