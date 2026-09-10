import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { Client } from 'pg';
import { limpiarCooperativasDePrueba } from './helpers/limpieza';

/**
 * Ítem 17, Fase 3 (05-ago-2026) -- LOPDP, derecho de eliminación.
 * Anonimización, no DELETE de la fila -- ver comentario de diseño
 * completo en apps/api/src/infraestructura/auth/usuario.repositorio.drizzle.ts.
 * Decisión del director confirmada: los datos del pasajero dentro de
 * cada boleto ya vendido (pasajeros_compra) NO se tocan, es el registro
 * contable de una venta real de la cooperativa, no un dato exclusivo de
 * la cuenta que se elimina -- esa es la pieza central que estas pruebas
 * verifican, no solo que la cuenta "desaparezca".
 */
describe('Eliminación de cuenta (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();
  let pg: Client;

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
  });

  afterAll(async () => {
    await limpiarCooperativasDePrueba([`Coop Elim Cuenta ${sufijo}`]);
    await pg.end();
    await app.close();
  });

  it('rechaza eliminar sin contraseña, para una cuenta que sí tiene contraseña', async () => {
    const correo = `elim.sinpass.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo,
      password: 'ClaveSegura123',
      nombres: 'Elim',
      apellidos: 'SinPass Prueba',
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo, password: 'ClaveSegura123' });
    const token = login.body.accessToken;

    await request(app.getHttpServer())
      .post('/auth/eliminar-cuenta')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });

  it('rechaza eliminar con contraseña incorrecta', async () => {
    const correo = `elim.passmal.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo,
      password: 'ClaveSegura123',
      nombres: 'Elim',
      apellidos: 'PassMal Prueba',
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo, password: 'ClaveSegura123' });
    const token = login.body.accessToken;

    await request(app.getHttpServer())
      .post('/auth/eliminar-cuenta')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'ContraseñaIncorrecta999' })
      .expect(400);
  });

  it('elimina la cuenta con la contraseña correcta: anonimiza, borra tokens, desvincula compras -- pero NO toca los datos del pasajero dentro del boleto ya vendido', async () => {
    // Setup: cooperativa real + viaje real + compra real, para tener
    // algo legítimo que verificar después de eliminar.
    const correoDirector = `director.elim.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo: correoDirector,
      password: 'ClaveSegura123',
      nombres: 'Director',
      apellidos: 'Elim Prueba',
    });
    await pg.query(
      "UPDATE usuarios SET rol='admin_plataforma' WHERE correo=$1",
      [correoDirector],
    );
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
          razonSocial: `Coop Elim Cuenta E2E ${sufijo}`,
          nombreComercial: `Coop Elim Cuenta ${sufijo}`,
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: `admin.elim.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombreCompleto: 'Admin Elim E2E',
        },
      });
    const loginCoop = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: `admin.elim.${sufijo}@ticketya.ec`, password: 'ClaveSegura123' });
    const tokenCoop = loginCoop.body.accessToken;

    const origen = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo: 'terminal_terrestre', nombre: `Origen Elim ${sufijo}`, ciudad: 'Machala', provincia: 'El Oro' });
    const destino = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo: 'terminal_terrestre', nombre: `Destino Elim ${sufijo}`, ciudad: 'Guayaquil', provincia: 'Guayas' });
    const tipo = await request(app.getHttpServer())
      .post('/coop/tipos-vehiculo')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({ nombre: `Tipo Elim ${sufijo}`, capacidadTotal: 20 });
    const unidad = await request(app.getHttpServer())
      .post('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipoVehiculoId: tipo.body.id,
        placa: `ELM-${sufijo % 100000}`,
        identificadorOperativo: `Op-${sufijo % 100000}`,
      });
    const ruta = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        origenPuntoOperacionId: origen.body.puntoOperacionId,
        destinoPuntoOperacionId: destino.body.puntoOperacionId,
        precioBaseReferencia: 10,
      });
    const viaje = await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        rutaId: ruta.body.id,
        unidadId: unidad.body.id,
        fechaSalida: '2030-01-01',
        horaSalidaProgramada: '2030-01-01T08:00:00-05:00',
        precioBase: 10,
      });

    // El pasajero real que vamos a eliminar.
    const correoPasajero = `elim.compra.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo: correoPasajero,
      password: 'ClaveSegura123',
      nombres: 'Pasajero',
      apellidos: 'A Eliminar Prueba',
    });
    const loginPasajero = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoPasajero, password: 'ClaveSegura123' });
    const tokenPasajero = loginPasajero.body.accessToken;

    // Capturado ANTES de eliminar -- después, compras.comprador_usuario_id
    // queda en null y ya no se puede llegar al usuario por esa vía.
    const perfilAntes = await request(app.getHttpServer())
      .get('/auth/perfil')
      .set('Authorization', `Bearer ${tokenPasajero}`);
    const pasajeroUsuarioId = perfilAntes.body.id;

    await request(app.getHttpServer())
      .post(`/viajes/${viaje.body.id}/asientos/1A/bloquear`)
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .expect(201);
    const compra = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId: viaje.body.id,
            numeroAsiento: '1A',
            nombres: 'Pasajero',
            apellidos: 'A Eliminar Prueba',
            tipoDocumento: 'cedula',
            documento: '1701004119',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);
    const boletoId = compra.body.boletos[0].id;
    const filaBoleto = await pg.query(
      'SELECT compra_id FROM boletos WHERE id = $1',
      [boletoId],
    );
    const compraId = filaBoleto.rows[0].compra_id;

    // Ahora sí, eliminamos la cuenta.
    const respuesta = await request(app.getHttpServer())
      .post('/auth/eliminar-cuenta')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({ password: 'ClaveSegura123' })
      .expect(201);
    expect(respuesta.body.ok).toBe(true);

    // 1) La cuenta quedó anonimizada e inactiva -- ya no puede iniciar sesión.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoPasajero, password: 'ClaveSegura123' })
      .expect(401);

    // 2) Verificación directa en base de datos de la anonimización real,
    // usando el id capturado ANTES de eliminar.
    const filaUsuario = await pg.query(
      'SELECT correo, nombre_completo, cedula, telefono, password_hash, activo FROM usuarios WHERE id = $1',
      [pasajeroUsuarioId],
    );
    expect(filaUsuario.rows[0].correo).not.toBe(correoPasajero);
    expect(filaUsuario.rows[0].nombre_completo).toBe('Usuario eliminado');
    expect(filaUsuario.rows[0].cedula).toBeNull();
    expect(filaUsuario.rows[0].telefono).toBeNull();
    expect(filaUsuario.rows[0].password_hash).toBeNull();
    expect(filaUsuario.rows[0].activo).toBe(false);

    // La compra ya no debería tener comprador vinculado.
    const filaCompra = await pg.query(
      'SELECT comprador_usuario_id FROM compras WHERE id = $1',
      [compraId],
    );
    expect(filaCompra.rows[0].comprador_usuario_id).toBeNull();

    // Los tokens de la cuenta (refresh, etc.) ya no existen.
    const filaTokens = await pg.query(
      'SELECT COUNT(*)::int AS total FROM tokens_usuario WHERE usuario_id = $1',
      [pasajeroUsuarioId],
    );
    expect(filaTokens.rows[0].total).toBe(0);

    // 3) Lo más importante: los datos del pasajero DENTRO del boleto ya
    // vendido siguen intactos -- es el registro contable de la
    // cooperativa, no un dato exclusivo de la cuenta eliminada.
    const filaPasajeroCompra = await pg.query(
      'SELECT nombres, apellidos, documento FROM pasajeros_compra WHERE compra_id = $1',
      [compraId],
    );
    expect(filaPasajeroCompra.rows[0].nombres).toBe('Pasajero');
    expect(filaPasajeroCompra.rows[0].apellidos).toBe('A Eliminar Prueba');
    expect(filaPasajeroCompra.rows[0].documento).toBe('1701004119');
  });

  it('acepta la frase "ELIMINAR" para una cuenta sin contraseña (login externo simulado)', async () => {
    // Simula una cuenta de login externo -- se registra normal y luego
    // se le quita el password_hash directo en base de datos, como
    // quedaría una cuenta real vía Google/proveedor externo.
    const correo = `elim.externa.${sufijo}@ticketya.ec`;
    const registro = await request(app.getHttpServer()).post('/auth/registro').send({
      correo,
      password: 'ClaveSegura123',
      nombres: 'Elim',
      apellidos: 'Externa Prueba',
    });
    const token = registro.body.accessToken;
    await pg.query(
      "UPDATE usuarios SET password_hash = NULL, proveedor_externo = 'google' WHERE correo = $1",
      [correo],
    );

    // Sin frase -- rechazado.
    await request(app.getHttpServer())
      .post('/auth/eliminar-cuenta')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);

    // Con la frase exacta -- aceptado.
    await request(app.getHttpServer())
      .post('/auth/eliminar-cuenta')
      .set('Authorization', `Bearer ${token}`)
      .send({ frase: 'ELIMINAR' })
      .expect(201);
  });
});
