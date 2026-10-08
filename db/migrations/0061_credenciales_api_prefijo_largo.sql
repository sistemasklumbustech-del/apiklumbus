-- Corrección (07-oct-2026) -- hallazgo al probar la API externa de punta a punta:
-- crear una llave API desde el panel de la cooperativa devolvía 500.
--
-- Causa: el prefijo público de la llave se arma como "tkya_live_" + 12
-- caracteres (22 en total) pero la columna api_key_prefix era varchar(20)
-- (migración 0017), así que el INSERT siempre fallaba con "value too long".
-- Ninguna cooperativa podía generar su llave, y sin ella no hay Modelo B.
--
-- Se ensancha a 32. No cambia ningún dato existente.
ALTER TABLE "credenciales_api" ALTER COLUMN "api_key_prefix" TYPE varchar(32);
