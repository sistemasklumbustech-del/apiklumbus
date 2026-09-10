/**
 * Roles de base de datos y helper de aislamiento multi-tenant (RLS).
 *
 * Arquitectura Técnica v1.0, sección 4.3: el aislamiento entre cooperativas
 * se implementa en dos capas — (1) filtro de aplicación resuelto del token
 * de sesión, y (2) Row-Level Security de Postgres como capa redundante que
 * protege incluso si hay un bug en el código de aplicación. Esta es también
 * la razón decisiva de elegir Drizzle sobre Prisma (sección 4.2).
 *
 * Diseño de roles:
 * - `ticketya_app`: rol con el que se conecta el backend NestJS para
 *   solicitudes de pasajero, vendedor y admin_cooperativa. Sujeto a RLS.
 * - `ticketya_platform_admin`: rol para el Panel Admin de plataforma
 *   (RF-ADMIN-002, dashboard nacional agregado across cooperativas).
 *   Necesita ver filas de TODAS las cooperativas, así que debe tener el
 *   atributo BYPASSRLS a nivel de Postgres.
 *
 * ⚠ Limitación real de la herramienta, comunicada explícitamente: la API
 * `pgRole` de drizzle-orm (v0.45.x, verificado en este entorno) no expone
 * el atributo BYPASSRLS en su configuración — solo `createDb`, `createRole`
 * e `inherit`. Por lo tanto, además de lo que `drizzle-kit` genere para
 * este rol, hace falta una migración manual con:
 *
 *   ALTER ROLE ticketya_platform_admin BYPASSRLS;
 *
 * Ver migrations/manual/001_bypass_rls_admin.sql en este mismo paquete.
 */
import { pgRole } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const appRole = pgRole('ticketya_app', { inherit: true });
export const platformAdminRole = pgRole('ticketya_platform_admin', { inherit: true });

/**
 * Fragmento SQL reutilizable: compara la columna `cooperativa_id` de la fila
 * contra el valor puesto por el backend en la variable de sesión de Postgres
 * `app.current_cooperativa_id` (vía `SET LOCAL` al abrir cada request
 * autenticado, resuelto del token de sesión — nunca confiando en un valor
 * enviado directamente por el cliente).
 *
 * El segundo argumento de `current_setting` (`true`) hace que devuelva NULL
 * en vez de lanzar error si la variable no fue seteada — así una conexión
 * sin cooperativa_id seteado simplemente no ve ninguna fila, en vez de
 * romper la query.
 */
export const filtroCooperativaActual = sql`(current_user = 'ticketya_platform_admin' OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)`;

/**
 * Variante para tablas que mezclan filas de tenant (ej. personal de una
 * cooperativa) con filas globales sin dueño de tenant (ej. cuentas de
 * pasajero, que por diseño pueden comprar en cualquier cooperativa y no
 * pertenecen a ninguna). Sin esta variante, una comparación de igualdad
 * contra NULL escondería silenciosamente todas las filas globales de
 * cualquier conexión — un bug de RLS sutil y peligroso.
 *
 * Se usa en `usuarios`: ver el comentario de esa tabla para el
 * razonamiento completo y su limitación conocida.
 *
 * Nota real encontrada durante la verificación funcional de este esquema
 * (ver verify_rls_isolation.cjs en la raíz del paquete): `current_setting(x,
 * true)` sobre un GUC personalizado no definido en postgresql.conf
 * devuelve cadena vacía `''` después de un `RESET`, no `NULL` como se
 * podría asumir — por eso todo fragmento de este archivo pasa el valor
 * por `NULLIF(..., '')` antes de castear a uuid. Sin esto, una conexión
 * que hace RESET de la variable rompe con "invalid input syntax for type
 * uuid" en vez de simplemente no ver ninguna fila.
 */
export const filtroCooperativaActualOGlobal = sql`(current_user = 'ticketya_platform_admin' OR cooperativa_id IS NULL OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)`;

