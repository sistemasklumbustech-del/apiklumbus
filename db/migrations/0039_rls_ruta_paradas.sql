-- Correccion real de seguridad (20-ago-2026): ruta_paradas nunca tuvo
-- RLS activado desde la migracion 0000. Antes de construir el CRUD
-- real de paradas intermedias, se cierra este hueco -- mismo patron
-- real ya usado en viaje_asientos (aislamiento via el padre, ya que
-- esta tabla no tiene su propia columna cooperativa_id).
ALTER TABLE ruta_paradas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aislamiento_cooperativa_ruta_paradas" ON "ruta_paradas"
  AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin"
  USING (ruta_id IN (SELECT id FROM rutas WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid))
  WITH CHECK (ruta_id IN (SELECT id FROM rutas WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));
