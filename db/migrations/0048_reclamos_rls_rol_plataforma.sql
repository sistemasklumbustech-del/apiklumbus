-- Corrección de 0047 (24-sep-2026) -- hallazgo real en producción: al
-- enviar un reclamo, el INSERT fallaba con "new row violates row-level
-- security policy for table reclamos" (500).
--
-- Causa: la política de 0047 solo cubría al rol ticketya_app. El
-- backend accede a esta tabla con la conexión del rol
-- ticketya_platform_admin (el pasajero y la cooperativa comparten el
-- mismo reclamo, así que el filtro por cooperativa/pasajero es
-- explícito en el código), y ese rol NUNCA tuvo BYPASSRLS en un
-- Postgres administrado -- ver el comentario de 0028, que ya
-- documentó este mismo problema y su solución: la excepción explícita
-- dentro de la propia política.
--
-- Se aplica ese mismo patrón: la política cubre a ambos roles, y el rol
-- de plataforma ve todas las filas; ticketya_app sigue aislado por
-- cooperativa como red de seguridad.
ALTER POLICY aislamiento_cooperativa_reclamos ON reclamos
  TO ticketya_app, ticketya_platform_admin
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);
