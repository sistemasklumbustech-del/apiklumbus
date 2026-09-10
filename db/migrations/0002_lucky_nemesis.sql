ALTER TYPE "public"."accion_auditoria" ADD VALUE 'actualizacion_iva_nacional';--> statement-breakpoint
ALTER TABLE "configuracion_plataforma" ADD COLUMN "iva_porcentaje_nacional" numeric(5, 2) DEFAULT '15.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "cooperativas" ADD COLUMN "iva_sigue_tasa_nacional" boolean DEFAULT true NOT NULL;