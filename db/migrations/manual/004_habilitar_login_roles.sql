-- Migración manual: habilitar inicio de sesión para los roles de
-- aplicación.
--
-- drizzle-kit genera CREATE ROLE sin el atributo LOGIN (por diseño de
-- Postgres, un rol nuevo no puede conectarse hasta que se le dé permiso
-- explícito). Sin esto, el backend NO PUEDE conectarse como
-- ticketya_app ni como ticketya_platform_admin — solo puede conectarse
-- como un superusuario de Postgres, lo cual anula silenciosamente TODAS
-- las políticas RLS (los superusuarios las ignoran por diseño de
-- Postgres). Este es exactamente el motivo por el que hasta ahora el
-- backend funcionaba pero sin RLS realmente activo.
--
-- ⚠ Reemplaza los placeholders de contraseña por contraseñas reales
-- antes de correr esto en cualquier ambiente que no sea tu compu de
-- desarrollo personal. En desarrollo local, cualquier valor sirve.
ALTER ROLE ticketya_app WITH LOGIN PASSWORD 'cambia_esta_contrasena_app';
ALTER ROLE ticketya_platform_admin WITH LOGIN PASSWORD 'cambia_esta_contrasena_admin';
