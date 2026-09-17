-- RF-006 -- estado explícito de orden, independiente de inferir el
-- estado combinando pagos.estado + boletos.estado a ojo (que es como
-- funcionaba hasta hoy). Ver comentario completo del mapeo real en
-- db/schema/enums.ts (estadoCompraEnum).
--
-- Todas las compras existentes (si las hay) quedan en 'iniciada' por el
-- DEFAULT -- no se puede reconstruir retroactivamente en qué punto
-- exacto del flujo real quedó cada una sin inventar datos.

CREATE TYPE "public"."estado_compra" AS ENUM(
  'iniciada',
  'pendiente_pago',
  'pagada',
  'boleto_confirmado',
  'tasa_confirmada',
  'completada',
  'fallida',
  'reembolsada',
  'reversada'
);
--> statement-breakpoint

ALTER TABLE "compras" ADD COLUMN "estado" "estado_compra" DEFAULT 'iniciada' NOT NULL;
--> statement-breakpoint

CREATE INDEX "idx_compras_estado" ON "compras" USING btree ("estado");
--> statement-breakpoint

CREATE TABLE "compras_transiciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"compra_id" uuid NOT NULL,
	"estado_anterior" "estado_compra",
	"estado_nuevo" "estado_compra" NOT NULL,
	"actor_usuario_id" uuid,
	"actor_sistema" varchar(50),
	"referencia_externa" varchar(200),
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "compras_transiciones" ADD CONSTRAINT "compras_transiciones_compra_id_compras_id_fk"
  FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "compras_transiciones" ADD CONSTRAINT "compras_transiciones_actor_usuario_id_usuarios_id_fk"
  FOREIGN KEY ("actor_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_compras_transiciones_compra" ON "compras_transiciones" USING btree ("compra_id");
--> statement-breakpoint
CREATE INDEX "idx_compras_transiciones_estado_nuevo" ON "compras_transiciones" USING btree ("estado_nuevo");
