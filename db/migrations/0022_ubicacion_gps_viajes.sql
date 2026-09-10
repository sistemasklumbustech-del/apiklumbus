-- Ítem 16, Fase 2 (05-ago-2026): seguimiento GPS en vivo -- "cableado"
-- genérico, mismo criterio que Modelo B (ítem 4). Última posición
-- conocida por viaje, no un historial completo del trayecto.

ALTER TABLE "viajes" ADD COLUMN "ubicacion_latitud" numeric(10, 7);
--> statement-breakpoint

ALTER TABLE "viajes" ADD COLUMN "ubicacion_longitud" numeric(10, 7);
--> statement-breakpoint

ALTER TABLE "viajes" ADD COLUMN "ubicacion_actualizada_en" timestamptz;
