-- Política de cancelación/reprogramación por cooperativa (29-jul-2026)
-- -- hallazgo real: Transportes Occidental (Machala) no permite
-- cambios ni devoluciones. Cada cooperativa decide por separado
-- (cancelar = venta perdida, reprogramar = no). Default TRUE a
-- propósito: mantiene el comportamiento ya existente para toda
-- cooperativa que no configure nada explícitamente.
ALTER TABLE "cooperativas" ADD COLUMN "permite_cancelacion" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "cooperativas" ADD COLUMN "permite_reprogramacion" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "cooperativas" ADD COLUMN "horas_limite_cancelacion" integer;
