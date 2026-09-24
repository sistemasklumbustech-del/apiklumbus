-- RF-021 -- auditoria completa (24-sep-2026). auditoria_admin solo
-- registraba operaciones administrativas de un usuario identificado.
-- Ahora tambien guarda: desde que IP y navegador se hizo, si la accion
-- resulto bien o fallo, y si la hizo una persona o el propio sistema
-- (tareas programadas, sin usuario). Por eso usuario_id y entidad_id
-- pasan a ser opcionales: un intento de inicio de sesion con un correo
-- que no existe no tiene usuario ni entidad, y una tarea automatica
-- tampoco tiene usuario. La tabla sigue siendo insert-only (ver
-- manual/003_auditoria_inmutable.sql).

ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'inicio_sesion';
--> statement-breakpoint
ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'generacion_viajes';
--> statement-breakpoint
ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'resolucion_reclamo';
--> statement-breakpoint
ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'confirmacion_pago_manual';
--> statement-breakpoint
ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'rechazo_pago_manual';
--> statement-breakpoint

ALTER TABLE "auditoria_admin" ALTER COLUMN "usuario_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "auditoria_admin" ALTER COLUMN "entidad_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "auditoria_admin" ADD COLUMN "direccion_ip" varchar(45);
--> statement-breakpoint
ALTER TABLE "auditoria_admin" ADD COLUMN "user_agent" varchar(300);
--> statement-breakpoint
ALTER TABLE "auditoria_admin" ADD COLUMN "resultado" varchar(10) DEFAULT 'exito' NOT NULL;
--> statement-breakpoint
ALTER TABLE "auditoria_admin" ADD COLUMN "origen" varchar(10) DEFAULT 'usuario' NOT NULL;
--> statement-breakpoint
ALTER TABLE "auditoria_admin" ADD CONSTRAINT "chk_auditoria_resultado" CHECK ("resultado" IN ('exito', 'fallo'));
--> statement-breakpoint
ALTER TABLE "auditoria_admin" ADD CONSTRAINT "chk_auditoria_origen" CHECK ("origen" IN ('usuario', 'sistema'));
--> statement-breakpoint

CREATE INDEX "idx_auditoria_admin_creado_en" ON "auditoria_admin" USING btree ("creado_en" DESC);
--> statement-breakpoint
CREATE INDEX "idx_auditoria_admin_resultado_origen" ON "auditoria_admin" USING btree ("resultado", "origen");
