CREATE TABLE "banners_propios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"titulo" varchar(100) NOT NULL,
	"imagen_url" text NOT NULL,
	"enlace_url" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cooperativas" ADD COLUMN "logo_url" text;--> statement-breakpoint
CREATE INDEX "idx_banners_propios_activo" ON "banners_propios" USING btree ("activo");