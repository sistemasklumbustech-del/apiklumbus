-- Contacto de soporte global de la plataforma (13-ago-2026). Decisión
-- real del director, investigada contra FlixBus (mismo modelo: una
-- plataforma, muchos operadores independientes -- el soporte se
-- centraliza en la marca de la plataforma, no en cada operador).
-- Nullable, sin valor por defecto -- hasta que el director los
-- configure.

ALTER TYPE "accion_auditoria" ADD VALUE IF NOT EXISTS 'cambio_contacto_soporte';
--> statement-breakpoint

ALTER TABLE "configuracion_plataforma" ADD COLUMN "soporte_correo" varchar(200);
--> statement-breakpoint
ALTER TABLE "configuracion_plataforma" ADD COLUMN "soporte_telefono" varchar(20);
