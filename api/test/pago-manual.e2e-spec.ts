import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { limpiarCooperativasDePrueba } from './helpers/limpieza';
import { Client } from 'pg';

/**
 * Métodos de pago manuales (29-jul-2026) — hallazgo real de negocio:
 * no hay pasarela conectada (decisión de proveedor pendiente), así que
 * cada cooperativa configura lo que ya usa hoy en Ecuador
 * (transferencia, efectivo, DeUna, PayPhone) con sus propios datos, y
 * el pasajero paga por fuera y sube comprobante -- mismo patrón que
 * Tiendanube/Billowshop, investigado antes de construir.
 */
describe('Métodos de pago manuales (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();

  let tokenAdmin: string;
  let tokenCoop: string;
  let tokenPasajero: string;
  let viajeId: string;

  async function bloquear(viajeId: string, numeroAsiento: string, token: string) {
    const res = await request(app.getHttpServer())
      .post(`/viajes/${viajeId}/asientos/${numeroAsiento}/bloquear`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const correoDirector = `director.pago.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo: correoDirector,
      password: 'ClaveSegura123',
      nombres: 'Director',
      apellidos: 'Pago Manual Prueba',
    });
    const loginDirector = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoDirector, password: 'ClaveSegura123' });
    tokenAdmin = loginDirector.body.accessToken;

    // El backend permite registro sin rol admin_plataforma por defecto;
    // se promueve directo en la base para pruebas, igual que el resto
    // de la suite de este proyecto (ver otros archivos de test).
    const pg = new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
    await pg.connect();
    await pg.query("UPDATE usuarios SET rol='admin_plataforma' WHERE correo=$1", [
      correoDirector,
    ]);
    // Factura del servicio de Colombus (29-jul-2026): se salta a
    // propósito si el cargo de plataforma es $0 -- se configura un
    // valor real para que esta suite pueda probar que se genera.
    await pg.query(
      'UPDATE configuracion_plataforma SET cargo_plataforma_por_pasajero_default = 0.50',
    );
    await pg.end();
    const loginDirectorOtraVez = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoDirector, password: 'ClaveSegura123' });
    tokenAdmin = loginDirectorOtraVez.body.accessToken;

    const ruc = `07${sufijo}`.slice(0, 13);
    await request(app.getHttpServer())
      .post('/admin/cooperativas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        cooperativa: {
          ruc,
          razonSocial: `Coop Pago Manual E2E ${sufijo}`,
          nombreComercial: `Coop Pago Manual ${sufijo}`,
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: `admin.pago.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombreCompleto: 'Admin Pago Manual E2E',
        },
      });
    const loginCoop = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: `admin.pago.${sufijo}@ticketya.ec`, password: 'ClaveSegura123' });
    tokenCoop = loginCoop.body.accessToken;

    const origen = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo: 'terminal_terrestre', nombre: `Origen Pago ${sufijo}`, ciudad: 'Machala', provincia: 'El Oro' });
    const destino = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo: 'terminal_terrestre', nombre: `Destino Pago ${sufijo}`, ciudad: 'Guayaquil', provincia: 'Guayas' });

    const tipo = await request(app.getHttpServer())
      .post('/coop/tipos-vehiculo')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({ nombre: `Tipo Pago ${sufijo}`, capacidadTotal: 20 });
    const unidad = await request(app.getHttpServer())
      .post('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({ tipoVehiculoId: tipo.body.id, placa: `PGO-${sufijo % 100000}`, identificadorOperativo: `Op-${sufijo % 100000}` });
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
        fechaSalida: '2026-12-20',
        horaSalidaProgramada: '2026-12-20T08:00:00-05:00',
        precioBase: 10,
      });
    viajeId = viaje.body.id;

    const pasajero = await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: `pasajero.pago.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
        nombres: 'Pasajero',
        apellidos: 'Pago Manual Prueba',
      });
    tokenPasajero = pasajero.body.accessToken;
  });

  afterAll(async () => {
    await limpiarCooperativasDePrueba([`Coop Pago Manual ${sufijo}`]);
    // se revierte a $0 para no afectar otros archivos de prueba que
    // asumen ese valor por defecto (ya vivimos este problema antes)
    const pg = new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
    await pg.connect();
    await pg.query('UPDATE configuracion_plataforma SET cargo_plataforma_por_pasajero_default = 0');
    await pg.end();
    await app.close();
  });

  it('RECHAZA iniciar un pago manual si la cooperativa no tiene ese método configurado', async () => {
    await bloquear(viajeId, '1A', tokenPasajero);
    const res = await request(app.getHttpServer())
      .post('/compras/pago-manual')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '1A',
            nombres: 'Pasajero',
            apellidos: 'Pago Manual Prueba',
            tipoDocumento: 'cedula',
            documento: '1701006858',
            tipoTarifa: 'adulto',
          },
        ],
        tipoMetodoPago: 'transferencia_bancaria',
      })
      .expect(400);
    expect(res.body.message).toContain('no tiene configurado');
  });

  it('flujo completo: iniciar pago manual -> subir comprobante -> cooperativa confirma -> boleto real con QR', async () => {
    await request(app.getHttpServer())
      .post('/coop/metodos-pago')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipo: 'transferencia_bancaria',
        entidadFinanciera: 'banco_pichincha',
        datosCuenta: {
          banco: 'Banco Pichincha',
          numeroCuenta: '2201234567',
          titular: 'Coop Pago Manual E2E',
        },
      })
      .expect(201);

    await bloquear(viajeId, '2A', tokenPasajero);
    const inicio = await request(app.getHttpServer())
      .post('/compras/pago-manual')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '2A',
            nombres: 'Pasajero',
            apellidos: 'Confirma Prueba',
            tipoDocumento: 'cedula',
            documento: '1701008227',
            tipoTarifa: 'adulto',
          },
        ],
        tipoMetodoPago: 'transferencia_bancaria',
      })
      .expect(201);
    expect(inicio.body.estado).toBe('pendiente_confirmacion');
    const compraId = inicio.body.compraId;

    // El asiento debe verse ocupado (no disponible) mientras se revisa
    // el comprobante -- no expira solo como el bloqueo de tarjeta.
    const mapa = await request(app.getHttpServer())
      .get(`/viajes/${viajeId}/asientos`)
      .expect(200);
    const asiento2A = mapa.body.asientosNoDisponibles.find(
      (a: { numeroAsiento: string }) => a.numeroAsiento === '2A',
    );
    expect(asiento2A.estado).toBe('pendiente_confirmacion_pago');

    // Sube un comprobante real (archivo real, no simulado).
    const subida = await request(app.getHttpServer())
      .post(`/compras/${compraId}/comprobante`)
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .attach('comprobante', Buffer.from('contenido de prueba, no es una imagen real'), {
        filename: 'comprobante.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    expect(subida.body.comprobanteUrl).toContain('/uploads/comprobantes-pago/');

    // La cooperativa lo ve en su lista de pendientes.
    const pendientes = await request(app.getHttpServer())
      .get('/coop/pagos-pendientes')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .expect(200);
    const pendiente = pendientes.body.find((p: { compraId: string }) => p.compraId === compraId);
    expect(pendiente).toBeDefined();
    expect(pendiente.comprobanteUrl).toBe(subida.body.comprobanteUrl);
    // El nombre que se muestra es el del titular de la cuenta que pagó
    // (a quién contactar), no necesariamente el del pasajero que viaja
    // -- pueden ser personas distintas (comprar para un familiar).
    expect(pendiente.compradorNombre).toBe('Pasajero Pago Manual Prueba');

    // La cooperativa confirma.
    await request(app.getHttpServer())
      .patch(`/coop/pagos-pendientes/${pendiente.pagoId}/confirmar`)
      .set('Authorization', `Bearer ${tokenCoop}`)
      .expect(200);

    // El boleto real ya existe, con QR -- lo que casi se me olvida
    // construir la primera vez.
    const recibo = await request(app.getHttpServer())
      .get(`/compras/${compraId}`)
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .expect(200);
    expect(recibo.body.boletos[0].codigoQr).toBeDefined();
    expect(recibo.body.boletos[0].estado).toBe('vigente');

    // Ya no aparece en pendientes.
    const pendientesDespues = await request(app.getHttpServer())
      .get('/coop/pagos-pendientes')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .expect(200);
    expect(
      pendientesDespues.body.some((p: { compraId: string }) => p.compraId === compraId),
    ).toBe(false);

    // Factura del servicio de Colombus (29-jul-2026) -- se genera sola,
    // sin que nadie la pida, apenas se confirma la compra.
    const pg = new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
    await pg.connect();
    const facturaColombus = await pg.query(
      `SELECT sujeto_tributario, estado, monto_comprobante, clave_acceso
       FROM comprobantes_electronicos WHERE compra_id = $1`,
      [compraId],
    );
    await pg.end();
    expect(facturaColombus.rows.length).toBe(1);
    expect(facturaColombus.rows[0].sujeto_tributario).toBe('plataforma');
    expect(facturaColombus.rows[0].estado).toBe('autorizado');
    expect(facturaColombus.rows[0].clave_acceso).toHaveLength(49);
  });

  it('flujo de rechazo: la cooperativa rechaza, y el asiento vuelve a estar disponible para otro pasajero', async () => {
    await bloquear(viajeId, '3A', tokenPasajero);
    const inicio = await request(app.getHttpServer())
      .post('/compras/pago-manual')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '3A',
            nombres: 'Pasajero',
            apellidos: 'Rechazo Prueba',
            tipoDocumento: 'cedula',
            documento: '1701009597',
            tipoTarifa: 'adulto',
          },
        ],
        tipoMetodoPago: 'transferencia_bancaria',
      })
      .expect(201);
    const compraId = inicio.body.compraId;

    await request(app.getHttpServer())
      .post(`/compras/${compraId}/comprobante`)
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .attach('comprobante', Buffer.from('comprobante falso, no coincide con el monto'), {
        filename: 'comprobante.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    const pendientes = await request(app.getHttpServer())
      .get('/coop/pagos-pendientes')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .expect(200);
    const pendiente = pendientes.body.find((p: { compraId: string }) => p.compraId === compraId);

    await request(app.getHttpServer())
      .patch(`/coop/pagos-pendientes/${pendiente.pagoId}/rechazar`)
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({ motivo: 'El comprobante no coincide con el monto del pasaje.' })
      .expect(200);

    // El asiento debe estar disponible de nuevo -- otro pasajero lo
    // puede bloquear sin problema.
    const otroPasajero = await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: `pasajero.otro.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
        nombres: 'Otro',
        apellidos: 'Pasajero Prueba',
      });
    await bloquear(viajeId, '3A', otroPasajero.body.accessToken);
  });

  it('RECHAZA subir comprobante de una compra que no le pertenece al usuario', async () => {
    await bloquear(viajeId, '4A', tokenPasajero);
    const inicio = await request(app.getHttpServer())
      .post('/compras/pago-manual')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '4A',
            nombres: 'Pasajero',
            apellidos: 'Ajeno Prueba',
            tipoDocumento: 'cedula',
            documento: '1701010967',
            tipoTarifa: 'adulto',
          },
        ],
        tipoMetodoPago: 'transferencia_bancaria',
      })
      .expect(201);

    const otroToken = (
      await request(app.getHttpServer()).post('/auth/registro').send({
        correo: `pasajero.intruso.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
        nombres: 'Intruso',
        apellidos: 'Prueba',
      })
    ).body.accessToken;

    await request(app.getHttpServer())
      .post(`/compras/${inicio.body.compraId}/comprobante`)
      .set('Authorization', `Bearer ${otroToken}`)
      .attach('comprobante', Buffer.from('intento ajeno'), {
        filename: 'comprobante.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
  });

  describe('Solicitud de factura del pasaje (29-jul-2026) -- puente con la cooperativa, ella emite en su propio sistema', () => {
    let boletoId: string;

    beforeAll(async () => {
      await bloquear(viajeId, '5A', tokenPasajero);
      const inicio = await request(app.getHttpServer())
        .post('/compras/pago-manual')
        .set('Authorization', `Bearer ${tokenPasajero}`)
        .send({
          pasajeros: [
            {
              viajeId,
              numeroAsiento: '5A',
              nombres: 'Pasajero',
              apellidos: 'Factura Prueba',
              tipoDocumento: 'cedula',
              documento: '1701012336',
              tipoTarifa: 'adulto',
            },
          ],
          tipoMetodoPago: 'transferencia_bancaria',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/compras/${inicio.body.compraId}/comprobante`)
        .set('Authorization', `Bearer ${tokenPasajero}`)
        .attach('comprobante', Buffer.from('comprobante para factura'), {
          filename: 'comprobante.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);
      const pendientes = await request(app.getHttpServer())
        .get('/coop/pagos-pendientes')
        .set('Authorization', `Bearer ${tokenCoop}`)
        .expect(200);
      const pendiente = pendientes.body.find(
        (p: { compraId: string }) => p.compraId === inicio.body.compraId,
      );
      await request(app.getHttpServer())
        .patch(`/coop/pagos-pendientes/${pendiente.pagoId}/confirmar`)
        .set('Authorization', `Bearer ${tokenCoop}`)
        .expect(200);

      const recibo = await request(app.getHttpServer())
        .get(`/compras/${inicio.body.compraId}`)
        .set('Authorization', `Bearer ${tokenPasajero}`)
        .expect(200);
      boletoId = recibo.body.boletos[0].boletoId;
    });

    it('el pasajero solicita la factura de su boleto', async () => {
      const res = await request(app.getHttpServer())
        .post(`/compras/boletos/${boletoId}/solicitar-factura`)
        .set('Authorization', `Bearer ${tokenPasajero}`)
        .send({
          datosTributarios: {
            tipo: 'cedula',
            numero: '0104123456',
            razonSocial: 'Pasajero Factura E2E',
            direccion: 'Machala, El Oro',
          },
        })
        .expect(201);
      expect(res.body.id).toBeDefined();
    });

    it('RECHAZA solicitar la factura dos veces del mismo boleto', async () => {
      const res = await request(app.getHttpServer())
        .post(`/compras/boletos/${boletoId}/solicitar-factura`)
        .set('Authorization', `Bearer ${tokenPasajero}`)
        .send({ datosTributarios: { tipo: 'cedula', numero: '0104123456' } })
        .expect(400);
      expect(res.body.message).toContain('Ya solicitaste');
    });

    it('la cooperativa ve la solicitud pendiente y la marca como emitida', async () => {
      const pendientes = await request(app.getHttpServer())
        .get('/coop/solicitudes-factura')
        .set('Authorization', `Bearer ${tokenCoop}`)
        .expect(200);
      const solicitud = pendientes.body.find((s: { boletoId: string }) => s.boletoId === boletoId);
      expect(solicitud).toBeDefined();
      expect(solicitud.estado).toBe('pendiente');
      expect(solicitud.pasajeroNombre).toBe('Pasajero Factura Prueba');
      expect(solicitud.datosTributarios.numero).toBe('0104123456');

      await request(app.getHttpServer())
        .patch(`/coop/solicitudes-factura/${solicitud.id}/marcar-emitida`)
        .set('Authorization', `Bearer ${tokenCoop}`)
        .send({ urlFactura: 'https://ejemplo.com/factura.pdf' })
        .expect(200);

      const despues = await request(app.getHttpServer())
        .get('/coop/solicitudes-factura')
        .set('Authorization', `Bearer ${tokenCoop}`)
        .expect(200);
      const actualizada = despues.body.find((s: { id: string }) => s.id === solicitud.id);
      expect(actualizada.estado).toBe('emitida');
      expect(actualizada.urlFactura).toBe('https://ejemplo.com/factura.pdf');
    });
  });
});
