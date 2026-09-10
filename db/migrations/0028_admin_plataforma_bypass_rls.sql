-- Item pendiente cerrado (12-ago-2026) -- correccion real del acceso del
-- panel de administrador de plataforma (ticketya_platform_admin).
--
-- Hallazgo real: ese rol nunca pudo tener BYPASSRLS porque Postgres
-- exige que solo un rol que YA lo tiene pueda otorgarlo -- y en un
-- Postgres administrado (Render), el usuario de la app no lo tiene ni
-- puede tenerlo. En vez de depender de un permiso que nunca vamos a
-- poder otorgar, se agrega una excepcion explicita dentro de cada
-- politica: si la conexion es literalmente el rol
-- ticketya_platform_admin, ve todas las filas: si no, se filtra por
-- cooperativa como siempre. No depende de ningun superusuario.
--
-- Ademas, calificaciones tenia una politica de aislamiento sobrante,
-- que contradice su propio diseno documentado (es contenido
-- multi-cooperativa a proposito, sin aislamiento) -- se elimina.

ALTER POLICY aislamiento_cooperativa_boletos ON boletos
  TO ticketya_app, ticketya_platform_admin
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);

ALTER POLICY aislamiento_cooperativa_conductores ON conductores
  TO ticketya_app, ticketya_platform_admin
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);

ALTER POLICY aislamiento_cooperativa_credenciales_api ON credenciales_api
  TO ticketya_app, ticketya_platform_admin
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);

ALTER POLICY aislamiento_cooperativa_reservas_api_externas ON reservas_api_externas
  TO ticketya_app, ticketya_platform_admin
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);

ALTER POLICY aislamiento_cooperativa_rutas ON rutas
  TO ticketya_app, ticketya_platform_admin
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);

ALTER POLICY aislamiento_cooperativa_tipos_vehiculo ON tipos_vehiculo
  TO ticketya_app, ticketya_platform_admin
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);

ALTER POLICY aislamiento_cooperativa_unidades ON unidades
  TO ticketya_app, ticketya_platform_admin
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);

ALTER POLICY aislamiento_cooperativa_viajes ON viajes
  TO ticketya_app, ticketya_platform_admin
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);

ALTER POLICY aislamiento_cooperativa_webhooks_log ON webhooks_log
  TO ticketya_app, ticketya_platform_admin
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);

ALTER POLICY aislamiento_cooperativa_usuarios ON usuarios
  TO ticketya_app, ticketya_platform_admin
  USING (current_user = 'ticketya_platform_admin' OR cooperativa_id IS NULL OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (current_user = 'ticketya_platform_admin' OR cooperativa_id IS NULL OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);

ALTER POLICY aislamiento_cooperativa_viaje_asientos ON viaje_asientos
  TO ticketya_app, ticketya_platform_admin
  USING (current_user = 'ticketya_platform_admin' OR viaje_id IN (SELECT viajes.id FROM viajes WHERE viajes.cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid))
  WITH CHECK (current_user = 'ticketya_platform_admin' OR viaje_id IN (SELECT viajes.id FROM viajes WHERE viajes.cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));

DROP POLICY IF EXISTS aislamiento_cooperativa_calificaciones ON calificaciones;
