import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Client } from 'pg';
import { AppModule } from './../src/app.module';
import { limpiarCooperativasDePrueba } from './helpers/limpieza';
import { cifrarDatosExistentes } from './../src/scripts/cifrar-datos-sensibles';

/**
 * Cifrado de datos sensibles (12-oct-2026). Se comprueba en la base, no solo en la respuesta de la
 * API: lo que importa es lo que queda guardado. El número de documento de discapacidad se
 * verifica en la suite de checkout, junto al flujo de compra.
 */
describe('Cifrado de datos sensibles en la base (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();
  const correoAdmin = `director.cifrado.${sufijo}@ticketya.ec`;
  const correoCoop = `admin.coop.cifrado.${sufijo}@ticketya.ec`;
  const nombreCoop = `Coop Cifrado E2E ${sufijo}`;
  const NUMERO = '2201234567';

  let tokenAdmin: string;
  let tokenCoop: string;
  let cooperativaId: string;

  const plataforma = () => new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
  async function consultar<T = Record<string, unknown>>(consulta: string, valores: unknown[] = []): Promise<T[]> {
    const pg = plataforma();
    await pg.connect();
    try {
      return (await pg.query(consulta, valores)).rows as T[];
    } finally {
      await pg.end();
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    await request(app.getHttpServer())
      .post('/auth/registro')
      .send({ aceptoTerminos: true, correo: correoAdmin, password: 'ClaveSegura123', nombres: 'Director', apellidos: 'Cifrado' })
      .expect(201);
    await consultar("UPDATE usuarios SET rol='admin_plataforma' WHERE correo=$1", [correoAdmin]);
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
          ruc: `07${String(sufijo).slice(-11)}`,
          razonSocial: 'Cooperativa Cifrado E2E S.A.',
          nombreComercial: nombreCoop,
          modeloIntegracion: 'modelo_a',
        },
        usuario: { correo: correoCoop, password: 'ClaveSegura123', nombreCompleto: 'Admin Coop Cifrado' },
      })
      .expect(201);
    cooperativaId = coop.body.cooperativaId;
    const loginCoop = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoCoop, password: 'ClaveSegura123' })
      .expect(201);
    tokenCoop = loginCoop.body.accessToken;
  });

  afterAll(async () => {
    await consultar('DELETE FROM cuentas_cobro_cooperativa WHERE cooperativa_id = $1', [cooperativaId]);
    await limpiarCooperativasDePrueba([nombreCoop]);
    await app.close();
  });

  const datosCuenta = (numeroCuenta: string) => ({
    entidadFinanciera: 'banco_pichincha',
    tipoCuenta: 'ahorros',
    numeroCuenta,
    titularNombre: 'Cooperativa Cifrado E2E S.A.',
    titularTipoIdentificacion: 'ruc',
    titularIdentificacion: '0791234567001',
    correoNotificacion: correoCoop,
  });

  it('el número de cuenta de cobro queda cifrado en la base, y la cooperativa y el admin lo ven completo', async () => {
    await request(app.getHttpServer())
      .post('/coop/cuenta-cobro')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send(datosCuenta(NUMERO))
      .expect(201);

    const [guardado] = await consultar<{ numero_cuenta: string }>(
      'SELECT numero_cuenta FROM cuentas_cobro_cooperativa WHERE cooperativa_id = $1',
      [cooperativaId],
    );
    expect(guardado.numero_cuenta.startsWith('enc:v1:')).toBe(true);
    expect(guardado.numero_cuenta).not.toContain(NUMERO);

    const propia = await request(app.getHttpServer())
      .get('/coop/cuenta-cobro')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .expect(200);
    expect(JSON.stringify(propia.body)).toContain(NUMERO);

    const admin = await request(app.getHttpServer())
      .get(`/admin/cuentas-cobro?busqueda=${encodeURIComponent(nombreCoop)}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(admin.body.filas[0].numeroCuenta).toBe(NUMERO);
  });

  it('un dato guardado antes del cifrado se sigue leyendo, y el script lo cifra una sola vez', async () => {
    const NUMERO_VIEJO = '9988776655';
    await consultar(
      `INSERT INTO cuentas_cobro_cooperativa
         (cooperativa_id, entidad_financiera, tipo_cuenta, numero_cuenta, titular_nombre,
          titular_tipo_identificacion, titular_identificacion, correo_notificacion, estado)
       VALUES ($1, 'banco_pichincha', 'ahorros', $2, 'Titular Antiguo', 'ruc', '0791234567001', $3, 'rechazada')`,
      [cooperativaId, NUMERO_VIEJO, correoCoop],
    );

    // Antes del script: sigue en texto plano en la base, pero la API lo muestra igual.
    const antes = await request(app.getHttpServer())
      .get(`/admin/cuentas-cobro?estado=rechazada&busqueda=${encodeURIComponent(nombreCoop)}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(antes.body.filas.map((f: { numeroCuenta: string }) => f.numeroCuenta)).toContain(NUMERO_VIEJO);
    const [plano] = await consultar<{ numero_cuenta: string }>(
      `SELECT numero_cuenta FROM cuentas_cobro_cooperativa WHERE cooperativa_id = $1 AND estado = 'rechazada'`,
      [cooperativaId],
    );
    expect(plano.numero_cuenta).toBe(NUMERO_VIEJO);

    const pg = plataforma();
    await pg.connect();
    try {
      const primera = await cifrarDatosExistentes(pg);
      expect(primera['cuentas_cobro_cooperativa.numero_cuenta']).toBeGreaterThanOrEqual(1);
      const segunda = await cifrarDatosExistentes(pg);
      expect(segunda['cuentas_cobro_cooperativa.numero_cuenta']).toBe(0);
      expect(segunda['pasajeros_compra.numero_documento_discapacidad']).toBe(0);
    } finally {
      await pg.end();
    }

    const [cifrado] = await consultar<{ numero_cuenta: string }>(
      `SELECT numero_cuenta FROM cuentas_cobro_cooperativa WHERE cooperativa_id = $1 AND estado = 'rechazada'`,
      [cooperativaId],
    );
    expect(cifrado.numero_cuenta.startsWith('enc:v1:')).toBe(true);

    const despues = await request(app.getHttpServer())
      .get(`/admin/cuentas-cobro?estado=rechazada&busqueda=${encodeURIComponent(nombreCoop)}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(despues.body.filas.map((f: { numeroCuenta: string }) => f.numeroCuenta)).toContain(NUMERO_VIEJO);
  });
});
