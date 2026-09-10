-- Correccion real (18-ago-2026, hallazgo del director probando la
-- compra VIP): el checkout no le mostraba al pasajero que su asiento
-- era VIP, aunque ya pagara el recargo. Fotografia fija del momento
-- de la compra, mismo criterio que cargoPlataforma/ivaMonto.
ALTER TABLE pasajeros_compra ADD COLUMN es_vip boolean NOT NULL DEFAULT false;
ALTER TABLE boletos ADD COLUMN es_vip boolean NOT NULL DEFAULT false;
