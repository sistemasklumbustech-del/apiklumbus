-- Vacío real de diseño encontrado el 29-jul-2026: cooperativas ya
-- tenía su propio logo, los terminales no. Se agrega para que la
-- plataforma se vea profesional en cada punto de operación.
ALTER TABLE "puntos_operacion" ADD COLUMN "logo_url" text;
