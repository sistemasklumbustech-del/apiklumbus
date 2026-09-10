import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { generarCodigoTotp } from '../src/dominio/auth/auth.ports';
import { AppModule } from './../src/app.module';
import { Client } from 'pg';

/**
 * Ítem 19, Fase 3 (05-ago-2026) -- 2FA obligatorio para las 3 cuentas
 * administrativas reales (super_admin, admin_plataforma,
 * admin_cooperativa). Decisión del director: obligatorio desde ya (sin
 * período de gracia, no hay producción real que proteger todavía),
 * mediante "configuración forzada en el siguiente login", nunca un
 * bloqueo duro -- el mismo login sigue funcionando, solo exige
 * completar el setup primero.
 *
 * ⚠ Nota real sobre esta suite: login() tiene un bypass de 2FA cuando
 * NODE_ENV === 'test' (mismo patrón exacto que @Throttle ya usa en
 * este proyecto) -- necesario para no romper decenas de pruebas e2e
 * existentes que ya inician sesión como cuentas administrativas y
 * esperan accessToken directo. Para probar el comportamiento REAL de
 * 2FA (no el bypass), esta suite cambia NODE_ENV momentáneamente
 * alrededor de las llamadas que sí necesitan el flujo completo, y lo
 * restaura de inmediato después -- la condición se evalúa en cada
 * llamada dentro de login(), no se cachea al arrancar la app.
 */
