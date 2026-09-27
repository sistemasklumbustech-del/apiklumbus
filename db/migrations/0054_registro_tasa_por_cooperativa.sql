-- Corrección (26-sep-2026) -- hallazgo real en producción: una compra de ida
-- y vuelta cuyos dos viajes son de cooperativas DISTINTAS fallaba con
-- "duplicate key value violates unique constraint uq_registros_tasa_terminal_compra"
-- (500 al confirmar el pago).
--
-- Causa: el registro de la tasa de terminal es uno por compra Y por
-- cooperativa (cada cooperativa lo escribe en su propia transacción, con su
-- propio aislamiento), pero el índice único era solo por compra: el registro
-- de la segunda cooperativa chocaba con el de la primera.
--
-- Solución: la unicidad pasa a ser por (compra, cooperativa). Las compras de
-- una sola cooperativa no cambian.
DROP INDEX IF EXISTS "uq_registros_tasa_terminal_compra";
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_registros_tasa_terminal_compra_cooperativa"
  ON "registros_tasa_terminal" USING btree ("compra_id", "cooperativa_id");
