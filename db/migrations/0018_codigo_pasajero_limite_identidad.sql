-- Código de pasajero fijo + límite de frecuencia para nombre/cédula
-- (ítem 6, Fase 2, 03-ago-2026). Alcance confirmado por el director,
-- sección 3.1.1 del documento maestro.

ALTER TABLE "usuarios" ADD COLUMN "codigo_pasajero" varchar(12);
--> statement-breakpoint

ALTER TABLE "usuarios" ADD COLUMN "ultimo_cambio_identidad_en" timestamp with time zone;
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_usuarios_codigo_pasajero" ON "usuarios" USING btree ("codigo_pasajero");
