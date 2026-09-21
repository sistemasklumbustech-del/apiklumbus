-- El administrador de plataforma puede suspender y reactivar
-- cooperativas (RF-035). Cada cambio queda auditado en auditoria_admin
-- (inmutable) con estado anterior, estado nuevo y motivo en `detalle`.
-- ADD VALUE IF NOT EXISTS: seguro de reaplicar. Los valores nuevos no se
-- usan dentro de esta misma transaccion.
ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'suspension_cooperativa';
--> statement-breakpoint
ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'reactivacion_cooperativa';
