# TicketYa — `packages/db`: esquema Drizzle (Postgres + RLS)

Esquema de base de datos completo, tabla por tabla, derivado del **SRS
v1.2** y siguiendo las decisiones de la **Arquitectura Técnica v1.0**
(Postgres + Drizzle + monorepo). Este documento asume que ya leíste esos
dos documentos — no repite el porqué de cada decisión de stack, solo el
diseño del esquema en sí.

## Qué hay aquí

```
packages/db/
  schema/
    enums.ts            — enums compartidos (con referencia a su RF de origen)
    rls.ts               — roles de Postgres + helpers de aislamiento multi-tenant
    configuracion.ts      — configuración singleton (evita hardcodear decisiones pendientes)
    tenancy.ts            — cooperativas, puntos_operacion (RF-FLOTA-003)
    usuarios.ts           — usuarios (RBAC), tokens
    flota.ts              — tipos_vehiculo, unidades (RF-FLOTA)
    rutas.ts              — rutas, ruta_paradas, horarios_ruta, viajes
    asientos.ts           — viaje_asientos (estado + hold temporal, RF-SEAT)
    ventas.ts             — compras, pasajeros_compra, boletos, pagos
    facturacion.ts         — comprobantes_tasa_terminal, comprobantes_electronicos
    menores.ts             — autorizaciones_menor, verificaciones_menor
    notificaciones.ts      — notificaciones
    liquidaciones.ts       — liquidaciones_cooperativa, liquidaciones_terminal, ajustes
    admin.ts                — auditoria_admin
    api_externa.ts           — credenciales_api, webhooks_log, reservas_api_externas
    comercial.ts              — espacios/planes/leads/campañas/métricas publicitarias
    index.ts                  — barrel export
  migrations/
    0000_*.sql                — migración generada por drizzle-kit (nombre aleatorio en cada `generate`)
    manual/                   — 3 pasos SQL que drizzle-kit NO genera (ver abajo)
  drizzle.config.ts
  verify_migration.cjs         — corre la migración contra Postgres real (pglite)
  verify_rls_isolation.cjs     — prueba funcional: 2 cooperativas, aislamiento real
  verify_edge_cases.cjs        — subconsulta RLS, bloqueo de escritura cruzada, CHECK
```

**33 tablas** en total.

## Cómo se verificó (no solo "se ve bien")

Siguiendo la misma disciplina que ya se usó para el frontend (Playwright
antes de afirmar que algo visual quedó resuelto), este esquema se verificó
en 3 niveles, no solo visualmente en el código:

1. **`tsc --noEmit`** — compila sin errores de tipo. Se hizo una prueba de
   sanidad inyectando un error a propósito para confirmar que `tsc`
   realmente lo detecta (no es un falso positivo por configuración floja).
2. **`drizzle-kit generate`** — genera el SQL real de las 33 tablas, 2
   roles, 10 políticas RLS y el constraint CHECK, sin errores.
3. **Ejecución contra Postgres real** (vía `@electric-sql/pglite`, Postgres
   compilado a WASM — no un mock): las 199 sentencias del SQL generado
   corren sin errores, y además se probó **funcionalmente** el
   aislamiento multi-tenant con datos reales de dos cooperativas
   distintas — incluyendo un intento explícito de que una cooperativa
   escriba sobre un asiento de otra (bloqueado correctamente por RLS).

Esta última verificación **encontró y corrigió un bug real** antes de
entregarse: `current_setting('app.x', true)` devuelve cadena vacía `''`
(no `NULL`) después de un `RESET`, lo cual rompía el cast a `::uuid` en
todas las políticas RLS. Se corrigió envolviendo con `NULLIF(..., '')` en
`schema/rls.ts`. Sin la prueba funcional, este bug habría pasado
`tsc` y `drizzle-kit generate` sin problema — solo aparece al ejecutarlo.

Para volver a correr las 3 verificaciones (los scripts detectan el
archivo de migración automáticamente, sin importar su nombre aleatorio):
```bash
npm install
npm run verify:all
```

## 3 pasos de migración manual (fuera de drizzle-kit)

`drizzle-kit` no puede generar estos tres pasos porque están fuera de lo
que su modelo de esquema expresa. Deben correrse **después** de
`0000_first_sentinel.sql`, en este orden, contra la base real:

