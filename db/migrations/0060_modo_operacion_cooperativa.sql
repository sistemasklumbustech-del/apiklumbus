-- Modo de operación por cooperativa (07-oct-2026).
--
-- Klumbus opera de tres maneras según lo que ya tenga cada cooperativa:
--
--  * plataforma_completa: la cooperativa no tiene sistema. Klumbus hace todo:
--    venta en ventanilla y en línea, cobro, factura del pasaje y registro de
--    la tasa en el SIAT 3000 con las credenciales de la cooperativa.
--  * intermediario_con_cobro: la cooperativa tiene su sistema (factura y SIAT
--    3000) pero no pasarela de pagos. Klumbus vende en línea, cobra y le
--    liquida. Es como operan hoy todas las cooperativas, por eso es el valor
--    por defecto.
--  * intermediario_venta: la cooperativa tiene su sistema y su pasarela.
--    Klumbus solo vende en línea y cobra su comisión. Todavía no está
--    disponible para asignar: falta el pago a cargo de la cooperativa.
--
-- Va aparte de `modelo_integracion` (A/B), que solo dice si la cooperativa usa
-- el panel de Klumbus o su propio sistema, y no gobernaba ninguna regla.
--
-- Tipos de tarea nuevo: la cooperativa debe reportar desde su sistema la
-- factura y el código de tasa de cada venta.

CREATE TYPE "public"."modo_operacion" AS ENUM('plataforma_completa', 'intermediario_con_cobro', 'intermediario_venta');
--> statement-breakpoint
ALTER TABLE "cooperativas" ADD COLUMN "modo_operacion" "modo_operacion" DEFAULT 'intermediario_con_cobro' NOT NULL;
--> statement-breakpoint
ALTER TYPE "public"."tipo_tarea_postpago" ADD VALUE IF NOT EXISTS 'confirmacion_cooperativa';
--> statement-breakpoint
ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'cambio_modo_operacion';
