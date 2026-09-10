-- Distancia real en kilometros de cada ruta -- hallazgo real del
-- director (21-ago-2026): pidio ver cuantos km hay de origen a
-- destino como dato informativo en la tarjeta de resultados, mismo
-- criterio que la duracion estimada que ya existia.
ALTER TABLE "rutas" ADD COLUMN "distancia_km" integer;
