// Debe ser el PRIMER import del archivo — requisito de Sentry para
// poder instrumentar automáticamente todos los módulos de la app.
import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { almacenContexto } from './infraestructura/auditoria/contexto-solicitud';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // RF-024 -- la API corre detrás de Nginx (reverse proxy), así que sin
  // esto `req.ip` siempre devuelve la IP local de Nginx, nunca la del
  // cliente real -- inútil tanto para el registro de aceptación de
  // Términos como para el rate limiting por IP (@nestjs/throttler)
  // configurado más abajo en AppModule, que hasta ahora limitaba a
  // TODO el tráfico combinado como si fuera un solo cliente.
  app.set('trust proxy', 1);
  // RF-021 (auditoría completa): deja la IP real del cliente y su navegador
  // disponibles en toda la solicitud, para que cualquier registro de
  // auditoría los guarde sin pasarlos de mano en mano.
  app.use(
    (
      req: { ip?: string; headers: Record<string, unknown> },
      _res: unknown,
      next: () => void,
    ) => {
      const userAgent = req.headers['user-agent'];
      almacenContexto.run(
        {
          ip: req.ip,
          userAgent: typeof userAgent === 'string' ? userAgent : undefined,
        },
        next,
      );
    },
  );
  // Activa las validaciones de class-validator en cada DTO (@IsEmail,
  // @MinLength, etc.) -- sin esto, los decoradores de los DTO no hacen
  // nada, solo son anotaciones sin efecto.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // El sitio web (apps/web, Next.js) corre en un puerto distinto al
  // backend -- sin CORS habilitado, el navegador bloquea esas llamadas
  // por politica de mismo origen, aunque el backend responda bien.
  app.enableCors({ origin: true, credentials: true });
  // 27-jul-2026 -- sirve la carpeta donde SimuladorAlmacenamiento
  // guarda los archivos reales (fotos de perfil, logos), para que las
  // URLs que devuelve ("/uploads/perfiles/xxx.png") sean visitables de
  // verdad en el navegador, no solo strings guardados en la base.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
