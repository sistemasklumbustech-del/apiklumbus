-- 07-oct-2026: una cooperativa puede cargar a mano, desde su panel, la factura y el
-- código de tasa de una venta (en lugar de reportarlos desde su sistema por la API).
-- Esa acción queda en la auditoría.
ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'postpago_confirmacion_manual';
