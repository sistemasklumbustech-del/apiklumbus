import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { crearConexionBaseDeDatos } from './database.provider';

export const DB_CONNECTION = 'DB_CONNECTION';
export const DRIZZLE_DB = 'DRIZZLE_DB';
export const PG_POOL = 'PG_POOL';

export const DB_CONNECTION_PUBLICO = 'DB_CONNECTION_PUBLICO';
export const DRIZZLE_DB_PUBLICO = 'DRIZZLE_DB_PUBLICO';

/**
 * Módulo global (Arquitectura Técnica 4.3): cualquier módulo del backend
 * puede inyectar DRIZZLE_DB sin tener que importar DatabaseModule
 * explícitamente en cada uno.
 *
 * Expone DOS conexiones distintas, a propósito:
 *
 * - `DRIZZLE_DB` (rol `ticketya_app`): para todo lo que pertenece a una
 *   cooperativa específica (rutas, unidades, boletos, etc.). Sujeta a
 *   RLS de verdad — necesita que la capa de aplicación setee
 *   `app.current_cooperativa_id` por conexión antes de operar (ver nota
 *   en usuario.repositorio.drizzle.ts sobre las tablas que no lo
 *   requieren, como `usuarios` con su política OR-IS-NULL).
 *
 * - `DRIZZLE_DB_PUBLICO` (rol `ticketya_platform_admin`, con BYPASSRLS):
 *   para lecturas que son legítimamente cross-tenant por diseño — la
 *   búsqueda de viajes de un pasajero (RF-BUS-003, "resultados
 *   multi-cooperativa") es exactamente ese caso: un pasajero DEBE poder
 *   ver viajes de todas las cooperativas a la vez, así que no tiene
 *   sentido pedirle a RLS que filtre por una sola cooperativa.
 *
 * ⚠ Antes de este cambio, el backend se conectaba directamente como el
 * superusuario `postgres`, lo cual hace que Postgres ignore TODAS las
 * políticas RLS sin importar nada (comportamiento estándar de Postgres
 * para superusuarios) — la protección multi-tenant existía en la base de
 * datos pero no se estaba usando de verdad. Ver migración manual
 * 004_habilitar_login_roles.sql.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DB_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const connectionString = config.getOrThrow<string>('DATABASE_URL');
        return crearConexionBaseDeDatos(connectionString);
      },
    },
    {
      provide: DRIZZLE_DB,
      inject: [DB_CONNECTION],
      useFactory: (conexion: ReturnType<typeof crearConexionBaseDeDatos>) =>
        conexion.db,
    },
    {
      provide: PG_POOL,
      inject: [DB_CONNECTION],
      useFactory: (conexion: ReturnType<typeof crearConexionBaseDeDatos>) =>
        conexion.pool,
    },
    {
      provide: DB_CONNECTION_PUBLICO,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const connectionString = config.getOrThrow<string>(
          'DATABASE_URL_PUBLICO',
        );
        return crearConexionBaseDeDatos(connectionString);
      },
    },
    {
      provide: DRIZZLE_DB_PUBLICO,
      inject: [DB_CONNECTION_PUBLICO],
      useFactory: (conexion: ReturnType<typeof crearConexionBaseDeDatos>) =>
        conexion.db,
    },
  ],
  exports: [DRIZZLE_DB, PG_POOL, DRIZZLE_DB_PUBLICO],
})
export class DatabaseModule {}
