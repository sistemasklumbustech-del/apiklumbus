-- Asientos exclusivos para mujeres (25-sep-2026). Para poder hacer cumplir
-- la marca "mujeres" de un asiento, el pasajero declara su sexo al comprar.
-- Solo se exige cuando el asiento elegido es exclusivo para mujeres; en el
-- resto de compras queda vacío (nullable) para no pedir un dato que no se usa.
CREATE TYPE "public"."sexo_pasajero" AS ENUM('femenino', 'masculino');
--> statement-breakpoint
ALTER TABLE "pasajeros_compra" ADD COLUMN "sexo" "sexo_pasajero";
