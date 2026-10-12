-- 12-oct-2026: Row-Level Security en las tablas de una cooperativa que todavía no lo tenían.
--
-- Hallazgo de la auditoría de seguridad: de las tablas con `cooperativa_id`, seis quedaron sin RLS
-- (algunas se crearon después de la migración 0028 que fijó el patrón), así que el rol de la
-- aplicación (`ticketya_app`) podía leer y escribir filas de cualquier cooperativa si una consulta
-- olvidaba el filtro. Entre ellas, las cuentas bancarias de cobro (metodos_pago_cooperativa).
--
-- Mismo patrón que el resto de la plataforma (ver db/schema/rls.ts): el rol de plataforma
-- (`ticketya_platform_admin`) lo ve todo por la excepción explícita dentro de la política (un
-- Postgres administrado no deja usar BYPASSRLS) y `ticketya_app` solo ve las filas de la
-- cooperativa fijada en `app.current_cooperativa_id` -- si no hay ninguna, no ve ninguna.
--
-- Se verificó que todas las consultas a estas tablas usan la conexión de plataforma o fijan la
-- cooperativa (ejecutarComoCooperativa), así que ningún flujo existente cambia.

-- Tablas con cooperativa_id propia ------------------------------------------------------------
ALTER TABLE "calificaciones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_calificaciones" ON "calificaciones" AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin" USING ((current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)) WITH CHECK ((current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE "comprobantes_electronicos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_comprobantes_electronicos" ON "comprobantes_electronicos" AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin" USING ((current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)) WITH CHECK ((current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE "creditos_pasajero" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_creditos_pasajero" ON "creditos_pasajero" AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin" USING ((current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)) WITH CHECK ((current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE "liquidaciones_cooperativa" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_liquidaciones_cooperativa" ON "liquidaciones_cooperativa" AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin" USING ((current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)) WITH CHECK ((current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE "metodos_pago_cooperativa" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_metodos_pago_cooperativa" ON "metodos_pago_cooperativa" AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin" USING ((current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)) WITH CHECK ((current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE "tareas_postpago" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_tareas_postpago" ON "tareas_postpago" AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin" USING ((current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)) WITH CHECK ((current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));
--> statement-breakpoint

-- Tablas hijas: pertenecen a una cooperativa a través de su padre -----------------------------
-- Horarios recurrentes de una ruta (mismo patrón que ruta_paradas).
ALTER TABLE "horarios_ruta" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_horarios_ruta" ON "horarios_ruta" AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin" USING (current_user = 'ticketya_platform_admin' OR ruta_id IN (SELECT id FROM rutas WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)) WITH CHECK (current_user = 'ticketya_platform_admin' OR ruta_id IN (SELECT id FROM rutas WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));
--> statement-breakpoint
-- Solicitudes de factura del pasaje: de la cooperativa dueña del boleto.
ALTER TABLE "solicitudes_factura_cooperativa" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_solicitudes_factura" ON "solicitudes_factura_cooperativa" AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin" USING (current_user = 'ticketya_platform_admin' OR boleto_id IN (SELECT id FROM boletos WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)) WITH CHECK (current_user = 'ticketya_platform_admin' OR boleto_id IN (SELECT id FROM boletos WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));
--> statement-breakpoint
-- Ajustes de liquidación: de la cooperativa dueña de la liquidación. Los ajustes de una
-- liquidación de terminal (sin cooperativa) solo los ve la plataforma.
ALTER TABLE "ajustes_liquidacion" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_ajustes_liquidacion" ON "ajustes_liquidacion" AS PERMISSIVE FOR ALL TO "ticketya_app", "ticketya_platform_admin" USING (current_user = 'ticketya_platform_admin' OR liquidacion_cooperativa_id IN (SELECT id FROM liquidaciones_cooperativa WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)) WITH CHECK (current_user = 'ticketya_platform_admin' OR liquidacion_cooperativa_id IN (SELECT id FROM liquidaciones_cooperativa WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));
