-- RF-024 -- versionado de Términos y Condiciones y registro de quién
-- aceptó cada versión. Ver comentario completo del diseño en
-- db/schema/terminos.ts (por qué es insert-only, por qué la versión
-- vigente se calcula en vez de marcarse con un booleano, por qué
-- usuario_id y compra_id son ambos nullable con un CHECK).

CREATE TABLE "terminos_condiciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" varchar(20) NOT NULL,
	"contenido" text NOT NULL,
	"vigente_desde" timestamp with time zone NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terminos_condiciones_version_unique" UNIQUE("version")
);
--> statement-breakpoint

CREATE INDEX "idx_terminos_condiciones_vigente_desde" ON "terminos_condiciones" USING btree ("vigente_desde");
--> statement-breakpoint

CREATE TABLE "terminos_aceptaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminos_version_id" uuid NOT NULL,
	"usuario_id" uuid,
	"compra_id" uuid,
	"direccion_ip" varchar(45),
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_terminos_aceptacion_actor" CHECK ("usuario_id" IS NOT NULL OR "compra_id" IS NOT NULL)
);
--> statement-breakpoint

ALTER TABLE "terminos_aceptaciones" ADD CONSTRAINT "terminos_aceptaciones_terminos_version_id_terminos_condiciones_id_fk"
  FOREIGN KEY ("terminos_version_id") REFERENCES "public"."terminos_condiciones"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "terminos_aceptaciones" ADD CONSTRAINT "terminos_aceptaciones_usuario_id_usuarios_id_fk"
  FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "terminos_aceptaciones" ADD CONSTRAINT "terminos_aceptaciones_compra_id_compras_id_fk"
  FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_terminos_aceptaciones_usuario" ON "terminos_aceptaciones" USING btree ("usuario_id");
--> statement-breakpoint
CREATE INDEX "idx_terminos_aceptaciones_compra" ON "terminos_aceptaciones" USING btree ("compra_id");
--> statement-breakpoint
CREATE INDEX "idx_terminos_aceptaciones_version" ON "terminos_aceptaciones" USING btree ("terminos_version_id");
--> statement-breakpoint

-- Versión inicial (1.0) -- mismo contenido que ya vive hoy en la
-- página estática columbus-web/app/terminos/page.tsx (borrador de
-- buena fe, no revisión legal formal), para que la tabla nunca quede
-- vacía: sin esto, registro y checkout de invitado quedarían
-- bloqueados apenas se aplique esta migración (RF-024 exige una
-- versión vigente para poder registrar una aceptación). vigente_desde
-- usa la misma fecha que ya mostraba esa página ("agosto de 2026").
INSERT INTO "terminos_condiciones" ("version", "contenido", "vigente_desde") VALUES (
  '1.0',
  $$1. Qué es Columbus
Columbus es una plataforma que te permite buscar, comparar y comprar boletos de bus intermunicipal de distintas cooperativas de transporte. Columbus no opera los buses ni presta el servicio de transporte directamente -- cada viaje lo realiza la cooperativa de transporte correspondiente, que es la responsable de su propia flota, horarios, y cumplimiento de las normas de transporte terrestre vigentes en Ecuador.

2. Tu cuenta
Puedes comprar un boleto con o sin crear una cuenta. Si creas una cuenta, eres responsable de mantener segura tu contraseña y de la actividad que ocurra bajo tu usuario. Debes darnos información real y actualizada -- especialmente tu cédula o pasaporte, ya que es el dato con el que se valida tu identidad al abordar.

3. Compra de boletos
Al comprar un boleto, el precio final que ves antes de pagar incluye la tarifa del pasaje, la tasa de terminal (cuando aplica), el cargo de la plataforma, y el IVA según corresponda. Los descuentos legales (menor de edad, tercera edad, discapacidad) se calculan según lo que exige la normativa ecuatoriana vigente.

4. Cancelaciones y reprogramaciones
Cada cooperativa define su propia política de cancelación y reprogramación -- algunas la permiten con cierto límite de horas antes del viaje, otras no. Esa política se te muestra siempre antes de confirmar tu compra. Columbus no puede anular la política que la cooperativa haya definido para su propio servicio.

5. Tu responsabilidad como pasajero
- Llegar a tiempo al punto de embarque con tu documento de identidad.
- Mostrar tu código QR o el código de tu boleto al personal de la cooperativa.
- Respetar las normas internas de cada unidad de transporte.

6. Cambios a estos Términos
Podemos actualizar estos Términos conforme la plataforma crece. Si el cambio es significativo, te lo haremos saber de forma visible en el sitio.

7. Contacto
Si tienes dudas sobre estos Términos, puedes escribirnos a través de los datos de contacto que aparecen en el pie de página de este sitio.$$,
  '2026-08-20 00:00:00-05'
);
