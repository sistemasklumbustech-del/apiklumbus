import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { Client } from 'pg';

/**
 * Paradas intermedias de ruta -- RF-COOP-002, Fase 1 (PRs #130-#132,
 * 20-ago-2026). Hallazgo real de una verificación independiente
 * (20-ago-2026): el CRUD completo se construyó y se verificó contra
 * la suite existente (213/213 sin romper nada), pero nunca se agregó
 * ninguna prueba NUEVA para la función nueva en sí -- ni para el
 * aislamiento real entre cooperativas (RLS), que es exactamente la
 * pieza de seguridad que la migración 0039 corrigió. Esta suite
 * cierra ese hueco real.
 */
describe('Paradas intermedias de ruta (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();

  let tokenSuperAdmin: string;
  let tokenCoopA: string;
  let tokenCoopB: string;
  let rutaAId: string;
  let puntoParadaId: string;
  let viajeAId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    const correoDirector = `director.paradas.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo: correoDirector,
      password: 'ClaveSegura123',
      nombres: 'Director',
      apellidos: 'Paradas E2E',
    });
    const pg = new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
    await pg.connect();
    await pg.query("UPDATE usuarios SET rol='super_admin' WHERE correo=$1", [correoDirector]);
    await pg.end();
    const loginDirector = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoDirector, password: 'ClaveSegura123' });
    tokenSuperAdmin = loginDirector.body.accessToken;

    // --- 2 puntos de operación reales, para origen y destino de la ruta de Cooperativa A ---
    const origen = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ tipo: 'terminal_terrestre', nombre: `Origen Paradas ${sufijo}`, ciudad: 'Quito', provincia: 'Pichincha' });
    const destino = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ tipo: 'terminal_terrestre', nombre: `Destino Paradas ${sufijo}`, ciudad: 'Guayaquil', provincia: 'Guayas' });
    const puntoParada = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ tipo: 'terminal_terrestre', nombre: `Parada Real ${sufijo}`, ciudad: 'Riobamba', provincia: 'Chimborazo' });
    puntoParadaId = puntoParada.body.puntoOperacionId;

    // --- Cooperativa A (la dueña real de la ruta) ---
    const rucA = `17${sufijo}`.slice(0, 13);
    await request(app.getHttpServer())
      .post('/admin/cooperativas')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({
        cooperativa: {
          ruc: rucA,
          razonSocial: `Coop Paradas A E2E ${sufijo}`,
          nombreComercial: `Coop Paradas A ${sufijo}`,
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: `admin.paradasA.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombreCompleto: 'Admin Paradas A E2E',
        },
      });
    const loginCoopA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: `admin.paradasA.${sufijo}@ticketya.ec`, password: 'ClaveSegura123' });
    tokenCoopA = loginCoopA.body.accessToken;

    // --- Cooperativa B (para probar el rechazo cruzado real -- RLS) ---
    const rucB = `09${sufijo}`.slice(0, 13);
    await request(app.getHttpServer())
      .post('/admin/cooperativas')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({
        cooperativa: {
          ruc: rucB,
          razonSocial: `Coop Paradas B E2E ${sufijo}`,
          nombreComercial: `Coop Paradas B ${sufijo}`,
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: `admin.paradasB.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombreCompleto: 'Admin Paradas B E2E',
        },
      });
    const loginCoopB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: `admin.paradasB.${sufijo}@ticketya.ec`, password: 'ClaveSegura123' });
    tokenCoopB = loginCoopB.body.accessToken;

    // --- Ruta real de Cooperativa A ---
    const ruta = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoopA}`)
      .send({
        origenPuntoOperacionId: origen.body.puntoOperacionId,
        destinoPuntoOperacionId: destino.body.puntoOperacionId,
        precioBaseReferencia: 10,
      });
    rutaAId = ruta.body.id;

    // --- Viaje real, para probar el endpoint publico ---
    const tipo = await request(app.getHttpServer())
      .post('/coop/tipos-vehiculo')
      .set('Authorization', `Bearer ${tokenCoopA}`)
      .send({ nombre: `Tipo Paradas ${sufijo}`, capacidadTotal: 8 });
    const unidad = await request(app.getHttpServer())
      .post('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoopA}`)
      .send({ tipoVehiculoId: tipo.body.id, placa: `PRD-${sufijo % 100000}`, identificadorOperativo: `Op-${sufijo % 100000}` });
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const fechaSalida = manana.toISOString().slice(0, 10);
    const viaje = await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoopA}`)
      .send({
        rutaId: rutaAId,
        unidadId: unidad.body.id,
        fechaSalida,
        horaSalidaProgramada: `${fechaSalida}T08:00:00-05:00`,
        precioBase: 10,
      });
    viajeAId = viaje.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('la cooperativa dueña de la ruta puede agregar una parada real, con su propio precio', async () => {
    const res = await request(app.getHttpServer())
      .post('/coop/paradas')
      .set('Authorization', `Bearer ${tokenCoopA}`)
      .send({
        rutaId: rutaAId,
        puntoOperacionId: puntoParadaId,
        orden: 1,
        tarifaDesdeOrigen: 5,
        tiempoEstimadoDesdeOrigenMinutos: 120,
      })
      .expect(201);
    expect(res.body.id).toBeDefined();
  });

  it('el endpoint público (sin autenticación) muestra las paradas reales de un viaje, para el pasajero', async () => {
    const res = await request(app.getHttpServer())
      .get(`/viajes/${viajeAId}/paradas`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].ciudad).toBe('Riobamba');
    expect(Number(res.body[0].tarifaDesdeOrigen)).toBe(5);
  });

  it('la cooperativa dueña puede listar sus propias paradas, con el precio real que puso', async () => {
    const res = await request(app.getHttpServer())
      .get(`/coop/rutas/${rutaAId}/paradas`)
      .set('Authorization', `Bearer ${tokenCoopA}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(Number(res.body[0].tarifaDesdeOrigen)).toBe(5);
    expect(res.body[0].puntoOperacionCiudad).toBe('Riobamba');
  });

  it('hallazgo de seguridad real cerrado (RLS, migración 0039): la Cooperativa B NO ve las paradas de la Cooperativa A', async () => {
    const res = await request(app.getHttpServer())
      .get(`/coop/rutas/${rutaAId}/paradas`)
      .set('Authorization', `Bearer ${tokenCoopB}`)
      .expect(200);
    // RLS filtra en silencio -- lista vacía, no un error, mismo
    // patrón real ya usado en el resto de la plataforma.
    expect(res.body).toHaveLength(0);
  });

  it('la Cooperativa B NO puede editar una parada que pertenece a la Cooperativa A', async () => {
    const paradas = await request(app.getHttpServer())
      .get(`/coop/rutas/${rutaAId}/paradas`)
      .set('Authorization', `Bearer ${tokenCoopA}`);
    const paradaId = paradas.body[0].id;

    const res = await request(app.getHttpServer())
      .patch(`/coop/paradas/${paradaId}`)
      .set('Authorization', `Bearer ${tokenCoopB}`)
      .send({ tarifaDesdeOrigen: 999 });
    expect(res.status).toBe(400); // "Esta parada no existe" -- RLS la esconde, no un 403 explícito

    const verificar = await request(app.getHttpServer())
      .get(`/coop/rutas/${rutaAId}/paradas`)
      .set('Authorization', `Bearer ${tokenCoopA}`);
    expect(Number(verificar.body[0].tarifaDesdeOrigen)).toBe(5); // intacta, no 999
  });

  it('la Cooperativa B NO puede eliminar una parada que pertenece a la Cooperativa A', async () => {
    const paradas = await request(app.getHttpServer())
      .get(`/coop/rutas/${rutaAId}/paradas`)
      .set('Authorization', `Bearer ${tokenCoopA}`);
    const paradaId = paradas.body[0].id;

    await request(app.getHttpServer())
      .delete(`/coop/paradas/${paradaId}`)
      .set('Authorization', `Bearer ${tokenCoopB}`)
      .expect(400);

    const verificar = await request(app.getHttpServer())
      .get(`/coop/rutas/${rutaAId}/paradas`)
      .set('Authorization', `Bearer ${tokenCoopA}`);
    expect(verificar.body).toHaveLength(1); // sigue existiendo
  });

  it('la cooperativa dueña sí puede editar el precio real de su propia parada', async () => {
    const paradas = await request(app.getHttpServer())
      .get(`/coop/rutas/${rutaAId}/paradas`)
      .set('Authorization', `Bearer ${tokenCoopA}`);
    const paradaId = paradas.body[0].id;

    await request(app.getHttpServer())
      .patch(`/coop/paradas/${paradaId}`)
      .set('Authorization', `Bearer ${tokenCoopA}`)
      .send({ tarifaDesdeOrigen: 7.5 })
      .expect(200);

    const verificar = await request(app.getHttpServer())
      .get(`/coop/rutas/${rutaAId}/paradas`)
      .set('Authorization', `Bearer ${tokenCoopA}`);
    expect(Number(verificar.body[0].tarifaDesdeOrigen)).toBe(7.5);
  });

  it('la cooperativa dueña sí puede eliminar su propia parada', async () => {
    const paradas = await request(app.getHttpServer())
      .get(`/coop/rutas/${rutaAId}/paradas`)
      .set('Authorization', `Bearer ${tokenCoopA}`);
    const paradaId = paradas.body[0].id;

    await request(app.getHttpServer())
      .delete(`/coop/paradas/${paradaId}`)
      .set('Authorization', `Bearer ${tokenCoopA}`)
      .expect(200);

    const verificar = await request(app.getHttpServer())
      .get(`/coop/rutas/${rutaAId}/paradas`)
      .set('Authorization', `Bearer ${tokenCoopA}`);
    expect(verificar.body).toHaveLength(0);
  });
});
