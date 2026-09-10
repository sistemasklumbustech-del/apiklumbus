-- Ítem 21/22, Fase 3 (06-ago-2026): catálogo cerrado de entidad
-- financiera para transferencia bancaria -- reemplaza el texto libre
-- sin estructura que vivía dentro de datos_cuenta (JSON), que no
-- permitía saber con certeza qué banco era cada configuración.

CREATE TYPE "public"."entidad_financiera" AS ENUM('banco_pichincha', 'banco_guayaquil', 'banco_pacifico', 'produbanco', 'banco_bolivariano', 'banco_internacional', 'diners_club', 'banco_ruminahui', 'coop_jep', 'coop_jardin_azuayo', 'otro');
--> statement-breakpoint

ALTER TABLE "metodos_pago_cooperativa" ADD COLUMN "entidad_financiera" "entidad_financiera";
