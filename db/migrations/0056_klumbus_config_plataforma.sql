-- Corrección de nombre (29-sep-2026): la fila de configuración de la
-- plataforma se creó con el nombre anterior de la marca ("Columbus") como
-- placeholder mientras no hay RUC real -- ese texto aparece en la factura
-- que la plataforma emite por su cargo de servicio. Se corrige el dato ya
-- guardado; el condicional evita tocar nada si alguna cooperativa ya lo
-- hubiera reemplazado por un valor real.
UPDATE "configuracion_plataforma"
SET "razon_social_plataforma" = 'Klumbus (pendiente RUC real)'
WHERE "razon_social_plataforma" = 'Columbus (pendiente RUC real)';
