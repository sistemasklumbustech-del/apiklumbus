-- Perfil público de la cooperativa (26-sep-2026) -- página "Cooperativas" del
-- menú: descripción corta, servicios que presta y beneficios para el pasajero.
-- La cooperativa los edita desde su panel; la flota (buses) y las ciudades que
-- sirve se calculan solas a partir de sus tipos de vehículo, unidades y rutas.
ALTER TABLE "cooperativas" ADD COLUMN "descripcion_publica" text;
--> statement-breakpoint
ALTER TABLE "cooperativas" ADD COLUMN "servicios_publicos" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "cooperativas" ADD COLUMN "beneficios_publicos" jsonb DEFAULT '[]'::jsonb NOT NULL;
