-- Captura real de documento de discapacidad (13-ago-2026). El 50% de
-- descuento ya es el número legal correcto (Reglamento LOD Art. 22,
-- excepción explícita para transporte) -- el hueco real que esto
-- cierra es que hasta hoy no se capturaba ni el número de carné
-- CONADIS/MSP ni el de cédula (donde ya conste la condición desde que
-- el carné físico dejó de emitirse el 31-dic-2024). Mismo patrón que
-- ya existe para menores de edad: se declara en el checkout, se
-- verifica físicamente en el andén -- nunca contra un sistema externo.

ALTER TABLE "pasajeros_compra" ADD COLUMN "numero_documento_discapacidad" varchar(20);
