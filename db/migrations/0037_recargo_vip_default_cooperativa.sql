-- Correccion real (18-ago-2026): recargo VIP como politica fija de
-- la cooperativa, no algo repetido en cada viaje. Confirmado con
-- evidencia real (soporte oficial de FlixBus: el precio de un
-- asiento premium depende del TIPO de asiento, no se redefine por
-- viaje).
ALTER TABLE cooperativas ADD COLUMN recargo_vip_default numeric(8, 2) NOT NULL DEFAULT 0;
