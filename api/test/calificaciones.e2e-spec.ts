import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { Client } from 'pg';
import { limpiarCooperativasDePrueba } from './helpers/limpieza';

/**
 * RF nuevo, definido y construido el 22-jul-2026 — calificaciones de
 * viaje. Ver comentario de diseño completo en
 * packages/db/schema/calificaciones.ts.
 */
describe('Calificaciones de viaje (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();

  let viajeId: string;
  let cooperativaId: string;
  let tokenPasajero: string;
  let tokenOtroPasajero: string;
  let tokenCoop: string;
  let rutaId: string;
  let unidadId: string;
  let boletoId: string;
  const PRECIO_BASE = 10;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    const correoDirector = `director.calif.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo: correoDirector,
      password: 'ClaveSegura123',
      nombres: 'Director', apellidos: 'Calificaciones Prueba',
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
    const cooperativa = await request(app.getHttpServer())
      .post('/admin/cooperativas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        cooperativa: {
          ruc,
          razonSocial: `Coop Calificaciones E2E ${sufijo}`,
          nombreComercial: `Coop Calificaciones ${sufijo}`,
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: `admin.calif.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombreCompleto: 'Admin Calificaciones E2E',
        },
      });
    cooperativaId = cooperativa.body.cooperativaId;

    const loginCoop = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        correo: `admin.calif.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
      });
    tokenCoop = loginCoop.body.accessToken;

    // Hallazgo real (21-ago-2026): la busqueda real ahora filtra por
    // CIUDAD, no por punto exacto -- la ciudad tambien debe ser unica
    // por corrida para no chocar con anos de datos acumulados.
    const origen = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `Origen Calif ${sufijo}`,
        ciudad: `Machala Calif ${sufijo}`,
        provincia: 'El Oro',
      });

    const destino = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `Destino Calif ${sufijo}`,
        ciudad: `Guayaquil Calif ${sufijo}`,
        provincia: 'Guayas',
      });

    const tipo = await request(app.getHttpServer())
      .post('/coop/tipos-vehiculo')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({ nombre: `Tipo Calif ${sufijo}`, capacidadTotal: 20 });

    const unidad = await request(app.getHttpServer())
      .post('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipoVehiculoId: tipo.body.id,
        placa: `CAL-${sufijo % 100000}`,
        identificadorOperativo: `Op-${sufijo % 100000}`,
      });
    unidadId = unidad.body.id;

    const ruta = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        origenPuntoOperacionId: origen.body.puntoOperacionId,
        destinoPuntoOperacionId: destino.body.puntoOperacionId,
        precioBaseReferencia: PRECIO_BASE,
      });
    rutaId = ruta.body.id;

    const viaje = await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        rutaId: ruta.body.id,
        unidadId: unidad.body.id,
        fechaSalida: '2026-01-15', // en el pasado a propósito — para poder calificar en las pruebas de "camino feliz" (ver hallazgo 22-jul-2026 más abajo)
        horaSalidaProgramada: '2026-01-15T08:00:00-05:00',
        precioBase: PRECIO_BASE,
      });
    viajeId = viaje.body.id;

    const pasajero = await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: `pasajero.calif.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
        nombres: 'Pasajero', apellidos: 'Calificaciones Prueba',
      });
    tokenPasajero = pasajero.body.accessToken;

    const otroPasajero = await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: `otro.pasajero.calif.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
        nombres: 'Otro', apellidos: 'Pasajero Calificaciones Prueba',
      });
    tokenOtroPasajero = otroPasajero.body.accessToken;

    // Compra real de un boleto — sin esto, no hay nada legítimo que calificar.
    await request(app.getHttpServer())
      .post(`/viajes/${viajeId}/asientos/1A/bloquear`)
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .expect(201);
    const compra = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '1A',
            nombres: 'Pasajero',
            apellidos: 'Calificaciones Prueba',
            tipoDocumento: 'cedula',
            documento: '1701000000',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);
    boletoId = compra.body.boletos[0].id;
  });

  afterAll(async () => {
    await limpiarCooperativasDePrueba([`Coop Calificaciones ${sufijo}`]);
    await app.close();
  });

  it('rechaza una puntuación fuera de rango (RF nuevo, 22-jul-2026)', async () => {
    await request(app.getHttpServer())
      .post('/calificaciones')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({ boletoId, puntuacion: 6 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/calificaciones')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({ boletoId, puntuacion: 0 })
      .expect(400);
  });

  it('rechaza calificar un boleto que no le pertenece a quien lo intenta', async () => {
    await request(app.getHttpServer())
      .post('/calificaciones')
      .set('Authorization', `Bearer ${tokenOtroPasajero}`)
      .send({ boletoId, puntuacion: 5 })
      .expect(403);
  });

  it('el dueño real del boleto sí puede calificarlo, con comentario opcional', async () => {
    const res = await request(app.getHttpServer())
      .post('/calificaciones')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        boletoId,
        puntuacion: 5,
        comentario: 'Excelente viaje, muy puntual.',
      })
      .expect(201);
    expect(res.body.id).toBeDefined();
  });

  it('no permite calificar el mismo boleto dos veces', async () => {
    await request(app.getHttpServer())
      .post('/calificaciones')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({ boletoId, puntuacion: 3 })
      .expect(409);
  });

  it('rechaza calificar un viaje que todavía no ha llegado a su destino — hallazgo real, 22-jul-2026 (reportado en vivo por el usuario)', async () => {
    // Mismo escenario, pero con un viaje programado a futuro — no en el
    // pasado como el de arriba.
    const viajeFuturo = await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        rutaId,
        unidadId,
        fechaSalida: '2030-01-01',
        horaSalidaProgramada: '2030-01-01T08:00:00-05:00',
        precioBase: PRECIO_BASE,
      });

    await request(app.getHttpServer())
      .post(`/viajes/${viajeFuturo.body.id}/asientos/1A/bloquear`)
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .expect(201);
    const compraFutura = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId: viajeFuturo.body.id,
            numeroAsiento: '1A',
            nombres: 'Pasajero',
            apellidos: 'Calificaciones Prueba',
            tipoDocumento: 'cedula',
            documento: '1701001370',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);
    const boletoFuturoId = compraFutura.body.boletos[0].id;

    const res = await request(app.getHttpServer())
      .post('/calificaciones')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({ boletoId: boletoFuturoId, puntuacion: 5 })
      .expect(400);
    expect(res.body.message).toContain('destino');
  });

  /**
   * Ítem 12, Fase 2 (05-ago-2026) -- umbral mínimo de calificaciones
   * antes de mostrar el promedio, decisión del director confirmada con
   * datos reales (ninguna cooperativa de la base de desarrollo tenía
   * más de 1 calificación al momento de decidir el umbral). En este
   * punto del archivo solo existe 1 calificación (la de la prueba de
   * arriba) -- por debajo del umbral de 5, así que ni promedio ni
   * conteo deben aparecer, ni siquiera un aviso de "pocas reseñas".
   */
  it('con menos de 5 calificaciones, el promedio NO aparece en la búsqueda pública -- item 12 (05-ago-2026)', async () => {
    const res = await request(app.getHttpServer())
      .get('/viajes/buscar')
      .query({
        origenId: (
          await request(app.getHttpServer())
            .get('/puntos-operacion/buscar')
            .query({ texto: `Origen Calif ${sufijo}` })
        ).body[0].id,
        destinoId: (
          await request(app.getHttpServer())
            .get('/puntos-operacion/buscar')
            .query({ texto: `Destino Calif ${sufijo}` })
        ).body[0].id,
        fecha: '2026-01-15',
      })
      .expect(200);

    expect(res.body[0].cooperativaCalificacionPromedio).toBeNull();
  });

  /**
   * Reseñas de texto reales (13-ago-2026) -- mismo umbral que el
   * promedio (item 12): en este punto solo existe 1 calificación (con
   * comentario), por debajo del mínimo de 5 -- el endpoint debe
   * devolver la lista vacía, no un error, y nunca revelar el
   * comentario real todavía (mismo criterio de confianza que el
   * promedio: no exponer nada hasta tener suficientes datos).
   */
  it('con menos de 5 calificaciones, las reseñas de texto tampoco aparecen -- mismo umbral que el promedio', async () => {
    const res = await request(app.getHttpServer())
      .get(`/calificaciones/cooperativa/${cooperativaId}/resenas`)
      .expect(200);

    expect(res.body.resenas).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  /**
   * Sube la cooperativa a exactamente 5 calificaciones (el mínimo) --
   * 4 viajes nuevos, cada uno con su propio boleto y su propia
   * calificación de 5 estrellas, sumados a la que ya existe desde la
   * prueba "el dueño real del boleto sí puede calificarlo" de arriba.
   */
  it('llega al umbral mínimo de 5 calificaciones (preparación para la siguiente prueba)', async () => {
    for (let i = 0; i < 4; i++) {
      const viajeExtra = await request(app.getHttpServer())
        .post('/coop/viajes')
        .set('Authorization', `Bearer ${tokenCoop}`)
        .send({
          rutaId,
          unidadId,
          fechaSalida: '2026-01-16',
          horaSalidaProgramada: '2026-01-16T08:00:00-05:00',
          precioBase: PRECIO_BASE,
        });

      await request(app.getHttpServer())
        .post(`/viajes/${viajeExtra.body.id}/asientos/1A/bloquear`)
        .set('Authorization', `Bearer ${tokenPasajero}`)
        .expect(201);
      const compraExtra = await request(app.getHttpServer())
        .post('/compras')
        .set('Authorization', `Bearer ${tokenPasajero}`)
        .send({
          pasajeros: [
            {
              viajeId: viajeExtra.body.id,
              numeroAsiento: '1A',
              nombres: 'Pasajero',
              apellidos: 'Calificaciones Prueba',
              tipoDocumento: 'cedula',
              documento: ['1701002741', '1701004119', '1701005488', '1701006858', '1701008227', '1701009597', '1701010967', '1701012336'][i % 8],
              tipoTarifa: 'adulto',
            },
          ],
        })
        .expect(201);
      const boletoExtraId = compraExtra.body.boletos[0].id;

      await request(app.getHttpServer())
        .post('/calificaciones')
        .set('Authorization', `Bearer ${tokenPasajero}`)
        .send({ boletoId: boletoExtraId, puntuacion: 5 })
        .expect(201);
    }
  });

  it('el promedio de la cooperativa aparece en la búsqueda pública de viajes, con 5 calificaciones (umbral alcanzado) -- item 12 (05-ago-2026)', async () => {
    // 5 calificaciones, todas de 5 estrellas → promedio debe ser exactamente 5.
    const res = await request(app.getHttpServer())
      .get('/viajes/buscar')
      .query({
        origenId: (
          await request(app.getHttpServer())
            .get('/puntos-operacion/buscar')
            .query({ texto: `Origen Calif ${sufijo}` })
        ).body[0].id,
        destinoId: (
          await request(app.getHttpServer())
            .get('/puntos-operacion/buscar')
            .query({ texto: `Destino Calif ${sufijo}` })
        ).body[0].id,
        fecha: '2026-01-15',
      })
      .expect(200);

    expect(res.body[0].cooperativaCalificacionPromedio).toBe(5);
    expect(res.body[0].cooperativaCalificacionCantidad).toBe(5);
  });

  /**
   * Reseñas de texto reales (13-ago-2026), camino feliz -- con el
   * umbral ya alcanzado (5 calificaciones), pero solo 1 de ellas tiene
   * comentario (las otras 4, creadas en el bucle de arriba, no lo
   * llevan) -- confirma que el filtro "solo con comentario" funciona
   * de verdad, no solo el umbral.
   */
  it('con el umbral alcanzado, las reseñas de texto reales aparecen -- solo con comentario, solo el primer nombre del autor', async () => {
    const res = await request(app.getHttpServer())
      .get(`/calificaciones/cooperativa/${cooperativaId}/resenas`)
      .expect(200);

    expect(res.body.total).toBe(1); // solo 1 de las 5 calificaciones tiene comentario
    expect(res.body.pagina).toBe(1);
    expect(res.body.porPagina).toBe(10);
    expect(res.body.resenas).toHaveLength(1);
    expect(res.body.resenas[0].comentario).toBe('Excelente viaje, muy puntual.');
    expect(res.body.resenas[0].puntuacion).toBe(5);
    // Item 31.1 puso 'Pasajero' en nombres y 'Calificaciones E2E' en
    // apellidos -- solo el primer nombre debe llegar, nunca el apellido.
    expect(res.body.resenas[0].nombreAutor).toBe('Pasajero');
  });

  it('la paginación de reseñas respeta porPagina, y una página vacía no da error', async () => {
    const res = await request(app.getHttpServer())
      .get(`/calificaciones/cooperativa/${cooperativaId}/resenas`)
      .query({ pagina: 2, porPagina: 10 })
      .expect(200);

    // Solo hay 1 reseña real con comentario -- la página 2 debe venir vacía, no fallar.
    expect(res.body.resenas).toEqual([]);
    expect(res.body.total).toBe(1);
    expect(res.body.pagina).toBe(2);
  });

  it('"mis boletos" refleja correctamente cuándo sí se puede calificar, y trae el código QR de cada boleto — hallazgo real cerrado 22-jul-2026 (antes no venía, sin forma de recuperar el QR si se cerraba la pantalla de compra)', async () => {
    const res = await request(app.getHttpServer())
      .get('/calificaciones/mis-boletos')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .expect(200);

    const yaCalificado = res.body.find(
      (b: { boletoId: string }) => b.boletoId === boletoId,
    );
    expect(yaCalificado.yaCalificado).toBe(true);
    expect(yaCalificado.puedeCalificar).toBe(false);
    expect(yaCalificado.codigoQr).toBeDefined();
    expect(typeof yaCalificado.codigoQr).toBe('string');
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });
});
