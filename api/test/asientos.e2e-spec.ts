import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { Client } from 'pg';
import { limpiarCooperativasDePrueba } from './helpers/limpieza';

/**
 * Paso 3 del plan de blindaje del núcleo — el más delicado de los
 * cuatro. RF-SEAT-004/005: dos personas no pueden terminar con el mismo
 * asiento. Esto ya se verificó a mano el 19-20 de julio; aquí queda
 * automatizado con Promise.all disparando las dos peticiones lo más
 * simultáneamente posible que Node permite, para no depender de que
 * alguien lo repita a mano cada vez.
 */
describe('Selección de asientos (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();

  let viajeId: string;
  let tokenPasajero1: string;
  let tokenPasajero2: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    // --- Fixture: una cooperativa con un viaje real de 4 asientos ---
    const correoDirector = `director.asientos.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo: correoDirector,
      password: 'ClaveSegura123',
      nombres: 'Director', apellidos: 'Asientos E2E',
    });

    const pg = new Client({
      connectionString: process.env.DATABASE_URL_PUBLICO,
    });
    await pg.connect();
    await pg.query(
      "UPDATE usuarios SET rol='admin_plataforma' WHERE correo=$1",
      [correoDirector],
    );
    await pg.end();

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
          razonSocial: `Coop Asientos E2E ${sufijo}`,
          nombreComercial: `Coop Asientos ${sufijo}`,
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: `admin.asientos.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombreCompleto: 'Admin Asientos E2E',
        },
      });

    const loginCoop = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        correo: `admin.asientos.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
      });
    const tokenCoop = loginCoop.body.accessToken;

    const origen = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `Origen Asientos ${sufijo}`,
        ciudad: 'Machala',
        provincia: 'El Oro',
      });

    const destino = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `Destino Asientos ${sufijo}`,
        ciudad: 'Guayaquil',
        provincia: 'Guayas',
      });

    const tipo = await request(app.getHttpServer())
      .post('/coop/tipos-vehiculo')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({ nombre: `Tipo Asientos ${sufijo}`, capacidadTotal: 8 }); // 2 filas completas (2+2) — deja "2A" como asiento real y válido para las pruebas de abajo

    const unidad = await request(app.getHttpServer())
      .post('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipoVehiculoId: tipo.body.id,
        placa: `AST-${sufijo % 100000}`,
        identificadorOperativo: `Op-${sufijo % 100000}`,
      });

    const ruta = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        origenPuntoOperacionId: origen.body.puntoOperacionId,
        destinoPuntoOperacionId: destino.body.puntoOperacionId,
        precioBaseReferencia: 6,
      });

    const viaje = await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        rutaId: ruta.body.id,
        unidadId: unidad.body.id,
        fechaSalida: '2026-11-01',
        horaSalidaProgramada: '2026-11-01T08:00:00-05:00',
        precioBase: 6,
      });
    viajeId = viaje.body.id;

    // --- Dos pasajeros distintos, para el duelo por el mismo asiento ---
    const p1 = await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: `pasajero1.asientos.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
        nombres: 'Pasajero', apellidos: 'Uno',
      });
    tokenPasajero1 = p1.body.accessToken;

    const p2 = await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: `pasajero2.asientos.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
        nombres: 'Pasajero', apellidos: 'Dos',
      });
    tokenPasajero2 = p2.body.accessToken;
  });

  afterAll(async () => {
    // 22-jul-2026: limpieza real (ver test/helpers/limpieza.ts).
    await limpiarCooperativasDePrueba([`Coop Asientos ${sufijo}`]);
    await app.close();
  });

  it('el mapa de asientos es visible sin necesidad de estar logueado (RF-SEAT-001)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/viajes/${viajeId}/asientos`)
      .expect(200);
    expect(res.body).toBeDefined();
  });

  it('devuelve 404 si el viaje no existe', async () => {
    await request(app.getHttpServer())
      .get('/viajes/00000000-0000-0000-0000-000000000000/asientos')
      .expect(404);
  });

  // Item 31, Fase 7 (11-ago-2026) -- compra como invitado: ya NO se
  // exige estar logueado para bloquear, a proposito. Lo que sigue
  // siendo obligatorio es identificar quien hace el bloqueo -- con
  // token (cuenta real) O con sesionInvitadoId (invitado), nunca
  // ninguno de los 2.
  it('bloquear sin token y sin sesionInvitadoId se rechaza (400) -- hace falta identificar quien bloquea', async () => {
    await request(app.getHttpServer())
      .post(`/viajes/${viajeId}/asientos/1A/bloquear`)
      .expect(400);
  });

  it('un invitado sin cuenta SÍ puede bloquear un asiento, con sesionInvitadoId en el cuerpo (item 31, Fase 7)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/viajes/${viajeId}/asientos/2B/bloquear`)
      .send({ sesionInvitadoId: 'invitado-uuid-de-prueba' })
      .expect(201);
    expect(res.body.estado).toBe('bloqueado_temporal');
  });

  it('un pasajero puede bloquear un asiento disponible (RF-SEAT-004)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/viajes/${viajeId}/asientos/1A/bloquear`)
      .set('Authorization', `Bearer ${tokenPasajero1}`)
      .expect(201);
    expect(res.body.estado).toBe('bloqueado_temporal');
  });

  it('el mismo pasajero SÍ puede volver a bloquear su propio asiento (extiende su hold, no es un error) — comportamiento intencional, ver comentario en asiento.repositorio.drizzle.ts', async () => {
    const res = await request(app.getHttpServer())
      .post(`/viajes/${viajeId}/asientos/1A/bloquear`)
      .set('Authorization', `Bearer ${tokenPasajero1}`)
      .expect(201);
    expect(res.body.estado).toBe('bloqueado_temporal');
  });

  it('EL CASO CRÍTICO: dos pasajeros distintos disparan la petición por el MISMO asiento al mismo tiempo — exactamente uno gana (RF-SEAT-005)', async () => {
    // Asiento nuevo (2A), nunca antes tocado, para que el resultado de
    // esta prueba no dependa de las anteriores.
    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/viajes/${viajeId}/asientos/2A/bloquear`)
        .set('Authorization', `Bearer ${tokenPasajero1}`),
      request(app.getHttpServer())
        .post(`/viajes/${viajeId}/asientos/2A/bloquear`)
        .set('Authorization', `Bearer ${tokenPasajero2}`),
    ]);

    const statusCodes = [resA.status, resB.status].sort();
    // Uno debe ganar (201) y el otro debe perder con un error controlado
    // (409 Conflict) — nunca los dos con 201, y nunca un 500.
    expect(statusCodes).toEqual([201, 409]);
  });

  it('bloquear un número de asiento que NO existe en el vehículo se rechaza (404) — hallazgo cerrado 22-jul-2026, antes se aceptaba igual (201)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/viajes/${viajeId}/asientos/ZZ99/bloquear`)
      .set('Authorization', `Bearer ${tokenPasajero1}`);
    expect(res.status).toBe(404);
    expect(res.body.message).toContain('ZZ99');
  });
});
