# Capa de Aplicación

Casos de uso concretos (ej. "registrar pasajero", "calcular tarifa del
viaje", "bloquear asiento"). Orquesta la capa de dominio y le pide cosas a
la capa de infraestructura a través de interfaces — nunca habla
directamente con Postgres ni con una pasarela de pago.

Aquí viven los `*.service.ts` que contienen lógica de negocio real (no
confundir con servicios de NestJS que solo hacen de "pegamento" — esos
pueden vivir en `presentacion/` si son puramente de framework).
