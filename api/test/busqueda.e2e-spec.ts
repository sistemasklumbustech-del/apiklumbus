import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { Client } from 'pg';
import {
  limpiarCooperativasDePrueba,
  limpiarPuntosDePruebaPorNombre,
} from './helpers/limpieza';

/**
 * Paso 2 del plan de blindaje del núcleo. Cubre RF-BUS-001, 002, 003 y
 * 006. Monta un escenario de datos real con DOS cooperativas distintas
 * operando la misma ruta el mismo día, para probar de verdad el
 * requisito "resultados multi-cooperativa" (RF-BUS-003) — no alcanza
 * con una sola cooperativa para probarlo honestamente.
 */
describe('Búsqueda de rutas (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();

  let puntoOrigenId: string;
  let puntoDestinoId: string;
  let puntoRelevanciaExactoId: string;
  let puntoRelevanciaParcialId: string;
  let tokenCoopA: string;
  let tokenCoopB: string;

  async function crearCooperativaConAdmin(
    nombreComercial: string,
    correoAdmin: string,
  ) {
    const correoDirector = `director.busqueda.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: correoDirector,
        password: 'ClaveSegura123',
        nombres: 'Director', apellidos: 'Búsqueda E2E',
      })
      .catch(() => {});

    const pg = new Client({
      connectionString: process.env.DATABASE_URL_PUBLICO,
    });
    await pg.connect();
    await pg.query(
      "UPDATE usuarios SET rol='admin_plataforma' WHERE correo=$1 AND rol != 'admin_plataforma'",
      [correoDirector],
    );
    await pg.end();

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoDirector, password: 'ClaveSegura123' });
    const tokenAdmin = login.body.accessToken;

    const ruc = `07${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(
      0,
      13,
    );
    await request(app.getHttpServer())
      .post('/admin/cooperativas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        cooperativa: {
          ruc,
          razonSocial: `${nombreComercial} Razón Social`,
          nombreComercial,
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: correoAdmin,
          password: 'ClaveSegura123',
          nombreCompleto: `Admin ${nombreComercial}`,
        },
      });

    const loginCoop = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoAdmin, password: 'ClaveSegura123' });
    return loginCoop.body.accessToken as string;
  }

  async function crearViajeCompleto(
    token: string,
    precioBase: number,
    capacidad: number,
  ) {
    const tipo = await request(app.getHttpServer())
      .post('/coop/tipos-vehiculo')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Tipo ${sufijo}-${capacidad}`,
        capacidadTotal: capacidad,
      });

    const unidad = await request(app.getHttpServer())
      .post('/coop/unidades')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipoVehiculoId: tipo.body.id,
        placa: `BUS-${Date.now() % 100000}`,
        identificadorOperativo: `Op-${Date.now() % 100000}`,
      });

    const ruta = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        origenPuntoOperacionId: puntoOrigenId,
        destinoPuntoOperacionId: puntoDestinoId,
        precioBaseReferencia: precioBase,
      });

    await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        rutaId: ruta.body.id,
        unidadId: unidad.body.id,
        fechaSalida: '2026-10-01',
        horaSalidaProgramada: '2026-10-01T08:00:00-05:00',
        precioBase,
      });
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

    tokenCoopA = await crearCooperativaConAdmin(
      `Coop Búsqueda A ${sufijo}`,
      `admin.a.${sufijo}@ticketya.ec`,
    );

    const loginDirector = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        correo: `director.busqueda.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
      });

    // Hallazgo real (21-ago-2026): desde que la busqueda real filtra
    // por CIUDAD (orden del director, ejemplo real Tulcan Carcelen vs
    // Quitumbe), la ciudad tambien debe ser unica por corrida -- antes
    // "Machala"/"Guayaquil" a secas no importaba porque se exigia el
    // punto EXACTO. Ahora, sin el sufijo, colisiona con anos de datos
    // acumulados de corridas anteriores en la BD local de pruebas.
    const origen = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${loginDirector.body.accessToken}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `Origen Búsqueda ${sufijo}`,
        ciudad: `Machala Prueba ${sufijo}`,
        provincia: 'El Oro',
      });
    puntoOrigenId = origen.body.puntoOperacionId;

    const destino = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${loginDirector.body.accessToken}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `Destino Búsqueda ${sufijo}`,
        ciudad: `Guayaquil Prueba ${sufijo}`,
        provincia: 'Guayas',
      });
    puntoDestinoId = destino.body.puntoOperacionId;

    // Dos puntos deliberadamente parecidos en el texto, para probar el
    // orden por relevancia sin depender de datos de otras corridas de
    // pruebas (que sí acumulan "Machala" real de sesiones anteriores).
    const exacto = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${loginDirector.body.accessToken}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `Terminal Relevancia ${sufijo}`,
        ciudad: `ZzRelevancia${sufijo}`, // coincidencia EXACTA de ciudad con el texto buscado
        provincia: 'El Oro',
      });
    puntoRelevanciaExactoId = exacto.body.puntoOperacionId;

    // Hallazgo real (21-ago-2026): este punto era 'oficina_agencia' a
    // proposito, pero ahora la busqueda real (orden del director)
    // excluye oficinas del desplegable de sugerencias -- cambiado a
    // terminal_terrestre para seguir probando el orden de relevancia,
    // que es la intencion real de esta prueba, no el tipo del punto.
    const parcial = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${loginDirector.body.accessToken}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `ZzRelevancia${sufijo} Sucursal Norte`, // solo el NOMBRE empieza así, la ciudad es otra
        ciudad: 'Otra Ciudad',
        provincia: 'El Oro',
      });
    puntoRelevanciaParcialId = parcial.body.puntoOperacionId;

    // Fase 7-portada (07-ago-2026) -- el buscador de terminales ahora
    // filtra solo puntos con al menos una ruta real (ver
    // busqueda.service.ts, tieneRutaReal). Sin esto, ambos puntos de
    // prueba de esta suite quedarian invisibles para el autocompletado
    // y esta prueba fallaria por una razon ajena a lo que en realidad
    // verifica (el orden de relevancia, no la existencia de rutas).
    await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoopA}`)
      .send({
        origenPuntoOperacionId: puntoRelevanciaExactoId,
        destinoPuntoOperacionId: puntoRelevanciaParcialId,
        precioBaseReferencia: 5,
      });

    tokenCoopB = await crearCooperativaConAdmin(
      `Coop Búsqueda B ${sufijo}`,
      `admin.b.${sufijo}@ticketya.ec`,
    );

    await crearViajeCompleto(tokenCoopA, 6.0, 40);
    await crearViajeCompleto(tokenCoopB, 8.5, 4);
  });

  afterAll(async () => {
    // 22-jul-2026: limpieza real (ver test/helpers/limpieza.ts) — este
    // archivo era, junto con checkout y asientos, el que más
    // acumulaba datos sin borrar nada al final.
    await limpiarCooperativasDePrueba([
      `Coop Búsqueda A ${sufijo}`,
      `Coop Búsqueda B ${sufijo}`,
    ]);
    await limpiarPuntosDePruebaPorNombre([
      `Terminal Relevancia ${sufijo}`,
      `ZzRelevancia${sufijo} Sucursal Norte`,
    ]);
    await app.close();
  });

  describe('Autocompletado de ciudades (RF-BUS-002)', () => {
    it('encuentra el punto de operación creado, buscando por su nombre único', async () => {
      const res = await request(app.getHttpServer())
        .get('/puntos-operacion/buscar')
        .query({ texto: `Origen Búsqueda ${sufijo}` })
        .expect(200);
      expect(res.body.some((p: { id: string }) => p.id === puntoOrigenId)).toBe(
        true,
      );
    });

    it('rechaza una búsqueda de menos de 2 caracteres', async () => {
      await request(app.getHttpServer())
        .get('/puntos-operacion/buscar')
        .query({ texto: 'M' })
        .expect(400);
    });

    it('ordena por relevancia: coincidencia EXACTA de ciudad antes que una coincidencia parcial de nombre (hallazgo cerrado 22-jul-2026)', async () => {
      const res = await request(app.getHttpServer())
        .get('/puntos-operacion/buscar')
        .query({ texto: `ZzRelevancia${sufijo}` })
        .expect(200);

      const ids = res.body.map((p: { id: string }) => p.id);
      const posExacto = ids.indexOf(puntoRelevanciaExactoId);
      const posParcial = ids.indexOf(puntoRelevanciaParcialId);

      expect(posExacto).toBeGreaterThanOrEqual(0);
      expect(posParcial).toBeGreaterThanOrEqual(0);
      expect(posExacto).toBeLessThan(posParcial);
    });

    it('respeta el límite de 10 resultados', async () => {
      const res = await request(app.getHttpServer())
        .get('/puntos-operacion/buscar')
        .query({ texto: 'Machala' })
        .expect(200);
      expect(res.body.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Terminales aliadas (Fase 2-portada, 16-ago-2026)', () => {
    it('lista terminales aprobadas SIN necesitar texto de búsqueda -- una terminal recién aliada debe verse desde el primer día', async () => {
      const res = await request(app.getHttpServer())
        .get('/puntos-operacion/aliadas')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const encontrada = res.body.find((p: { id: string }) => p.id === puntoOrigenId);
      expect(encontrada).toBeDefined();
      // Hallazgo real (21-ago-2026): esta prueba reutiliza el mismo
      // punto que el fixture de arriba, cuya ciudad ahora es unica
      // por corrida (ver el hallazgo real de busqueda por ciudad).
      expect(encontrada.ciudad).toBe(`Machala Prueba ${sufijo}`);
    });

    it('no exige ningún query param -- distinto a /puntos-operacion/buscar, que rechaza texto corto', async () => {
      await request(app.getHttpServer()).get('/puntos-operacion/aliadas').expect(200);
    });
  });

  describe('Búsqueda de viajes (RF-BUS-001, 003, 006)', () => {
    it('devuelve resultados de AMBAS cooperativas para la misma ruta y fecha (RF-BUS-003, multi-cooperativa)', async () => {
      const res = await request(app.getHttpServer())
        .get('/viajes/buscar')
        .query({
          origenId: puntoOrigenId,
          destinoId: puntoDestinoId,
          fecha: '2026-10-01',
        })
        .expect(200);

      const nombres = res.body.map(
        (v: { cooperativaNombre: string }) => v.cooperativaNombre,
      );
      expect(nombres).toContain(`Coop Búsqueda A ${sufijo}`);
      expect(nombres).toContain(`Coop Búsqueda B ${sufijo}`);

      // El campo debe existir en la respuesta (aunque sea null si la
      // cooperativa no cargó logo) — 22-jul-2026, para que el frontend
      // de resultados de búsqueda pueda mostrarlo.
      expect(res.body[0]).toHaveProperty('cooperativaLogoUrl');
    });

    it('ordena los resultados por hora de salida (RF-BUS-001)', async () => {
      const res = await request(app.getHttpServer())
        .get('/viajes/buscar')
        .query({
          origenId: puntoOrigenId,
          destinoId: puntoDestinoId,
          fecha: '2026-10-01',
        })
        .expect(200);

      const horas = res.body.map((v: { horaSalidaProgramada: string }) =>
        new Date(v.horaSalidaProgramada).getTime(),
      );
      const horasOrdenadas = [...horas].sort((a, b) => a - b);
      expect(horas).toEqual(horasOrdenadas);
    });

    it('reporta la disponibilidad real de asientos según la capacidad del tipo de vehículo (RF-BUS-006)', async () => {
      const res = await request(app.getHttpServer())
        .get('/viajes/buscar')
        .query({
          origenId: puntoOrigenId,
          destinoId: puntoDestinoId,
          fecha: '2026-10-01',
        })
        .expect(200);

      const viajeCoopB = res.body.find(
        (v: { cooperativaNombre: string }) =>
          v.cooperativaNombre === `Coop Búsqueda B ${sufijo}`,
      );
      expect(viajeCoopB.asientosDisponibles).toBe(4);
    });

    it('filtra correctamente cuando se piden más pasajeros de los que caben en la unidad más chica', async () => {
      const res = await request(app.getHttpServer())
        .get('/viajes/buscar')
        .query({
          origenId: puntoOrigenId,
          destinoId: puntoDestinoId,
          fecha: '2026-10-01',
          pasajeros: 5,
        })
        .expect(200);

      const nombres = res.body.map(
        (v: { cooperativaNombre: string }) => v.cooperativaNombre,
      );
      expect(nombres).toContain(`Coop Búsqueda A ${sufijo}`);
      expect(nombres).not.toContain(`Coop Búsqueda B ${sufijo}`);
    });

    it('devuelve un arreglo vacío para una fecha sin viajes programados, no un error', async () => {
      const res = await request(app.getHttpServer())
        .get('/viajes/buscar')
        .query({
          origenId: puntoOrigenId,
          destinoId: puntoDestinoId,
          fecha: '2030-01-01',
        })
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('rechaza un origenId que no es un UUID válido (400)', async () => {
      await request(app.getHttpServer())
        .get('/viajes/buscar')
        .query({
          origenId: 'no-es-un-uuid',
          destinoId: puntoDestinoId,
          fecha: '2026-10-01',
        })
        .expect(400);
    });
  });
});
