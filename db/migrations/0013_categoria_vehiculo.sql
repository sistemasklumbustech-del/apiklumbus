-- Categoría de vehículo (29-jul-2026, hallazgo real del usuario): antes
-- "tipo de vehículo" era solo texto libre, sin categoría estructurada
-- detrás -- no se podía filtrar búsquedas por tipo. Nullable a
-- propósito: los tipos ya existentes no se recategorizan en silencio.
CREATE TYPE "public"."categoria_vehiculo" AS ENUM('bus', 'buseta', 'van', 'auto');
--> statement-breakpoint
ALTER TABLE "tipos_vehiculo" ADD COLUMN "categoria" "categoria_vehiculo";
