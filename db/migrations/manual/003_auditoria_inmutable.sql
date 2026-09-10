-- Migración manual: hacer que auditoria_admin sea insert-only de verdad.
--
-- RF-ADMIN-005 exige "sin posibilidad de edición retroactiva del
-- registro". La tabla no tiene columna de actualización (ver
-- schema/admin.ts), pero eso por sí solo no impide un UPDATE/DELETE a
-- nivel de SQL. Se revoca explícitamente ese privilegio para el rol de
-- aplicación, incluso aunque 002_grants_app_role.sql ya lo haya otorgado
-- de forma genérica sobre "ALL TABLES" — esta migración corre después y
-- prevalece.
REVOKE UPDATE, DELETE ON auditoria_admin FROM ticketya_app;
REVOKE UPDATE, DELETE ON auditoria_admin FROM ticketya_platform_admin;
