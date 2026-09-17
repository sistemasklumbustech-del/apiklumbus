-- Migración manual: hacer que compras_transiciones sea insert-only de
-- verdad, mismo criterio exacto que 003_auditoria_inmutable.sql.
--
-- RF-006 exige un historial de transiciones auditable -- un registro
-- que se puede corregir con un UPDATE/DELETE no es un historial de
-- verdad. La tabla no tiene columna de actualización (ver
-- schema/ventas.ts), pero eso por sí solo no impide un UPDATE/DELETE a
-- nivel de SQL. Se revoca explícitamente el privilegio para el rol de
-- aplicación, incluso aunque 002_grants_app_role.sql ya lo haya
-- otorgado de forma genérica sobre "ALL TABLES" -- esta migración corre
-- después y prevalece.
REVOKE UPDATE, DELETE ON compras_transiciones FROM ticketya_app;
REVOKE UPDATE, DELETE ON compras_transiciones FROM ticketya_platform_admin;
