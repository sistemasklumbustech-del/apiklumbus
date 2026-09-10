-- Migración manual: otorgar privilegios de datos al rol ticketya_app.
--
-- drizzle-kit genera CREATE ROLE para los roles declarados con pgRole(),
-- pero no genera GRANTs de privilegios sobre las tablas — eso se
-- considera responsabilidad de la migración de infraestructura/despliegue,
-- no del esquema de datos en sí. Sin este paso, el backend NestJS
-- conectado como ticketya_app no puede leer ni escribir ninguna tabla,
-- incluso con las políticas RLS ya creadas.
GRANT USAGE ON SCHEMA public TO ticketya_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ticketya_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ticketya_app;

GRANT USAGE ON SCHEMA public TO ticketya_platform_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ticketya_platform_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ticketya_platform_admin;
