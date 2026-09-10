import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { Client } from 'pg';
import { limpiarCooperativasDePrueba } from './helpers/limpieza';
import { GeneradorViajesService } from '../src/aplicacion/generador-viajes/generador-viajes.service';

/**
 * Ítem 7, Fase 2 (03-ago-2026) — horarios recurrentes (plantilla) y
 * cancelación/suspensión masiva. Cubre las 2 decisiones de diseño reales
 * confirmadas por el director antes de construir:
 *
 * 1) La plantilla NUNCA sobrescribe una edición manual — solo hace
 *    INSERT si no existe ya un viaje para (horario, fecha). Se prueba
 *    llamando al generador dos veces, con una edición manual en medio.
 * 2) Cancelar (individual o masivo) SÍ cancela boletos vendidos,
 *    generando crédito automático por el monto pagado — no deja al
 *    pasajero sin nada.
 *
 * Pendiente honesto, fuera del alcance de esta entrega: no se prueba
 * cancelación masiva con boletos vendidos mezclados con viajes vacíos
 * en la misma corrida (se prueban por separado) ni la notificación de
 * WhatsApp en sí (el simulador solo hace `console.log`, no hay nada
 * verificable por HTTP).
 */
describe('Horarios recurrentes y cancelación masiva (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();
  const correoAdmin = `director.horarios.${sufijo}@ticketya.ec`;
  const correoCoop = `admin.coop.horarios.${sufijo}@ticketya.ec`;
  const correoPasajero = `pasajero.horarios.${sufijo}@ticketya.ec`;
  const ruc = `08${sufijo}`.slice(0, 13);

  let tokenAdmin: string;
  let tokenCoop: string;
  let tokenPasajero: string;
  let puntoOrigenId: string;
  let puntoDestinoId: string;
  let tipoVehiculoId: string;
  let unidadId: string;
  let rutaId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: correoAdmin,
        password: 'ClaveSegura123',
        nombres: 'Director',
        apellidos: 'Horarios Prueba',
        cedula: '0999999998',
      })
      .expect(201);

    const pg = new Client({
      connectionString:
        process.env.DATABASE_URL_ADMIN_DIRECTO ??
        process.env.DATABASE_URL_PUBLICO,
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

    await request(app.getHttpServer())
      .post('/admin/cooperativas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        cooperativa: {
          ruc,
          razonSocial: 'Cooperativa Horarios E2E S.A.',
          nombreComercial: 'Coop Horarios E2E',
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: correoCoop,
          password: 'ClaveSegura123',
          nombreCompleto: 'Admin Coop Horarios E2E',
        },
      })
      .expect(201);

    const loginCoop = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoCoop, password: 'ClaveSegura123' })
      .expect(201);
    tokenCoop = loginCoop.body.accessToken;

    await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: correoPasajero,
        password: 'ClaveSegura123',
        nombres: 'Pasajero',
        apellidos: 'Horarios Prueba',
        cedula: '0999999997',
      })
      .expect(201);
    const loginPasajero = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoPasajero, password: 'ClaveSegura123' })
      .expect(201);
    tokenPasajero = loginPasajero.body.accessToken;

    const origen = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `Terminal Horarios Origen ${sufijo}`,
        ciudad: 'Machala',
        provincia: 'El Oro',
      })
      .expect(201);
    puntoOrigenId = origen.body.puntoOperacionId;

    const destino = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `Terminal Horarios Destino ${sufijo}`,
        ciudad: 'Guayaquil',
        provincia: 'Guayas',
      })
      .expect(201);
    puntoDestinoId = destino.body.puntoOperacionId;

    const tipoVeh = await request(app.getHttpServer())
      .post('/coop/tipos-vehiculo')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({ nombre: 'Bus Horarios E2E', capacidadTotal: 40 })
      .expect(201);
    tipoVehiculoId = tipoVeh.body.id;

    const unidad = await request(app.getHttpServer())
      .post('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipoVehiculoId,
        placa: `HOR-${sufijo}`.slice(0, 10),
        identificadorOperativo: `Disco Horarios ${sufijo}`,
      })
      .expect(201);
    unidadId = unidad.body.id;

    const ruta = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        origenPuntoOperacionId: puntoOrigenId,
        destinoPuntoOperacionId: puntoDestinoId,
        precioBaseReferencia: 7.5,
        nombre: 'Ruta Horarios E2E',
      })
      .expect(201);
    rutaId = ruta.body.id;
  });

  afterAll(async () => {
    await limpiarCooperativasDePrueba(['Coop Horarios E2E']);
    await app.close();
  });

  describe('Horarios recurrentes (plantilla, RF-COOP-002)', () => {
    let horarioId: string;
    const hoy = new Date().getDay(); // 0=domingo..6=sábado, mismo formato que la BD

    it('crea un horario recurrente para hoy (para poder probar el generador en la misma corrida)', async () => {
      const res = await request(app.getHttpServer())
        .post('/coop/horarios-ruta')
        .set('Authorization', `Bearer ${tokenCoop}`)
        .send({
          rutaId,
          horaSalida: '09:00',
          diasSemana: [hoy],
          tipoVehiculoPredeterminadoId: tipoVehiculoId,
        })
        .expect(201);
      horarioId = res.body.id;
      expect(horarioId).toBeDefined();
    });

    it('el horario recién creado aparece al listar, activo por defecto', async () => {
      const res = await request(app.getHttpServer())
        .get(`/coop/horarios-ruta?rutaId=${rutaId}`)
        .set('Authorization', `Bearer ${tokenCoop}`)
        .expect(200);
      const horario = res.body.find((h: { id: string }) => h.id === horarioId);
      expect(horario).toBeDefined();
      expect(horario.activo).toBe(true);
      expect(horario.diasSemana).toContain(hoy);
    });

    it('se puede desactivar y reactivar', async () => {
      await request(app.getHttpServer())
        .patch(`/coop/horarios-ruta/${horarioId}/estado`)
        .set('Authorization', `Bearer ${tokenCoop}`)
        .send({ activo: false })
        .expect(200);

      const listaInactivo = await request(app.getHttpServer())
        .get(`/coop/horarios-ruta?rutaId=${rutaId}`)
        .set('Authorization', `Bearer ${tokenCoop}`)
        .expect(200);
      expect(
        listaInactivo.body.find((h: { id: string }) => h.id === horarioId)
          .activo,
      ).toBe(false);

      await request(app.getHttpServer())
        .patch(`/coop/horarios-ruta/${horarioId}/estado`)
        .set('Authorization', `Bearer ${tokenCoop}`)
        .send({ activo: true })
        .expect(200);
    });

    it('el generador crea un viaje real para hoy, y NUNCA lo duplica ni sobrescribe una edición manual al correr de nuevo — decisión central del director (03-ago-2026)', async () => {
      const generador = app.get(GeneradorViajesService);

      await generador.generarViajesPendientes();

      const pg = new Client({
        connectionString:
          process.env.DATABASE_URL_ADMIN_DIRECTO ??
          process.env.DATABASE_URL_PUBLICO,
      });
      await pg.connect();

      // El generador mira 21 días hacia adelante -- el día de la semana
      // de "hoy" vuelve a coincidir 3 veces en esa ventana (hoy, +7,
      // +14 días), así que 3 viajes es el resultado correcto, no 1.
      const primeraCorrida = await pg.query(
        'SELECT id, fecha_salida, precio_base FROM viajes WHERE horario_ruta_origen_id = $1 ORDER BY fecha_salida ASC',
        [horarioId],
      );
      expect(primeraCorrida.rows.length).toBe(3);
      const viajeGeneradoId = primeraCorrida.rows[0].id as string; // el más próximo (hoy)

      // Edición manual de ESE viaje puntual -- simula lo que haría la
      // cooperativa a mano (ej. ajustar el precio solo para hoy, sin
      // afectar las próximas 2 ocurrencias).
      await pg.query('UPDATE viajes SET precio_base = 99.99 WHERE id = $1', [
        viajeGeneradoId,
      ]);

      // Corre el generador de nuevo -- el punto central de la prueba: NO
      // debe crear viajes nuevos para (horario, fecha) que ya existen,
      // NI revertir la edición manual de ninguno de ellos.
      await generador.generarViajesPendientes();

      const segundaCorrida = await pg.query(
        'SELECT id, precio_base FROM viajes WHERE horario_ruta_origen_id = $1 ORDER BY fecha_salida ASC',
        [horarioId],
      );
      expect(segundaCorrida.rows.length).toBe(3); // sigue siendo 3, no se duplicó ninguna
      expect(Number(segundaCorrida.rows[0].precio_base)).toBe(99.99); // la edición manual sigue intacta
      expect(Number(segundaCorrida.rows[1].precio_base)).toBe(7.5); // las otras 2 nunca se tocaron
      expect(Number(segundaCorrida.rows[2].precio_base)).toBe(7.5);

      await pg.end();
    });
  });

  describe('Cancelación/suspensión masiva (contratiempos operativos)', () => {
    it('cancela viajes vacíos en el rango, sin generar créditos (nada que compensar)', async () => {
      await request(app.getHttpServer())
        .post('/coop/viajes')
        .set('Authorization', `Bearer ${tokenCoop}`)
        .send({
          rutaId,
          unidadId,
          fechaSalida: '2026-10-05',
          horaSalidaProgramada: '2026-10-05T07:00:00-05:00',
          precioBase: 7.5,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post('/coop/viajes')
        .set('Authorization', `Bearer ${tokenCoop}`)
        .send({
          rutaId,
          unidadId,
          fechaSalida: '2026-10-06',
          horaSalidaProgramada: '2026-10-06T07:00:00-05:00',
          precioBase: 7.5,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/coop/rutas/${rutaId}/cancelar-masivo`)
        .set('Authorization', `Bearer ${tokenCoop}`)
        .send({ fechaInicio: '2026-10-05', fechaFin: '2026-10-06' })
        .expect(201);

      expect(res.body.viajesEncontrados).toBe(2);
      expect(res.body.viajesCancelados).toBe(2);
      expect(res.body.boletosCancelados).toBe(0);
    });

    it('cancelar un viaje con un boleto vendido genera crédito automático por el monto pagado — decisión del director (03-ago-2026): compensar, no dejar al pasajero sin nada', async () => {
      const viajeRes = await request(app.getHttpServer())
        .post('/coop/viajes')
        .set('Authorization', `Bearer ${tokenCoop}`)
        .send({
          rutaId,
          unidadId,
          fechaSalida: '2026-10-10',
          horaSalidaProgramada: '2026-10-10T07:00:00-05:00',
          precioBase: 7.5,
        })
        .expect(201);
      const viajeId = viajeRes.body.id;

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
              apellidos: 'Credito Prueba',
              tipoDocumento: 'cedula',
              documento: '1701005488',
              tipoTarifa: 'adulto',
            },
          ],
        })
        .expect(201);
      const boletoId = compra.body.boletos[0].id;

      const cancelacion = await request(app.getHttpServer())
        .post(`/coop/viajes/${viajeId}/cancelar`)
        .set('Authorization', `Bearer ${tokenCoop}`)
        .expect(201);
      expect(cancelacion.body.boletosCancelados).toBe(1);

      const pg = new Client({
        connectionString:
          process.env.DATABASE_URL_ADMIN_DIRECTO ??
          process.env.DATABASE_URL_PUBLICO,
      });
      await pg.connect();
      const credito = await pg.query(
        'SELECT monto FROM creditos_pasajero WHERE boleto_origen_id = $1',
        [boletoId],
      );
      await pg.end();

      expect(credito.rows.length).toBe(1);
      expect(Number(credito.rows[0].monto)).toBeGreaterThan(0);
    });
  });
});
