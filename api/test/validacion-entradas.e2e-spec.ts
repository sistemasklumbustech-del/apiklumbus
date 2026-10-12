import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/** Validación de lo que manda el cliente (12-oct-2026): ids mal formados y contraseñas comunes. */
describe('Validación de entradas (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('un id que no es UUID responde 400 (antes 500), sin revelar detalles de la base', async () => {
    for (const ruta of [
      '/viajes/abc/paradas',
      '/viajes/abc/ubicacion',
      '/viajes/abc/asientos',
      '/calificaciones/cooperativa/abc/resenas',
    ]) {
      const res = await request(app.getHttpServer()).get(ruta);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        statusCode: 400,
        message: 'Uno de los datos enviados no tiene un formato válido.',
        error: 'Bad Request',
      });
    }
  });

  it('un id que no existe sigue siendo 404, no 400', async () => {
    const res = await request(app.getHttpServer()).get('/viajes/00000000-0000-4000-8000-000000000000/asientos');
    expect(res.status).toBe(404);
  });

  it('el registro rechaza contraseñas comunes y acepta una razonable', async () => {
    const intento = (password: string, n: number) =>
      request(app.getHttpServer())
        .post('/auth/registro')
        .send({ aceptoTerminos: true, correo: `validacion.${sufijo}.${n}@ticketya.ec`, password, nombres: 'Prueba', apellidos: 'Validacion' });

    for (const [n, password] of ['password', 'Password123', '12345678', 'aaaaaaaa', 'Contraseña1'].entries()) {
      const res = await intento(password, n);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain('muy común');
    }
    const bien = await intento('ClaveSegura123', 99);
    expect(bien.status).toBe(201);
  });

  it('iniciar sesión no revisa si la contraseña es común: quien ya la tiene puede entrar y cambiarla', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ correo: 'nadie@ticketya.ec', password: 'password' });
    expect(res.status).toBe(401); // credenciales inválidas, no "contraseña común"
  });
});
