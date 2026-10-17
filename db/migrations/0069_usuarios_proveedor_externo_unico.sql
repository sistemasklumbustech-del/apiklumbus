-- 16-oct-2026: inicio de sesión con Google y Apple. Una persona del proveedor (su identificador `sub`)
-- corresponde a una sola cuenta; las cuentas con contraseña no usan estas columnas y quedan fuera del índice.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_usuarios_proveedor_externo" ON "usuarios" USING btree ("proveedor_externo","proveedor_externo_id") WHERE "proveedor_externo" IS NOT NULL;
