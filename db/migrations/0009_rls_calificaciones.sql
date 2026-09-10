-- Corrige un hueco real de seguridad encontrado en auditoría (28-jul-2026):
-- la tabla calificaciones tiene columna cooperativa_id (NOT NULL) y SÍ está
-- en producción (módulo de calificaciones activo), pero nunca recibió una
-- política RLS como las otras 11 tablas multi-tenant del esquema original.
-- Hoy el aislamiento de esta tabla depende 100% de que el código de
-- aplicación jamás olvide el WHERE cooperativa_id = ... — sin red de
-- seguridad a nivel de base de datos. Esta migración cierra ese hueco,
-- replicando el mismo patrón usado para el resto de tablas multi-tenant.
--
-- Nota: comprobantes_electronicos y liquidaciones_cooperativa tienen el
-- mismo hueco pero NO están conectadas a ningún código de aplicación
-- todavía (son de Fase C — Facturación/Liquidaciones, aún sin construir).
-- Se recomienda agregarles su política RLS en el mismo momento en que se
-- implemente esa fase, no después.

ALTER TABLE "calificaciones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_calificaciones" ON "calificaciones"
  AS PERMISSIVE FOR ALL TO "ticketya_app"
  USING (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)
  WITH CHECK (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);
