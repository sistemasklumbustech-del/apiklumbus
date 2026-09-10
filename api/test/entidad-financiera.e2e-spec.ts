import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { Client } from 'pg';
import { limpiarCooperativasDePrueba } from './helpers/limpieza';

/**
 * Ítem 21/22, Fase 3 (06-ago-2026) -- catálogo cerrado de entidad
 * financiera para transferencia bancaria. Confirmado con el director:
 * mostrar el banco receptor de una transferencia real (nombre, y en el
 * futuro su logo tras confirmación legal) es un dato operativo, no
 * publicidad -- igual que cualquier factura o comprobante en Ecuador.
 * El hallazgo real que motivó esto: el nombre del banco vivía como
 * texto libre, sin ninguna forma confiable de saber "qué banco es" de
 * verdad.
 */
describe('Catálogo de entidad financiera (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();
  let pg: Client;
  let tokenCoop: string;

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

    // Setup: cooperativa real, mismo patrón ya usado en otras pruebas.
    const correoDirector = `director.entidad.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo: correoDirector,
      password: 'ClaveSegura123',
      nombres: 'Director',
      apellidos: 'Entidad E2E',
    });
    await pg.query("UPDATE usuarios SET rol='admin_plataforma' WHERE correo=$1", [correoDirector]);
    const loginDirector = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoDirector, password: 'ClaveSegura123' });
    const tokenAdmin = loginDirector.body.accessToken;

    const ruc = `07${sufijo}`.slice(0, 13);
    await request(app.getHttpServer())
      .post('/admin/cooperativas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        cooperativa: {
          ruc,
          razonSocial: `Coop Entidad E2E ${sufijo}`,
          nombreComercial: `Coop Entidad ${sufijo}`,
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: `admin.entidad.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombreCompleto: 'Admin Entidad E2E',
        },
      });
    const loginCoop = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: `admin.entidad.${sufijo}@ticketya.ec`, password: 'ClaveSegura123' });
    tokenCoop = loginCoop.body.accessToken;
  });

  afterAll(async () => {
    await limpiarCooperativasDePrueba([`Coop Entidad ${sufijo}`]);
    await pg.end();
    await app.close();
  });

  it('rechaza transferencia_bancaria SIN entidad financiera -- catálogo cerrado, obligatorio', async () => {
    const res = await request(app.getHttpServer())
      .post('/coop/metodos-pago')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipo: 'transferencia_bancaria',
        datosCuenta: { numeroCuenta: '2201234567', titular: 'Coop E2E' },
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('banco');
  });

  it('rechaza una entidad financiera que no está en el catálogo cerrado', async () => {
    const res = await request(app.getHttpServer())
      .post('/coop/metodos-pago')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipo: 'transferencia_bancaria',
        entidadFinanciera: 'banco_inventado_que_no_existe',
        datosCuenta: { numeroCuenta: '2201234567', titular: 'Coop E2E' },
      });
    expect(res.status).toBe(400);
  });

  it('acepta una entidad real del catálogo, y la devuelve tal cual al listar', async () => {
    await request(app.getHttpServer())
      .post('/coop/metodos-pago')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipo: 'transferencia_bancaria',
        entidadFinanciera: 'banco_guayaquil',
        datosCuenta: { numeroCuenta: '2201234567', titular: 'Coop E2E' },
      })
      .expect(201);

    const lista = await request(app.getHttpServer())
      .get('/coop/metodos-pago')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .expect(200);
    const metodo = lista.body.find((m: { tipo: string }) => m.tipo === 'transferencia_bancaria');
    expect(metodo.entidadFinanciera).toBe('banco_guayaquil');
  });

  it('acepta "otro" para un banco fuera del catálogo, sin exigir ningún dato adicional a nivel del backend', async () => {
    // Reutiliza la misma cooperativa -- el tipo ya está tomado, así que
    // esto es un "upsert" (mismo comportamiento que ya prueba otra suite).
    const res = await request(app.getHttpServer())
      .post('/coop/metodos-pago')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipo: 'transferencia_bancaria',
        entidadFinanciera: 'otro',
        datosCuenta: { banco: 'Banco Cooperativo Local XYZ', numeroCuenta: '999', titular: 'Coop E2E' },
      });
    expect(res.status).toBe(201);
  });

  it('efectivo, deuna y payphone NO exigen entidad financiera -- solo aplica a transferencia_bancaria', async () => {
    const res = await request(app.getHttpServer())
      .post('/coop/metodos-pago')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipo: 'efectivo',
        datosCuenta: { instrucciones: 'Pagar en la ventanilla de la terminal.' },
      });
    expect(res.status).toBe(201);

    const lista = await request(app.getHttpServer())
      .get('/coop/metodos-pago')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .expect(200);
    const metodo = lista.body.find((m: { tipo: string }) => m.tipo === 'efectivo');
    expect(metodo.entidadFinanciera).toBeNull();
  });
});
