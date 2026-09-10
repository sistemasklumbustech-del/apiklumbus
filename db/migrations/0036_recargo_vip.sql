-- Zona VIP de asientos (17-ago-2026). Orden real del director: monto
-- FIJO adicional (no porcentaje) para los asientos con etiqueta 'vip'
-- en tiposVehiculo.distribucionAsientos. Configurable por CADA
-- cooperativa en CADA viaje que crean, mismo nivel real que
-- precio_base -- nunca un valor de plataforma (los precios varían por
-- cooperativa y cambian con el tiempo, según sus propias tarifas
-- reales). Default 0, no NULL -- un viaje sin recargo VIP explícito
-- simplemente no cobra de más.

ALTER TABLE "viajes" ADD COLUMN "recargo_vip" numeric(8, 2) DEFAULT '0' NOT NULL;
