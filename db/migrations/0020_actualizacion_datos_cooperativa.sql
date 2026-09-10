-- Ítem 10, Fase 2 (04-ago-2026): actualización periódica obligatoria de
-- datos de cooperativa (sección 3.7 del documento maestro). Decisión
-- confirmada por el director:
-- - Campos: razón social, RUC, dirección legal, teléfono y correo de
--   contacto. NO incluye datos operativos (rutas, flota, precios).
-- - 6 meses sin confirmar -> banner de advertencia (no bloqueante).
-- - 12 meses de silencio total -> se bloquea SOLO la creación de
--   horarios recurrentes nuevos y la carga masiva. Nunca venta,
--   validación de boletos, ni confirmación de pagos.
--
-- Hallazgo real: el esquema no tenía ninguna columna de "dirección
-- legal" -- se agrega aquí junto con la marca de tiempo.

ALTER TABLE "cooperativas" ADD COLUMN "direccion_legal" text;
--> statement-breakpoint

ALTER TABLE "cooperativas" ADD COLUMN "datos_actualizados_en" timestamp with time zone;
