// Debe ser el PRIMER import del archivo — requisito de Sentry para
// poder instrumentar automáticamente todos los módulos de la app.
import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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
