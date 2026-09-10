-- Cambio de correo (29-jul-2026, hallazgo real del usuario): si un
-- pasajero pierde acceso a su correo, hoy no tiene ningún camino de
-- autoservicio para recuperarlo -- queda fuera de su cuenta para
-- siempre. Este campo guarda el correo nuevo pendiente de confirmar.
ALTER TABLE "tokens_usuario" ADD COLUMN "correo_nuevo" varchar(200);
