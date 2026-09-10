import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { Client } from 'pg';
import { limpiarCooperativasDePrueba } from './helpers/limpieza';

/**
 * Programa de referidos "Invita y Gana" (13-ago-2026). Diseño
 * investigado contra ClickBus ("Indique e Ganhe") -- ver
 * DOCUMENTO_MAESTRO.md para el detalle completo. Reutiliza el wallet
 * ya construido (Fases 1 y 2) para el crédito del referidor.
 */
describe('Programa de referidos (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();

  let viajeId: string;
  let tokenSuperAdmin: string;
  let tokenCoop: string;
  let tokenReferidor: string;
  let codigoReferidor: string;
  let codigoQrReferido: string;
  const PRECIO_BASE = 30;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    const correoDirector = `director.referidos.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo: correoDirector,
      password: 'ClaveSegura123',
      nombres: 'Director', apellidos: 'Referidos Prueba',
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

    await request(app.getHttpServer())
      .patch('/referidos/configuracion')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ creditoReferidor: 5, descuentoReferido: 3 })
      .expect(200);

    const ruc = `07${sufijo}`.slice(0, 13);
    await request(app.getHttpServer())
      .post('/admin/cooperativas')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({
        cooperativa: {
          ruc,
          razonSocial: `Coop Referidos E2E ${sufijo}`,
          nombreComercial: `Coop Referidos ${sufijo}`,
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: `admin.referidos.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombreCompleto: 'Admin Referidos E2E',
        },
      });

    const loginCoop = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: `admin.referidos.${sufijo}@ticketya.ec`, password: 'ClaveSegura123' });
    tokenCoop = loginCoop.body.accessToken;

    const origen = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ tipo: 'terminal_terrestre', nombre: `Origen Referidos ${sufijo}`, ciudad: 'Machala', provincia: 'El Oro' });

    const destino = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ tipo: 'terminal_terrestre', nombre: `Destino Referidos ${sufijo}`, ciudad: 'Guayaquil', provincia: 'Guayas' });

    const tipo = await request(app.getHttpServer())
      .post('/coop/tipos-vehiculo')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({ nombre: `Tipo Referidos ${sufijo}`, capacidadTotal: 20 });

    const unidad = await request(app.getHttpServer())
      .post('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipoVehiculoId: tipo.body.id,
        placa: `REF-${sufijo % 100000}`,
        identificadorOperativo: `Op-Ref-${sufijo % 100000}`,
      });

    const ruta = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        origenPuntoOperacionId: origen.body.puntoOperacionId,
        destinoPuntoOperacionId: destino.body.puntoOperacionId,
        precioBaseReferencia: PRECIO_BASE,
      });

    const viaje = await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        rutaId: ruta.body.id,
        unidadId: unidad.body.id,
        fechaSalida: '2026-02-10',
        horaSalidaProgramada: '2026-02-10T08:00:00-05:00',
        precioBase: PRECIO_BASE,
      });
    viajeId = viaje.body.id;

    // El referidor se registra primero, para tener un código real de
    // pasajero (ahora se genera de forma anticipada al registrarse,
    // ver auth.service.ts) antes de que exista nadie a quien referir.
    const referidor = await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: `referidor.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
        nombres: 'Referidor', apellidos: 'Uno Prueba',
        cedula: '1710034065',
      });
    tokenReferidor = referidor.body.accessToken;

    const perfilReferidor = await request(app.getHttpServer())
      .get('/auth/perfil')
      .set('Authorization', `Bearer ${tokenReferidor}`);
    codigoReferidor = perfilReferidor.body.codigoPasajero;
  });

  afterAll(async () => {
    await limpiarCooperativasDePrueba([`Coop Referidos ${sufijo}`]);
    await app.close();
  });

  it('el código de referido ya viene generado desde el registro, sin tener que pedirlo aparte', () => {
    expect(codigoReferidor).toMatch(/^COL-/);
  });

  it('registrarse con un código de referido válido crea la relación real', async () => {
    await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: `referido.uno.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
        nombres: 'Referido', apellidos: 'Uno Prueba',
        codigoReferido: codigoReferidor,
      })
      .expect(201);

    const pg = new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
    await pg.connect();
    const relacion = await pg.query(
      `SELECT r.id, r.descuento_aplicado_en, r.boleto_que_disparo_credito_id
       FROM referidos r
       JOIN usuarios u ON u.id = r.usuario_referido_id
       WHERE u.correo = $1`,
      [`referido.uno.${sufijo}@ticketya.ec`],
    );
    await pg.end();

    expect(relacion.rows).toHaveLength(1);
    expect(relacion.rows[0].descuento_aplicado_en).toBeNull();
    expect(relacion.rows[0].boleto_que_disparo_credito_id).toBeNull();
  });

  it('un usuario no puede referirse a sí mismo -- misma cédula que el referidor, la relación NO se crea', async () => {
    await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: `autorreferido.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
        nombres: 'Auto', apellidos: 'Referido Prueba',
        cedula: '1710034065', // misma cédula que el referidor, sincronizada en el beforeAll
        codigoReferido: codigoReferidor,
      })
      .expect(201); // el registro en sí NUNCA falla por esto

    const pg = new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
    await pg.connect();
    const relacion = await pg.query(
      `SELECT r.id FROM referidos r
       JOIN usuarios u ON u.id = r.usuario_referido_id
       WHERE u.correo = $1`,
      [`autorreferido.${sufijo}@ticketya.ec`],
    );
    await pg.end();

    expect(relacion.rows).toHaveLength(0); // nunca se creó la relación
  });

  it('el descuento se aplica en la primera compra del referido', async () => {
    const loginReferido = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: `referido.uno.${sufijo}@ticketya.ec`, password: 'ClaveSegura123' });
    const tokenReferido = loginReferido.body.accessToken;

    await request(app.getHttpServer())
      .post(`/viajes/${viajeId}/asientos/1A/bloquear`)
      .set('Authorization', `Bearer ${tokenReferido}`)
      .expect(201);
    const compra = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenReferido}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '1A',
            nombres: 'Referido',
            apellidos: 'Uno Prueba',
            tipoDocumento: 'cedula',
            documento: '1701002741',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);

    expect(compra.body.descuentoReferidoAplicado).toBe(3);
    expect(compra.body.montoPagado).toBe(
      Number((compra.body.montoTotal - 3).toFixed(2)),
    );

    codigoQrReferido = compra.body.boletos[0].codigoQr;
  });

  it('el crédito al referidor NO se acredita todavía -- solo se dispara cuando el boleto se valida, no al comprar', async () => {
    const saldoAntes = await request(app.getHttpServer())
      .get('/wallet/saldo')
      .set('Authorization', `Bearer ${tokenReferidor}`)
      .expect(200);
    expect(saldoAntes.body.saldo).toBe(0);
  });

  it('el crédito al referidor se acredita al validar el boleto del referido en la terminal', async () => {
    await request(app.getHttpServer())
      .post('/coop/validar-qr')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({ codigoQr: codigoQrReferido })
      .expect(201);

    const saldo = await request(app.getHttpServer())
      .get('/wallet/saldo')
      .set('Authorization', `Bearer ${tokenReferidor}`)
      .expect(200);
    expect(saldo.body.saldo).toBe(5);
  });

  it('el crédito no se duplica si el amigo referido compra y viaja otra vez', async () => {
    const loginReferido = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: `referido.uno.${sufijo}@ticketya.ec`, password: 'ClaveSegura123' });
    const tokenReferido = loginReferido.body.accessToken;

    await request(app.getHttpServer())
      .post(`/viajes/${viajeId}/asientos/1B/bloquear`)
      .set('Authorization', `Bearer ${tokenReferido}`)
      .expect(201);
    const compra2 = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenReferido}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '1B',
            nombres: 'Referido',
            apellidos: 'Uno Prueba',
            tipoDocumento: 'cedula',
            documento: '1701004119',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);

    // Segunda compra del mismo referido -- el descuento de bienvenida
    // ya se consumió en la primera, esta NO debe llevar descuento.
    expect(compra2.body.descuentoReferidoAplicado).toBe(0);

    await request(app.getHttpServer())
      .post('/coop/validar-qr')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({ codigoQr: compra2.body.boletos[0].codigoQr })
      .expect(201);

    // El saldo del referidor sigue en $5 -- el segundo viaje del mismo
    // amigo NO vuelve a disparar el crédito.
    const saldo = await request(app.getHttpServer())
      .get('/wallet/saldo')
      .set('Authorization', `Bearer ${tokenReferidor}`)
      .expect(200);
    expect(saldo.body.saldo).toBe(5);
  });

  it('solo super_admin puede cambiar la configuración de referidos -- admin_plataforma recibe 403', async () => {
    const correoAdminPlataforma = `admin.plataforma.referidos.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo: correoAdminPlataforma,
      password: 'ClaveSegura123',
      nombres: 'Admin', apellidos: 'Plataforma Referidos Prueba',
    });
    const pg = new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
    await pg.connect();
    await pg.query(
      "UPDATE usuarios SET rol='admin_plataforma' WHERE correo=$1",
      [correoAdminPlataforma],
    );
    await pg.end();
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoAdminPlataforma, password: 'ClaveSegura123' });

    await request(app.getHttpServer())
      .patch('/referidos/configuracion')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ creditoReferidor: 100, descuentoReferido: 100 })
      .expect(403);
  });

  /**
   * Fase 5-buscador (16-ago-2026) -- endpoint publico nuevo, para
   * mostrar el beneficio real del programa de referidos en la
   * portada/resultados (reemplaza un banner con un dato falso).
   */
  it('GET /referidos/beneficios-publicos -- no requiere autenticacion, devuelve los valores reales', async () => {
    const res = await request(app.getHttpServer())
      .get('/referidos/beneficios-publicos')
      .expect(200);
    expect(res.body).toHaveProperty('creditoReferidor');
    expect(res.body).toHaveProperty('descuentoReferido');
    expect(typeof res.body.creditoReferidor).toBe('number');
    expect(typeof res.body.descuentoReferido).toBe('number');
  });
});
