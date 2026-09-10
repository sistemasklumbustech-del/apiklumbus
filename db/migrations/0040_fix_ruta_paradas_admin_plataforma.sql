-- Correccion real de un error propio (20-ago-2026): la migracion
-- 0039 copio el patron VIEJO y ya obsoleto de listar
-- ticketya_platform_admin en el TO de la politica, esperando que eso
-- le diera acceso total -- pero eso nunca funciona, ver el hallazgo
-- real ya documentado en la migracion 0028: en un Postgres
-- administrado (Render), BYPASSRLS nunca se le puede otorgar de
-- verdad a un rol de la app. El patron correcto real (ya usado en
-- 0028 para boletos, rutas, viajes, viaje_asientos, etc.) es una
-- excepcion EXPLICITA dentro de la propia condicion USING/WITH CHECK:
-- current_user = 'ticketya_platform_admin' OR <condicion normal>.
--
-- Detectado con evidencia real: la prueba e2e nueva
-- (paradas-intermedias.e2e-spec.ts) pasaba siempre en local (donde
-- el rol tenia BYPASSRLS de alguna configuracion vieja, ocultando el
-- error real) pero fallaba consistentemente en CI (Postgres limpio,
-- sin ese permiso de casualidad) -- el endpoint publico
-- (DRIZZLE_DB_PUBLICO, rol ticketya_platform_admin) no podia ver
-- ninguna parada real, aunque la cooperativa dueña si las veia.

ALTER POLICY "aislamiento_cooperativa_ruta_paradas" ON "ruta_paradas"
  TO "ticketya_app", "ticketya_platform_admin"
  USING (current_user = 'ticketya_platform_admin' OR ruta_id IN (SELECT id FROM rutas WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid))
  WITH CHECK (current_user = 'ticketya_platform_admin' OR ruta_id IN (SELECT id FROM rutas WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));
