-- Ítem 11, Fase 2 (04-ago-2026): campo de amenidades en tipos_vehiculo
-- + filtros de búsqueda por hora, tipo de vehículo y amenidades.
-- Catálogo cerrado, decisión del director (30-jul-2026, sección 3.2):
-- WiFi, aire acondicionado, baño a bordo, cargadores, asientos
-- reclinables, TV.

CREATE TYPE "public"."amenidad" AS ENUM('wifi', 'aire_acondicionado', 'bano_a_bordo', 'cargadores', 'asientos_reclinables', 'tv');
--> statement-breakpoint

ALTER TABLE "tipos_vehiculo" ADD COLUMN "amenidades" "amenidad"[] DEFAULT '{}' NOT NULL;
