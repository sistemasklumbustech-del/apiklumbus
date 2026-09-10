# Capa de Dominio

Reglas de negocio puras — sin dependencias de NestJS, Drizzle, Postgres,
ni ningún framework. Arquitectura Técnica v1.0, sección 2: "la lógica de
negocio (dominio) no conoce Postgres, Drizzle, ni la pasarela de pago;
solo conoce interfaces que la infraestructura implementa".

Ejemplos de lo que va aquí: cálculo de tarifas con descuento (RN-001),
reglas de bloqueo de asiento (RN-004), interfaces de repositorio (ej.
`UsuarioRepository`) que la capa de infraestructura debe implementar.

Si un archivo de esta carpeta necesita importar algo de `@nestjs/*` o de
`@ticketya/db`, probablemente no pertenece aquí — pertenece a
`aplicacion/` o `infraestructura/`.
