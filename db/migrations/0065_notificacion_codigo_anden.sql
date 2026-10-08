-- 07-oct-2026: aviso por correo cuando el código de tasa del terminal (el QR del
-- torniquete) queda listo después de la compra. Se registra como notificación propia.
ALTER TYPE "public"."tipo_notificacion" ADD VALUE IF NOT EXISTS 'codigo_anden';
