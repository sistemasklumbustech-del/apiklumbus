-- 12-oct-2026: cifrado de datos sensibles a nivel de columna (ver api/src/infraestructura/seguridad/datos-sensibles.ts).
-- El valor cifrado es más largo que el original ("enc:v1:" + base64), así que las dos columnas
-- pasan de varchar(n) a text. Cambiar varchar a text no reescribe la tabla.
--
-- Los valores que ya existen siguen en texto plano hasta que corra el script
-- `cifrar-datos-sensibles` (lo ejecuta el deploy); el código lee los dos formatos.
ALTER TABLE "cuentas_cobro_cooperativa" ALTER COLUMN "numero_cuenta" TYPE text;
--> statement-breakpoint
ALTER TABLE "pasajeros_compra" ALTER COLUMN "numero_documento_discapacidad" TYPE text;
