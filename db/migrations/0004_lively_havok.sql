ALTER TABLE "boletos" ADD COLUMN "cargo_plataforma" numeric(8, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "boletos" ADD COLUMN "iva_monto" numeric(8, 2) DEFAULT '0' NOT NULL;