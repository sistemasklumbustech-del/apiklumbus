import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './infraestructura/database/database.module';
import { SaludController } from './presentacion/salud/salud.controller';
import { AuthModule } from './presentacion/auth/auth.module';
import { BusquedaModule } from './presentacion/busqueda/busqueda.module';
import { AsientosModule } from './presentacion/asientos/asientos.module';
import { VentasModule } from './presentacion/ventas/ventas.module';
import { AdminModule } from './presentacion/admin/admin.module';
import { PanelEmpresaModule } from './presentacion/panelempresa/panel-empresa.module';
import { CalificacionesModule } from './presentacion/calificaciones/calificaciones.module';
import { ComercialModule } from './presentacion/comercial/comercial.module';
import { LiquidacionesModule } from './presentacion/liquidaciones/liquidaciones.module';
import { ApiExternaModule } from './presentacion/api-externa/api-externa.module';
import { GeneradorViajesModule } from './presentacion/generador-viajes/generador-viajes.module';
import { WalletModule } from './presentacion/wallet/wallet.module';
import { ReferidosModule } from './presentacion/referidos/referidos.module';

/**
 * 27-jul-2026 -- rate limiting global (RNF-SEG, Fase B). Limite por
 * defecto: 100 peticiones por minuto por IP, aplicado a TODA la API
 * via APP_GUARD. Limites mas estrictos especificos (ej. login,
 * registro) se agregan por endpoint con @Throttle() donde haga falta.
 */
@Module({
  imports: [
    // Monitoreo de errores en producción (28-jul-2026, RF-OPS) — debe
    // ir primero en la lista de imports, junto con SentryGlobalFilter
    // más abajo (primero en providers), para capturar errores de toda
    // la app, no solo de módulos que se registren después.
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    // 02-ago-2026 -- necesario para el @Cron del despachador de webhooks
    // (Modelo B, RF-API-003). Sin esto, @Cron() no hace nada.
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        // 27-jul-2026 -- se relaja automaticamente en tests (Jest fija
        // NODE_ENV=test solo, sin configuracion manual) para no chocar
        // con corridas repetidas de login/registro en los e2e; el
        // limite de produccion real sigue siendo 100.
        limit: process.env.NODE_ENV === 'test' ? 10000 : 100,
      },
    ]),
    DatabaseModule,
    AuthModule,
    BusquedaModule,
    AsientosModule,
    VentasModule,
    AdminModule,
    PanelEmpresaModule,
    CalificacionesModule,
    ComercialModule,
    LiquidacionesModule,
    ApiExternaModule,
    GeneradorViajesModule,
    WalletModule,
    ReferidosModule,
  ],
  controllers: [AppController, SaludController],
  providers: [
    AppService,
    // Debe ir ANTES que cualquier otro filtro de excepciones (no hay
    // otro en este proyecto hoy, pero si se agrega uno en el futuro,
    // este debe seguir siendo el primero).
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
