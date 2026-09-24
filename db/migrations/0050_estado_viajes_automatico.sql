-- Cambio automatico del estado de los viajes (24-sep-2026). Una tarea
-- programada cada 5 minutos mueve los viajes segun la hora de salida:
--   * programado -> en_curso   a los 15 min de la hora de salida, si vendio boletos.
--   * programado -> cancelado  a los 15 min de la hora de salida, si NO vendio nada.
--   * en_curso   -> finalizado cuando la cooperativa confirma la llegada del
--     bus (se le avisa por correo al pasar la hora estimada de llegada).
-- llegada_consultada_en guarda cuando se envio ese aviso, para no repetirlo.
-- Cada cambio queda en la auditoria (accion cambio_estado_viaje).

ALTER TYPE "public"."accion_auditoria" ADD VALUE IF NOT EXISTS 'cambio_estado_viaje';
--> statement-breakpoint

ALTER TABLE "viajes" ADD COLUMN "llegada_consultada_en" timestamp with time zone;
