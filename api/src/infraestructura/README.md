# Capa de Infraestructura

Todo lo que habla con el mundo exterior real: Postgres (vía
`packages/db`), Redis, PayPhone/Kushki, el proveedor de facturación SRI,
WhatsApp/correo. Implementa las interfaces que la capa de dominio define,
sin que el dominio sepa los detalles concretos de cada proveedor.

`database/` contiene la conexión real a Postgres usando el esquema
compartido de `@ticketya/db` — es el único lugar del backend que debería
importar `drizzle-orm/node-postgres` directamente.
