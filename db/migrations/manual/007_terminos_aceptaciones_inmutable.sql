-- Migración manual: terminos_aceptaciones insert-only de verdad, mismo
-- criterio que 003_auditoria_inmutable.sql y
-- 006_compras_transiciones_inmutable.sql.
--
-- RF-024 exige poder demostrar qué versión de los Términos aceptó cada
-- usuario/compra y cuándo -- un registro de aceptación legal que se
-- puede corregir con un UPDATE o borrar con un DELETE no sirve como
-- evidencia. terminos_condiciones también es insert-only (publicar una
-- versión nueva es un INSERT, nunca se edita una ya publicada), así que
-- se revoca el mismo privilegio ahí también.
REVOKE UPDATE, DELETE ON terminos_condiciones FROM ticketya_app;
REVOKE UPDATE, DELETE ON terminos_condiciones FROM ticketya_platform_admin;

REVOKE UPDATE, DELETE ON terminos_aceptaciones FROM ticketya_app;
REVOKE UPDATE, DELETE ON terminos_aceptaciones FROM ticketya_platform_admin;
