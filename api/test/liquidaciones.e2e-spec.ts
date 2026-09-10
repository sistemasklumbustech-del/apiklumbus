import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { Client } from 'pg';
import { limpiarCooperativasDePrueba } from './helpers/limpieza';

/**
 * Liquidaciones a cooperativas — RF-ADMIN-003 (28-jul-2026, primera
 * entrega de Fase C).
 *
 * La regla más importante que cubre esta suite: el sistema debe
 * RECHAZAR generar una liquidación si el porcentaje de comisión de la
 * plataforma no está configurado — es una decisión de negocio
 * explícitamente pendiente según el SRS (RN-003), y el schema la deja
 * en null a propósito. Nunca debe asumir 0% en silencio.
 */
describe('Liquidaciones a cooperativas (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();
  const correoAdmin = `director.liq.${sufijo}@ticketya.ec`;
  const correoCoop = `admin.coop.liq.${sufijo}@ticketya.ec`;
  const ruc = `07${sufijo}`.slice(0, 13);

  let tokenAdmin: string;
  let cooperativaId: string;
  let liquidacionId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: correoAdmin,
        password: 'ClaveSegura123',
        nombres: 'Director', apellidos: 'Liquidaciones E2E',
        cedula: '0999999998',
      })
      .expect(201);

    const pg = new Client({
      connectionString:
        process.env.DATABASE_URL_ADMIN_DIRECTO ?? process.env.DATABASE_URL_PUBLICO,
    });
    await pg.connect();
    await pg.query(
      "UPDATE usuarios SET rol='admin_plataforma' WHERE correo=$1",
      [correoAdmin],
    );
    await pg.end();

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoAdmin, password: 'ClaveSegura123' })
      .expect(201);
    tokenAdmin = loginAdmin.body.accessToken;

    const coop = await request(app.getHttpServer())
      .post('/admin/cooperativas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        cooperativa: {
          ruc,
          razonSocial: 'Cooperativa Liquidaciones E2E S.A.',
          nombreComercial: 'Coop Liquidaciones E2E',
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: correoCoop,
          password: 'ClaveSegura123',
          nombreCompleto: 'Admin Cooperativa Liquidaciones E2E',
        },
      })
      .expect(201);
    cooperativaId = coop.body.cooperativaId;
  });

  afterAll(async () => {
    await limpiarCooperativasDePrueba(['Coop Liquidaciones E2E']);
    await app.close();
  });

  it('genera la liquidación con el modelo real: la cooperativa recibe el 100%, sin comisión porcentual', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/liquidaciones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        cooperativaId,
        periodoInicio: '2026-01-01',
        periodoFin: '2026-01-31',
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.estado).toBe('pendiente');
    // Cooperativa recién creada, sin ventas todavía — el cálculo debe
    // dar exactamente 0, no fallar ni inventar un número.
    expect(res.body.montoVentasBruto).toBe(0);
    // Corrección real de modelo de negocio (28-jul-2026): la plataforma
    // no descuenta comisión — la cooperativa siempre recibe el 100%.
    expect(res.body.montoComisionPlataforma).toBe(0);
    expect(res.body.montoLiquidado).toBe(res.body.montoVentasBruto);
    liquidacionId = res.body.id;
  });

  it('un token que no es admin_plataforma no puede generar liquidaciones (RBAC)', async () => {
    const loginCoop = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoCoop, password: 'ClaveSegura123' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/admin/liquidaciones')
      .set('Authorization', `Bearer ${loginCoop.body.accessToken}`)
      .send({
        cooperativaId,
        periodoInicio: '2026-06-01',
        periodoFin: '2026-06-30',
      })
      .expect(403);
  });

  it('RECHAZA generar una segunda liquidación con período solapado — evita pagar dos veces por las mismas ventas', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/liquidaciones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        cooperativaId,
        periodoInicio: '2026-01-15', // se solapa con la ya creada (01 al 31)
        periodoFin: '2026-02-15',
      })
      .expect(400);

    expect(res.body.message).toContain('solapa');
  });

  it('la liquidación creada aparece en el listado', async () => {
    const res = await request(app.getHttpServer())
      .get(`/admin/liquidaciones?cooperativaId=${cooperativaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect(res.body.some((l: { id: string }) => l.id === liquidacionId)).toBe(true);
  });

  it('marca la liquidación como pagada', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/liquidaciones/${liquidacionId}/pagar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/admin/liquidaciones?cooperativaId=${cooperativaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const liquidacion = res.body.find((l: { id: string }) => l.id === liquidacionId);
    expect(liquidacion.estado).toBe('pagada');
    expect(liquidacion.pagadoEn).toBeDefined();
  });

  it('RECHAZA marcar como pagada una liquidación que ya estaba pagada — no permite doble pago accidental', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/admin/liquidaciones/${liquidacionId}/pagar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(400);

    expect(res.body.message).toContain('ya estaba marcada como pagada');
  });
});
