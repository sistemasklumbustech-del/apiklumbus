-- Item 31.1, Fase 7 (13-ago-2026) -- validacion real de datos del
-- pasajero en checkout: cedula (algoritmo Modulo 10 real)/pasaporte
-- con selector explicito, nombres y apellidos separados en 2 campos
-- reales, y atencion preferente para embarazadas (LOTTTSV Art. 48 --
-- confirmado que es prioridad/accesibilidad, NO descuento de tarifa,
-- por eso vive separado de tipo_tarifa).

CREATE TYPE tipo_documento AS ENUM ('cedula', 'pasaporte');

ALTER TABLE pasajeros_compra ADD COLUMN nombres varchar(100);
ALTER TABLE pasajeros_compra ADD COLUMN apellidos varchar(100);
ALTER TABLE pasajeros_compra ADD COLUMN tipo_documento tipo_documento NOT NULL DEFAULT 'cedula';
ALTER TABLE pasajeros_compra ADD COLUMN es_embarazada boolean NOT NULL DEFAULT false;

-- Relleno de filas ya existentes (heuristica: primera palabra =
-- nombres, resto = apellidos -- unica manera razonable de dividir
-- retroactivamente un campo que antes era libre; toda fila NUEVA
-- desde ahora ya trae los 2 campos reales por separado desde el
-- formulario, sin depender de esta heuristica).
UPDATE pasajeros_compra
SET nombres = split_part(nombre_completo, ' ', 1),
    apellidos = trim(substring(nombre_completo from position(' ' in nombre_completo) + 1))
WHERE nombres IS NULL AND position(' ' in nombre_completo) > 0;

UPDATE pasajeros_compra
SET nombres = nombre_completo,
    apellidos = ''
WHERE nombres IS NULL;

ALTER TABLE pasajeros_compra ALTER COLUMN nombres SET NOT NULL;
ALTER TABLE pasajeros_compra ALTER COLUMN apellidos SET NOT NULL;

ALTER TABLE pasajeros_compra DROP COLUMN nombre_completo;
