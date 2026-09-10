import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { Client } from 'pg';

/**
 * Cooperativas proponen sus propios puntos de operación (13-ago-2026).
 * Diseño investigado contra plataformas marketplace reales: modelo
 * mixto -- la cooperativa propone, el admin aprueba antes de
 * publicarse. Ver DOCUMENTO_MAESTRO.md para el detalle completo.
 */
describe('Cooperativas proponen puntos de operación (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();

  let tokenSuperAdmin: string;
  let tokenCoop: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    const correoDirector = `director.puntos.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo: correoDirector,
      password: 'ClaveSegura123',
      nombres: 'Director', apellidos: 'Puntos E2E',
    });
    const pg = new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
    await pg.connect();
    await pg.query(
      "UPDATE usuarios SET rol='super_admin' WHERE correo=$1",
      [correoDirector],
    );
    await pg.end();
    const loginDirector = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoDirector, password: 'ClaveSegura123' });
    tokenSuperAdmin = loginDirector.body.accessToken;

    const ruc = `07${sufijo}`.slice(0, 13);
    await request(app.getHttpServer())
      .post('/admin/cooperativas')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({
        cooperativa: {
          ruc,
          razonSocial: `Coop Puntos E2E ${sufijo}`,
          nombreComercial: `Coop Puntos ${sufijo}`,
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: `admin.puntos.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombreCompleto: 'Admin Puntos E2E',
        },
      });
    const loginCoop = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: `admin.puntos.${sufijo}@ticketya.ec`, password: 'ClaveSegura123' });
    tokenCoop = loginCoop.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('una cooperativa puede proponer una oficina/parada, queda pendiente', async () => {
    const res = await request(app.getHttpServer())
      .post('/coop/puntos-operacion')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipo: 'oficina_agencia',
        nombre: `Oficina Propuesta ${sufijo}`,
        ciudad: 'Machala',
        provincia: 'El Oro',
      })
      .expect(201);

    const pg = new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
    await pg.connect();
    const fila = await pg.query(
      'SELECT estado, cooperativa_propietaria_id FROM puntos_operacion WHERE id = $1',
      [res.body.id],
    );
    await pg.end();

    expect(fila.rows[0].estado).toBe('pendiente_revision');
    expect(fila.rows[0].cooperativa_propietaria_id).toBeDefined();
  });

  it('una cooperativa NO puede proponer un terminal_terrestre -- rechaza con 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/coop/puntos-operacion')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `Terminal Intento ${sufijo}`,
        ciudad: 'Machala',
        provincia: 'El Oro',
      });
    expect(res.status).toBe(400);
  });

  it('el admin puede ver la lista de pendientes, aprobar, y rechazar', async () => {
    const propuestaAprobar = await request(app.getHttpServer())
      .post('/coop/puntos-operacion')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipo: 'parada_intermedia',
        nombre: `Parada A Aprobar ${sufijo}`,
        ciudad: 'Pasaje',
        provincia: 'El Oro',
      })
      .expect(201);

    const propuestaRechazar = await request(app.getHttpServer())
      .post('/coop/puntos-operacion')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipo: 'parada_intermedia',
        nombre: `Parada A Rechazar ${sufijo}`,
        ciudad: 'Pasaje',
        provincia: 'El Oro',
      })
      .expect(201);

    const pendientes = await request(app.getHttpServer())
      .get('/admin/puntos-operacion/pendientes')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    const idsPendientes = (pendientes.body as { id: string }[]).map((p) => p.id);
    expect(idsPendientes).toContain(propuestaAprobar.body.id);
    expect(idsPendientes).toContain(propuestaRechazar.body.id);

    await request(app.getHttpServer())
      .patch(`/admin/puntos-operacion/${propuestaAprobar.body.id}/aprobar`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/admin/puntos-operacion/${propuestaRechazar.body.id}/rechazar`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    const pg = new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
    await pg.connect();
    const filaAprobada = await pg.query(
      'SELECT estado, aprobado_por_usuario_id, aprobado_en FROM puntos_operacion WHERE id = $1',
      [propuestaAprobar.body.id],
    );
    const filaRechazada = await pg.query(
      'SELECT estado FROM puntos_operacion WHERE id = $1',
      [propuestaRechazar.body.id],
    );
    await pg.end();

    expect(filaAprobada.rows[0].estado).toBe('aprobado');
    expect(filaAprobada.rows[0].aprobado_por_usuario_id).toBeDefined();
    expect(filaAprobada.rows[0].aprobado_en).toBeDefined();
    expect(filaRechazada.rows[0].estado).toBe('rechazado');

    const pendientesFinal = await request(app.getHttpServer())
      .get('/admin/puntos-operacion/pendientes')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    const idsPendientesFinal = (pendientesFinal.body as { id: string }[]).map((p) => p.id);
    expect(idsPendientesFinal).not.toContain(propuestaAprobar.body.id);
    expect(idsPendientesFinal).not.toContain(propuestaRechazar.body.id);
  });

  it('una cooperativa no puede aprobar sus propias propuestas -- endpoint exclusivo del admin', async () => {
    const propuesta = await request(app.getHttpServer())
      .post('/coop/puntos-operacion')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipo: 'oficina_agencia',
        nombre: `Oficina Autoaprobacion ${sufijo}`,
        ciudad: 'Machala',
        provincia: 'El Oro',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/admin/puntos-operacion/${propuesta.body.id}/aprobar`)
      .set('Authorization', `Bearer ${tokenCoop}`)
      .expect(403);

    const pg = new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
    await pg.connect();
    const fila = await pg.query(
      'SELECT estado FROM puntos_operacion WHERE id = $1',
      [propuesta.body.id],
    );
    await pg.end();
    expect(fila.rows[0].estado).toBe('pendiente_revision');
  });

  it('un punto pendiente NO aparece en la búsqueda pública real (rutas disponibles); uno aprobado sí', async () => {
    const propuesta = await request(app.getHttpServer())
      .post('/coop/puntos-operacion')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipo: 'oficina_agencia',
        nombre: `Oficina Busqueda Publica ${sufijo}`,
        ciudad: `Loja Prueba ${sufijo}`,
        provincia: 'Loja',
      })
      .expect(201);

    // Un destino ya aprobado real (creado directo por el admin, mismo
    // flujo de siempre) -- para que la única variable en juego sea el
    // estado del ORIGEN, nada más. Ciudad unica por corrida (hallazgo
    // real 21-ago-2026, la busqueda ahora filtra por ciudad).
    const destinoAprobado = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `Terminal Destino Busqueda ${sufijo}`,
        ciudad: `Cuenca Prueba ${sufijo}`,
        provincia: 'Azuay',
      })
      .expect(201);

    // Se usa el punto TODAVÍA pendiente como origen de una ruta real --
    // el sistema permite crear la ruta (el punto existe), lo que se
    // prueba es que NO aparezca en el listado público hasta aprobarse.
    const ruta = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        origenPuntoOperacionId: propuesta.body.id,
        destinoPuntoOperacionId: destinoAprobado.body.puntoOperacionId,
        precioBaseReferencia: 12,
      })
      .expect(201);

    const tipo = await request(app.getHttpServer())
      .post('/coop/tipos-vehiculo')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({ nombre: `Tipo Busqueda Publica ${sufijo}`, capacidadTotal: 20 });
    const unidad = await request(app.getHttpServer())
      .post('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipoVehiculoId: tipo.body.id,
        placa: `PUB-${sufijo % 100000}`,
        identificadorOperativo: `Op-Pub-${sufijo % 100000}`,
      });
    await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        rutaId: ruta.body.id,
        unidadId: unidad.body.id,
        fechaSalida: '2026-06-15',
        horaSalidaProgramada: '2026-06-15T08:00:00-05:00',
        precioBase: 12,
      });

    // /rutas-disponibles trae solo el top 6 más antiguo -- con una base
    // de datos compartida entre suites, una ruta nueva jamás entraría
    // ahí sin importar el estado del punto (limitación real del
    // endpoint, no del filtro que se está probando). /viajes/buscar es
    // el candidato correcto: filtra por origenId/destinoId exactos, sin
    // ese límite.
    const antesDeAprobar = await request(app.getHttpServer())
      .get('/viajes/buscar')
      .query({ origenId: propuesta.body.id, destinoId: destinoAprobado.body.puntoOperacionId, fecha: '2026-06-15' })
      .expect(200);
    expect(antesDeAprobar.body).toEqual([]);

    await request(app.getHttpServer())
      .patch(`/admin/puntos-operacion/${propuesta.body.id}/aprobar`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    const despuesDeAprobar = await request(app.getHttpServer())
      .get('/viajes/buscar')
      .query({ origenId: propuesta.body.id, destinoId: destinoAprobado.body.puntoOperacionId, fecha: '2026-06-15' })
      .expect(200);
    expect(despuesDeAprobar.body.length).toBeGreaterThan(0);
  });
});
