-- Ítem 9, Fase 2 (04-ago-2026): división de admin_plataforma en
-- super_admin + admin_plataforma, con matriz de permisos (sección 3.8
-- del documento maestro) y registro de auditoría específico (no
-- genérico -- accion_auditoria es un enum estricto, se respeta ese
-- diseño en vez de forzarlo a texto libre).
--
-- Migración de datos existentes: todos los admin_plataforma actuales
-- se quedan como admin_plataforma (rol de menor privilegio) -- el
-- usuario asciende al primero a super_admin a mano, después de esta
-- migración, decisión confirmada por el director 04-ago-2026.
--
-- 'baja_cooperativa' y 'cambio_comision' ya existían en el enum, sin
-- usar hasta ahora -- se reutilizan para eliminarCooperativa y
-- actualizarCargoPlataforma respectivamente, en vez de duplicar.

ALTER TYPE "public"."rol_usuario" ADD VALUE 'super_admin';
--> statement-breakpoint

ALTER TYPE "public"."accion_auditoria" ADD VALUE 'creacion_administrador';
--> statement-breakpoint

ALTER TYPE "public"."accion_auditoria" ADD VALUE 'eliminacion_administrador';
--> statement-breakpoint

ALTER TYPE "public"."accion_auditoria" ADD VALUE 'cambio_modo_iva_boleto';
