-- Correccion urgente (12-ago-2026) -- error real introducido por la
-- migracion 0028: eliminar la unica politica de calificaciones dejo
-- la tabla con RLS activo y CERO politicas, que en Postgres significa
-- "nadie entra" (excepto el dueno o BYPASSRLS), no "sin restriccion".
-- La intencion real (calificaciones es contenido multi-cooperativa a
-- proposito, sin aislamiento) se logra desactivando RLS del todo en
-- esta tabla, no dejandolo activo sin ninguna politica.
ALTER TABLE calificaciones DISABLE ROW LEVEL SECURITY;
