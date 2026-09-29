-- Se agrega "internacional" a la clasificación del servicio (29-sep-2026):
-- la LOTTTSV/ANT también reconoce el transporte terrestre internacional
-- (rutas a otros países) como categoría propia, y el director pidió
-- incluirla junto a intercantonal e interprovincial.
--
-- Misma lógica que 0055: no se edita la 1.1 (insert-only), se agrega la 1.2
-- como nueva versión vigente desde hoy.
INSERT INTO "terminos_condiciones" ("version", "contenido", "vigente_desde") VALUES (
  '1.2',
  $$1. Qué es Klumbus
Klumbus es una plataforma que te permite buscar, comparar y comprar boletos de bus intercantonal, interprovincial e internacional de distintas cooperativas de transporte. Klumbus no opera los buses ni presta el servicio de transporte directamente -- cada viaje lo realiza la cooperativa de transporte correspondiente, que es la responsable de su propia flota, horarios, y cumplimiento de las normas de transporte terrestre vigentes en Ecuador.

2. Tu cuenta
Puedes comprar un boleto con o sin crear una cuenta. Si creas una cuenta, eres responsable de mantener segura tu contraseña y de la actividad que ocurra bajo tu usuario. Debes darnos información real y actualizada -- especialmente tu cédula o pasaporte, ya que es el dato con el que se valida tu identidad al abordar.

3. Compra de boletos
Al comprar un boleto, el precio final que ves antes de pagar incluye la tarifa del pasaje, la tasa de terminal (cuando aplica), el cargo de la plataforma, y el IVA según corresponda. Los descuentos legales (menor de edad, tercera edad, discapacidad) se calculan según lo que exige la normativa ecuatoriana vigente.

4. Cancelaciones y reprogramaciones
Cada cooperativa define su propia política de cancelación y reprogramación -- algunas la permiten con cierto límite de horas antes del viaje, otras no. Esa política se te muestra siempre antes de confirmar tu compra. Klumbus no puede anular la política que la cooperativa haya definido para su propio servicio.

5. Tu responsabilidad como pasajero
- Llegar a tiempo al punto de embarque con tu documento de identidad.
- Mostrar tu código QR o el código de tu boleto al personal de la cooperativa.
- Respetar las normas internas de cada unidad de transporte.
- En viajes internacionales, cumplir además con los requisitos migratorios y aduaneros del país de destino y de tránsito (pasaporte vigente, visa si aplica) -- Klumbus no es responsable de tu ingreso a otro país.

6. Cambios a estos Términos
Podemos actualizar estos Términos conforme la plataforma crece. Si el cambio es significativo, te lo haremos saber de forma visible en el sitio.

7. Contacto
Si tienes dudas sobre estos Términos, puedes escribirnos a través de los datos de contacto que aparecen en el pie de página de este sitio.$$,
  now()
);
