-- Migración manual: otorgar privilegios sobre `banners_propios` (tabla
-- creada después de la migración 002, así que no quedó incluida en su
-- GRANT ON ALL TABLES), y de paso resolver la causa raíz para que esto
-- no se repita con cada tabla nueva: ALTER DEFAULT PRIVILEGES hace que
-- cualquier tabla que se cree DE AHORA EN ADELANTE en el esquema
-- `public` reciba automáticamente estos mismos permisos para
-- ticketya_app y ticketya_platform_admin, sin necesitar una migración
-- manual como esta cada vez (22-jul-2026, hallazgo real en pruebas).

GRANT SELECT, INSERT, UPDATE, DELETE ON banners_propios TO ticketya_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON banners_propios TO ticketya_platform_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ticketya_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ticketya_platform_admin;