describe('2FA obligatorio para cuentas administrativas (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();
  let pg: Client;
  const NODE_ENV_ORIGINAL = process.env.NODE_ENV;

  async function conNodeEnvReal<T>(fn: () => Promise<T>): Promise<T> {
    process.env.NODE_ENV = 'production';
    try {
      return await fn();
    } finally {
      process.env.NODE_ENV = NODE_ENV_ORIGINAL;
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    pg = new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
    await pg.connect();
  });

  afterAll(async () => {
    process.env.NODE_ENV = NODE_ENV_ORIGINAL;
    await pg.end();
    await app.close();
  });

  it('un pasajero normal NO pasa por 2FA -- login le da accessToken directo, incluso con NODE_ENV real', async () => {
    const correo = `pasajero.2fa.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo,
      password: 'ClaveSegura123',
      nombres: 'Pasajero',
      apellidos: '2FA E2E',
    });

    const respuesta = await conNodeEnvReal(() =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ correo, password: 'ClaveSegura123' }),
    );
    expect(respuesta.body.accessToken).toBeDefined();
    expect(respuesta.body.requiere2fa).toBeUndefined();
    expect(respuesta.body.requiereConfigurar2fa).toBeUndefined();
  });

  it('flujo completo real: admin sin 2FA configurado -> login exige configurarlo -> QR real -> código real -> activado con 10 códigos de recuperación', async () => {
    const correo = `admin.2fa.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo,
      password: 'ClaveSegura123',
      nombres: 'Admin',
      apellidos: '2FA E2E',
    });
    await pg.query("UPDATE usuarios SET rol='admin_plataforma' WHERE correo=$1", [correo]);

    // 1) Login con NODE_ENV real -- debe exigir configurar 2FA, NO dar accessToken.
    const loginInicial = await conNodeEnvReal(() =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ correo, password: 'ClaveSegura123' })
        .expect(201),
    );
    expect(loginInicial.body.requiereConfigurar2fa).toBe(true);
    expect(loginInicial.body.accessToken).toBeUndefined();
    const tokenTemporal = loginInicial.body.tokenTemporal;
    expect(tokenTemporal).toBeDefined();

    // 2) Pide el QR de configuración -- secreto TOTP real.
    const configuracion = await request(app.getHttpServer())
      .post('/auth/2fa/iniciar-configuracion')
      .send({ tokenTemporal })
      .expect(201);
    expect(configuracion.body.secreto).toBeDefined();
    expect(configuracion.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    // 3) Genera un código TOTP REAL a partir del secreto devuelto --
    // exactamente lo que haría una app autenticadora real.
    const codigoValido = generarCodigoTotp(configuracion.body.secreto);

    // 4) Confirma con el código real -- activa 2FA, entrega credenciales + 10 códigos de recuperación.
    const activacion = await request(app.getHttpServer())
      .post('/auth/2fa/confirmar-configuracion')
      .send({ tokenTemporal, codigo: codigoValido })
      .expect(201);
    expect(activacion.body.accessToken).toBeDefined();
    expect(activacion.body.codigosRecuperacion).toHaveLength(10);
    // Sin duplicados -- 10 códigos genuinamente distintos.
    expect(new Set(activacion.body.codigosRecuperacion).size).toBe(10);

    // 5) El accessToken entregado ya es real y funcional.
    const perfil = await request(app.getHttpServer())
      .get('/auth/perfil')
      .set('Authorization', `Bearer ${activacion.body.accessToken}`)
      .expect(200);
    expect(perfil.body.correo).toBe(correo);
  });

  it('flujo completo real: admin CON 2FA ya activo -> login exige el código -> código incorrecto rechaza -> código correcto entrega credenciales', async () => {
    const correo = `admin.2fa.activo.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo,
      password: 'ClaveSegura123',
      nombres: 'Admin',
      apellidos: '2FA Activo E2E',
    });
    await pg.query("UPDATE usuarios SET rol='admin_cooperativa' WHERE correo=$1", [correo]);

    // Setup: activa 2FA primero (mismo flujo que la prueba anterior).
    const loginSetup = await conNodeEnvReal(() =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ correo, password: 'ClaveSegura123' }),
    );
    const configuracion = await request(app.getHttpServer())
      .post('/auth/2fa/iniciar-configuracion')
      .send({ tokenTemporal: loginSetup.body.tokenTemporal });
    const secreto = configuracion.body.secreto;
    const codigoSetup = generarCodigoTotp(secreto);
    await request(app.getHttpServer())
      .post('/auth/2fa/confirmar-configuracion')
      .send({ tokenTemporal: loginSetup.body.tokenTemporal, codigo: codigoSetup });

    // Ahora sí, un login NUEVO con 2FA ya activo -- debe pedir el código, no configurarlo de nuevo.
    const loginConTotp = await conNodeEnvReal(() =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ correo, password: 'ClaveSegura123' })
        .expect(201),
    );
    expect(loginConTotp.body.requiere2fa).toBe(true);
    expect(loginConTotp.body.requiereConfigurar2fa).toBeUndefined();
    const tokenTemporal = loginConTotp.body.tokenTemporal;

    // Código incorrecto -- rechazado.
    await request(app.getHttpServer())
      .post('/auth/2fa/verificar')
      .send({ tokenTemporal, codigo: '000000' })
      .expect(401);

    // Código correcto -- credenciales reales.
    const codigoValido = generarCodigoTotp(secreto);
    const verificacion = await request(app.getHttpServer())
      .post('/auth/2fa/verificar')
      .send({ tokenTemporal, codigo: codigoValido })
      .expect(201);
    expect(verificacion.body.accessToken).toBeDefined();
  });

  it('código de recuperación: entrega credenciales una vez, y queda inválido en el segundo intento', async () => {
    const correo = `admin.2fa.recup.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo,
      password: 'ClaveSegura123',
      nombres: 'Admin',
      apellidos: '2FA Recuperacion E2E',
    });
    await pg.query("UPDATE usuarios SET rol='super_admin' WHERE correo=$1", [correo]);

    const loginSetup = await conNodeEnvReal(() =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ correo, password: 'ClaveSegura123' }),
    );
    const configuracion = await request(app.getHttpServer())
      .post('/auth/2fa/iniciar-configuracion')
      .send({ tokenTemporal: loginSetup.body.tokenTemporal });
    const codigoConfirmacion = generarCodigoTotp(configuracion.body.secreto);
    const activacion = await request(app.getHttpServer())
      .post('/auth/2fa/confirmar-configuracion')
      .send({
        tokenTemporal: loginSetup.body.tokenTemporal,
        codigo: codigoConfirmacion,
      });
    const codigoRecuperacion = activacion.body.codigosRecuperacion[0];

    const loginNuevo = await conNodeEnvReal(() =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ correo, password: 'ClaveSegura123' }),
    );
    const tokenTemporal = loginNuevo.body.tokenTemporal;

    // Primer uso -- válido.
    const recuperacion = await request(app.getHttpServer())
      .post('/auth/2fa/recuperar')
      .send({ tokenTemporal, codigoRecuperacion })
      .expect(201);
    expect(recuperacion.body.accessToken).toBeDefined();

    // Segundo uso del MISMO código -- ya está consumido, rechazado.
    // Necesita un token temporal nuevo (el anterior ya no aplica para un login nuevo).
    const loginOtraVez = await conNodeEnvReal(() =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ correo, password: 'ClaveSegura123' }),
    );
    await request(app.getHttpServer())
      .post('/auth/2fa/recuperar')
      .send({ tokenTemporal: loginOtraVez.body.tokenTemporal, codigoRecuperacion })
      .expect(401);
  });
});