1. **`manual/001_bypass_rls_admin.sql`** — sin esto, el Panel Admin de
   plataforma (RF-ADMIN-002, dashboard nacional) queda tan restringido
   como cualquier cooperativa, porque drizzle-orm 0.45.x no expone el
   atributo `BYPASSRLS` en `pgRole()`.
2. **`manual/002_grants_app_role.sql`** — sin esto, el backend NestJS no
   tiene ningún privilegio sobre ninguna tabla; `drizzle-kit` crea los
   roles pero no otorga privilegios de datos.
3. **`manual/003_auditoria_inmutable.sql`** — revoca UPDATE/DELETE sobre
   `auditoria_admin` para que la inmutabilidad exigida por RF-ADMIN-005
   sea real a nivel de Postgres, no solo una convención de código.

Las 3 se verificaron ejecutándose sin error contra Postgres real (ver
sección anterior).

## Decisiones de diseño que quiero que revises tú, no solo aceptes

Estas no son bugs ni descuidos — son decisiones de diseño con trade-offs
reales que documenté en el código, y que vale la pena que confirmes:

- **`compras`, `pasajeros_compra` y `pagos` NO tienen `cooperativa_id` ni
  RLS propio.** Son entidades del pasajero, no de una cooperativa —  y
  RF-BUS-005 (viaje redondo) permite en teoría que ida y vuelta sean de
  cooperativas distintas. El aislamiento real de datos de cooperativa se
  garantiza a través de `boletos` (que sí tiene `cooperativa_id` y RLS).
  Ver el comentario largo al inicio de `ventas.ts` para el razonamiento
  completo.
- **`usuarios` usa un filtro RLS "OR IS NULL"** en vez del filtro estricto,
  porque mezcla personal de cooperativa (tenant-scoped) con cuentas de
  pasajero y admin_plataforma (globales). Consecuencia conocida: dos
  cooperativas distintas comparten visibilidad de RLS sobre filas de
  pasajero/admin_plataforma (no sobre personal de la otra cooperativa). El
  filtrado más fino queda en la capa de aplicación.
- **PostGIS no se modeló con un tipo de columna nativo** — drizzle-orm no
  tiene builder para `geography` en esta versión. Se dejaron `latitud`/
  `longitud` como `doublePrecision`, con una migración manual adicional
  documentada en el comentario de `tenancy.ts` si más adelante hace falta
  una columna `geography` real para consultas espaciales.
- **`distribucion_asientos` es JSONB sin schema fijo** — el layout de
  asientos varía demasiado entre tipo de vehículo para un modelo
  relacional rígido; el shape exacto del JSON se define en
  `packages/types` (paquete compartido), no en la base de datos.

## Decisiones de negocio que el SRS ya marca como pendientes (no las inventé)

El esquema soporta estos campos como **nullable** a propósito, para que
tu equipo los complete cuando estén definidos — no se asumió ningún valor:

- Comisión de plataforma (`configuracion_plataforma.comision_porcentaje_*`) — RN-003
- Ventana de bloqueo temporal de asiento (`configuracion_plataforma.ventana_bloqueo_asiento_segundos`) — RN-004
- Política de cancelación/reembolso (`configuracion_plataforma.politica_cancelacion_notas`) — RN-005
- Cuenta bancaria y periodicidad de liquidación del Terminal de Machala (`puntos_operacion.liquidacion_*`) — decisión pendiente #4
- Nombre exacto del identificador operativo de unidad ("disco"/turno) — `unidades.identificador_operativo` es un campo genérico, ver RF-FLOTA-002
- Arquitectura de 3 comprobantes SRI por venta (`comprobantes_electronicos`) — RL-006, diseño propuesto sin validar con contador
- Tarifas de planes comerciales (`planes_comerciales.precio_mensual`) — pendiente de negocio, sección 3.10

## Siguiente paso natural

Con esto ya construido, lo que sigue lógicamente (Arquitectura Técnica,
sección 9, etapa 1 "Fundaciones") es levantar el monorepo Turborepo real
con NestJS y montar este paquete `db` dentro de `packages/db`, más el
motor de autenticación (RF-AUTH) sobre la tabla `usuarios` ya definida
aquí.
