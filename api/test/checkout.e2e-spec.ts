import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { Client } from 'pg';
import { limpiarCooperativasDePrueba } from './helpers/limpieza';

/**
 * Paso 4 (último) del plan de blindaje del núcleo. Cubre RF-CHECK y el
 * núcleo de RF-TICKET. El truco documentado en
 * infraestructura/pagos/simulador.pasarela.ts (monto exacto 999999 fuerza
 * un rechazo) se usa aquí a propósito para probar el camino de error sin
 * depender de nada externo ni de aleatoriedad.
 */
describe('Checkout y pago (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();

  let viajeId: string;
  let tokenPasajero: string;
  let tokenCoopRechazo: string;
  let tokenAdmin: string;
  let puntoOrigenId: string;
  let puntoDestinoId: string;
  let unidadIdRechazo: string;
  let modoIvaGuardado: string;
  const PRECIO_BASE = 10; // valor redondo para que los descuentos den números exactos

  async function bloquearYRegistrarAsiento(
    numeroAsiento: string,
    token: string,
  ) {
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
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    // --- Fixture: cooperativa + viaje con precio base redondo ---
    const correoDirector = `director.checkout.${sufijo}@ticketya.ec`;
    await request(app.getHttpServer()).post('/auth/registro').send({
      correo: correoDirector,
      password: 'ClaveSegura123',
      nombres: 'Director', apellidos: 'Checkout Prueba',
    });

    const pg = new Client({
      connectionString: process.env.DATABASE_URL_PUBLICO,
    });
    await pg.connect();
    await pg.query(
      // 04-ago-2026, ítem 9 -- super_admin en vez de admin_plataforma:
      // este mismo usuario prueba /admin/cargo-plataforma, que ahora es
      // exclusivo de super_admin (matriz de permisos, sección 3.8).
      // super_admin sigue pasando los endpoints compartidos también
      // (RolesGuard: @Roles('admin_plataforma', 'super_admin') a nivel
      // de clase), así que no rompe nada más que este archivo pruebe.
      "UPDATE usuarios SET rol='super_admin' WHERE correo=$1",
      [correoDirector],
    );
    const modoIvaFila = await pg.query(
      `SELECT modo_iva_boleto FROM configuracion_plataforma LIMIT 1`,
    );
    modoIvaGuardado = modoIvaFila.rows[0]?.modo_iva_boleto ?? 'calculado';
    await pg.query(
      `UPDATE configuracion_plataforma SET modo_iva_boleto = 'calculado'`,
    );
    await pg.end();

    const loginDirector = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoDirector, password: 'ClaveSegura123' });
    tokenAdmin = loginDirector.body.accessToken;

    const ruc = `07${sufijo}`.slice(0, 13);
    await request(app.getHttpServer())
      .post('/admin/cooperativas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        cooperativa: {
          ruc,
          razonSocial: `Coop Checkout E2E ${sufijo}`,
          nombreComercial: `Coop Checkout ${sufijo}`,
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: `admin.checkout.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombreCompleto: 'Admin Checkout E2E',
        },
      });

    const loginCoop = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        correo: `admin.checkout.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
      });
    const tokenCoop = loginCoop.body.accessToken;

    const origen = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `Origen Checkout ${sufijo}`,
        ciudad: 'Machala',
        provincia: 'El Oro',
      });
    puntoOrigenId = origen.body.puntoOperacionId;

    const destino = await request(app.getHttpServer())
      .post('/admin/puntos-operacion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        tipo: 'terminal_terrestre',
        nombre: `Destino Checkout ${sufijo}`,
        ciudad: 'Guayaquil',
        provincia: 'Guayas',
      });
    puntoDestinoId = destino.body.puntoOperacionId;

    const tipo = await request(app.getHttpServer())
      .post('/coop/tipos-vehiculo')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({ nombre: `Tipo Checkout ${sufijo}`, capacidadTotal: 20 });

    const unidad = await request(app.getHttpServer())
      .post('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({
        tipoVehiculoId: tipo.body.id,
        placa: `CHK-${sufijo % 100000}`,
        identificadorOperativo: `Op-${sufijo % 100000}`,
      });
    unidadIdRechazo = unidad.body.id;
    tokenCoopRechazo = tokenCoop;

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
        fechaSalida: '2026-12-01',
        horaSalidaProgramada: '2026-12-01T08:00:00-05:00',
        precioBase: PRECIO_BASE,
      });
    viajeId = viaje.body.id;

    const pasajero = await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: `pasajero.checkout.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
        nombres: 'Pasajero', apellidos: 'Checkout Prueba',
      });
    tokenPasajero = pasajero.body.accessToken;
  });

  afterAll(async () => {
    // 22-jul-2026: limpieza real (ver test/helpers/limpieza.ts) — este
    // archivo genera compras/boletos/comprobantes reales de prueba, la
    // cadena más larga de las cuatro.
    await limpiarCooperativasDePrueba([`Coop Checkout ${sufijo}`]);

    const pgRestaurar = new Client({
      connectionString: process.env.DATABASE_URL_PUBLICO,
    });
    await pgRestaurar.connect();
    await pgRestaurar.query(
      `UPDATE configuracion_plataforma SET modo_iva_boleto = $1`,
      [modoIvaGuardado],
    );
    await pgRestaurar.end();

    await app.close();
  });

  it('rechaza el checkout si el asiento nunca se bloqueó primero (integración RF-SEAT → RF-CHECK)', async () => {
    await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '9Z',
            nombres: 'Nadie',
            apellidos: 'Reservó Esto',
            tipoDocumento: 'cedula',
            documento: '1701000000',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(400);
  });

  it('compra exitosa de un pasajero adulto: aprueba el pago y genera boleto con QR (RF-CHECK, RF-TICKET-001)', async () => {
    await bloquearYRegistrarAsiento('1A', tokenPasajero);

    const res = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '1A',
            nombres: 'Pasajero',
            apellidos: 'Adulto Prueba',
            tipoDocumento: 'cedula',
            documento: '1701001370',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);

    expect(res.body.estado).toBe('aprobado');
    expect(res.body.boletos).toHaveLength(1);
    expect(res.body.boletos[0].codigoQr).toBeDefined();
    // IVA (RN nuevo, 21-jul-2026): la cooperativa nace con 15% por
    // defecto, ya incluido dentro del precio (no se suma aparte al
    // total). Con PRECIO_BASE=10: iva = 10 - 10/1.15 = 1.30.
    expect(res.body.ivaTotal).toBeCloseTo(1.3, 2);
    expect(res.body.ivaVisible).toBe(true);
    expect(res.body.montoTotal).toBe(PRECIO_BASE); // el IVA NO se suma aparte, ya está adentro
  });

  it('aplica el 50% de descuento a un pasajero niño, con autorización de viaje (RN-001, RF-CHECK-002 + RF-MENOR, hallazgo cerrado 22-jul-2026)', async () => {
    await bloquearYRegistrarAsiento('1B', tokenPasajero);

    const res = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '1B',
            nombres: 'Pasajero',
            apellidos: 'Niño Prueba',
            tipoDocumento: 'cedula',
            documento: '1701002741',
            tipoTarifa: 'nino',
            fechaNacimiento: '2018-01-01',
            autorizacionMenor: {
              tipoAcompanamiento: 'con_autorizacion',
              adultoResponsableNombre: 'Madre Responsable E2E',
              adultoResponsableDocumento: '0911111111',
              adultoResponsableTelefono: '0999999999',
            },
          },
        ],
      })
      .expect(201);

    // Precio base 10, niño 50% de descuento, tasa de terminal y cargo de
    // plataforma en 0 hoy (ver hallazgo más abajo) → montoTotal debe dar
    // exactamente 5.
    expect(Number(res.body.montoTotal)).toBe(5);
  });

  it('rechaza comprar para un menor sin indicar cómo viaja acompañado — hallazgo real cerrado 22-jul-2026 (antes pasaba sin ningún control)', async () => {
    await bloquearYRegistrarAsiento('2B', tokenPasajero);
    const res = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '2B',
            nombres: 'Pasajero',
            apellidos: 'Niño Sin Autorizacion Prueba',
            tipoDocumento: 'cedula',
            documento: '1701004119',
            tipoTarifa: 'nino',
            fechaNacimiento: '2018-01-01',
          },
        ],
      })
      .expect(400);
    expect(res.body.message).toContain('menor de edad');
  });

  it('permite que el menor viaje con un adulto de la misma compra, sin datos de autorización', async () => {
    await bloquearYRegistrarAsiento('2C', tokenPasajero);
    await bloquearYRegistrarAsiento('2D', tokenPasajero);
    const res = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '2C',
            nombres: 'Padre',
            apellidos: 'Prueba',
            tipoDocumento: 'cedula',
            documento: '1701005488',
            tipoTarifa: 'adulto',
          },
          {
            viajeId,
            numeroAsiento: '2D',
            nombres: 'Hijo',
            apellidos: 'Prueba',
            tipoDocumento: 'cedula',
            documento: '1701006858',
            tipoTarifa: 'nino',
            fechaNacimiento: '2019-01-01',
            autorizacionMenor: {
              tipoAcompanamiento: 'con_padre_madre_tutor',
              adultoAcompananteIndice: 0,
            },
          },
        ],
      })
      .expect(201);
    expect(res.body.boletos).toHaveLength(2);
  });

  it('el personal de la cooperativa puede verificar los documentos del menor al validar el boleto en el andén (RF-MENOR-004)', async () => {
    await bloquearYRegistrarAsiento('3B', tokenPasajero);
    const compra = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '3B',
            nombres: 'Pasajero',
            apellidos: 'Niño Verificacion Prueba',
            tipoDocumento: 'cedula',
            documento: '1701008227',
            tipoTarifa: 'nino',
            fechaNacimiento: '2017-01-01',
            autorizacionMenor: {
              tipoAcompanamiento: 'con_autorizacion',
              adultoResponsableNombre: 'Padre Verificacion E2E',
              adultoResponsableDocumento: '0955555555',
            },
          },
        ],
      })
      .expect(201);
    const codigoQr = compra.body.boletos[0].codigoQr;
    const boletoId = compra.body.boletos[0].id;

    const validacion = await request(app.getHttpServer())
      .post('/coop/validar-qr')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({ codigoQr })
      .expect(201);
    expect(validacion.body.menor).toBeDefined();
    expect(validacion.body.menor.tipoAcompanamiento).toBe('con_autorizacion');
    expect(validacion.body.menor.adultoResponsableNombre).toBe(
      'Padre Verificacion E2E',
    );
    expect(validacion.body.menor.yaVerificado).toBe(false);
    // El campo de discapacidad NO debe aparecer para un pasajero con
    // tarifa 'nino' -- confirma que documentoDiscapacidad solo se
    // adjunta cuando la tarifa real es 'discapacidad'.
    expect(validacion.body.documentoDiscapacidad).toBeUndefined();

    await request(app.getHttpServer())
      .post('/coop/verificar-menor')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        boletoId,
        documentoIdentidadVerificado: true,
        documentoAutorizacionVerificado: true,
      })
      .expect(201);
  });

  it('rechaza una compra con tarifa discapacidad sin el número de documento (13-ago-2026)', async () => {
    await bloquearYRegistrarAsiento('5B', tokenPasajero);
    const res = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '5B',
            nombres: 'Pasajero',
            apellidos: 'Discapacidad Sin Documento Prueba',
            tipoDocumento: 'cedula',
            documento: '1701002741',
            tipoTarifa: 'discapacidad',
          },
        ],
      })
      .expect(400);
    expect(res.body.message).toContain(
      'falta el número de carné CONADIS/MSP o de cédula donde conste la condición',
    );
  });

  it('acepta con el número de documento presente, aplica correctamente el 50% (13-ago-2026)', async () => {
    await bloquearYRegistrarAsiento('5C', tokenPasajero);
    const res = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '5C',
            nombres: 'Pasajero',
            apellidos: 'Discapacidad Prueba',
            tipoDocumento: 'cedula',
            documento: '1701004119',
            tipoTarifa: 'discapacidad',
            numeroDocumentoDiscapacidad: 'CONADIS-123456',
          },
        ],
      })
      .expect(201);

    // Precio base 10, 50% de descuento (Reglamento LOD Art. 22) → montoTotal debe dar exactamente 5.
    expect(Number(res.body.montoTotal)).toBe(5);
  });

  it('el personal de la cooperativa puede ver el número de documento declarado al validar el boleto en el andén (13-ago-2026)', async () => {
    await bloquearYRegistrarAsiento('5D', tokenPasajero);
    const compra = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '5D',
            nombres: 'Pasajero',
            apellidos: 'Discapacidad Verificacion Prueba',
            tipoDocumento: 'cedula',
            documento: '1701006429',
            tipoTarifa: 'discapacidad',
            numeroDocumentoDiscapacidad: 'CEDULA-1701006429',
          },
        ],
      })
      .expect(201);
    const codigoQr = compra.body.boletos[0].codigoQr;

    const validacion = await request(app.getHttpServer())
      .post('/coop/validar-qr')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({ codigoQr })
      .expect(201);

    expect(validacion.body.documentoDiscapacidad).toBeDefined();
    expect(validacion.body.documentoDiscapacidad.numeroDeclarado).toBe(
      'CEDULA-1701006429',
    );
  });

  it('la cooperativa puede ver la lista de pasajeros ("manifiesto") de un viaje concreto — hallazgo real cerrado 22-jul-2026 (antes no existía ninguna forma de ver quién iba a abordar)', async () => {
    await bloquearYRegistrarAsiento('4A', tokenPasajero);
    await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '4A',
            nombres: 'Pasajero',
            apellidos: 'Manifiesto Prueba',
            tipoDocumento: 'cedula',
            documento: '1701009597',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/coop/viajes/${viajeId}/pasajeros`)
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .expect(200);

    const fila = res.body.find(
      (p: { numeroAsiento: string }) => p.numeroAsiento === '4A',
    );
    expect(fila).toBeDefined();
    expect(fila.nombreCompleto).toBe('Pasajero Manifiesto Prueba');
    expect(fila.documento).toBe('1701009597');
    expect(fila.estadoBoleto).toBe('vigente');
    expect(fila.esMenorEdad).toBe(false);
  });

  it('el pasajero puede cancelar su propio boleto — hallazgo real cerrado 22-jul-2026 (antes no existía ninguna forma de cancelar)', async () => {
    await bloquearYRegistrarAsiento('3C', tokenPasajero);
    const compra = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '3C',
            nombres: 'Pasajero',
            apellidos: 'Cancelacion Prueba',
            tipoDocumento: 'cedula',
            documento: '1701010967',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);
    const boletoId = compra.body.boletos[0].id;

    await request(app.getHttpServer())
      .post(`/compras/boletos/${boletoId}/cancelar`)
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .expect(201);

    // El asiento debe volver a estar disponible para otra persona.
    const mapa = await request(app.getHttpServer())
      .get(`/viajes/${viajeId}/asientos`)
      .expect(200);
    const asiento3C = mapa.body.asientosNoDisponibles.find(
      (a: { numeroAsiento: string }) => a.numeroAsiento === '3C',
    );
    expect(asiento3C).toBeUndefined();

    // Y ya no se puede cancelar dos veces.
    const segundoIntento = await request(app.getHttpServer())
      .post(`/compras/boletos/${boletoId}/cancelar`)
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .expect(400);
    expect(segundoIntento.body.message).toContain('cancelado');
  });

  it('un pasajero no puede cancelar el boleto de otro', async () => {
    await bloquearYRegistrarAsiento('3D', tokenPasajero);
    const compra = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '3D',
            nombres: 'Pasajero',
            apellidos: 'Cancelacion Ajena Prueba',
            tipoDocumento: 'cedula',
            documento: '1701012336',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);
    const boletoId = compra.body.boletos[0].id;

    const otroPasajero = await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: `otro.cancelacion.${sufijo}@ticketya.ec`,
        password: 'ClaveSegura123',
        nombres: 'Otro', apellidos: 'Pasajero Cancelacion Prueba',
      });

    const res = await request(app.getHttpServer())
      .post(`/compras/boletos/${boletoId}/cancelar`)
      .set('Authorization', `Bearer ${otroPasajero.body.accessToken}`)
      .expect(400);
    expect(res.body.message).toContain('no te pertenece');
  });

  it('la cooperativa puede cancelar un viaje completo, y cascada automáticamente a los boletos ya vendidos — hallazgo real cerrado 22-jul-2026 (antes no existía ninguna forma de hacerlo)', async () => {
    // Viaje aparte (no el fixture principal — cancelarlo rompería otras
    // pruebas de este archivo).
    const rutaRes = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        origenPuntoOperacionId: puntoOrigenId,
        destinoPuntoOperacionId: puntoDestinoId,
        precioBaseReferencia: PRECIO_BASE,
      });
    const viajeCancelableRes = await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        rutaId: rutaRes.body.id,
        unidadId: unidadIdRechazo,
        fechaSalida: '2026-06-01',
        horaSalidaProgramada: '2026-06-01T08:00:00-05:00',
        precioBase: PRECIO_BASE,
      });
    const viajeCancelableId = viajeCancelableRes.body.id;

    await request(app.getHttpServer())
      .post(`/viajes/${viajeCancelableId}/asientos/1A/bloquear`)
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .expect(201);
    const compra = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId: viajeCancelableId,
            numeroAsiento: '1A',
            nombres: 'Pasajero',
            apellidos: 'Viaje Cancelado Prueba',
            tipoDocumento: 'cedula',
            documento: '1701013706',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/coop/viajes/${viajeCancelableId}/cancelar`)
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .expect(201);
    expect(res.body.boletosCancelados).toBe(1);

    // Confirma la cascada: el boleto queda 'cancelado', ya no se puede
    // validar en el andén.
    const validacion = await request(app.getHttpServer())
      .post('/coop/validar-qr')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({ codigoQr: compra.body.boletos[0].codigoQr })
      .expect(201);
    expect(validacion.body.valido).toBe(false);
    expect(validacion.body.mensaje).toContain('cancelado');

    // No se puede cancelar dos veces.
    const segundoIntento = await request(app.getHttpServer())
      .post(`/coop/viajes/${viajeCancelableId}/cancelar`)
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .expect(400);
    expect(segundoIntento.body.message).toContain('cancelado');
  });

  it('la cooperativa puede cambiar la unidad de un viaje programado ("vehículo de reemplazo") sin tocar los boletos ya vendidos — investigado y confirmado 22-jul-2026 (patrón real del sector + respaldo legal ANT/LOTTTSV)', async () => {
    // Viaje aparte, con un boleto ya vendido en un asiento que solo
    // existe si la capacidad es suficiente.
    const rutaRes = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        origenPuntoOperacionId: puntoOrigenId,
        destinoPuntoOperacionId: puntoDestinoId,
        precioBaseReferencia: PRECIO_BASE,
      });
    const viajeParaCambioRes = await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        rutaId: rutaRes.body.id,
        unidadId: unidadIdRechazo, // capacidad 20
        fechaSalida: '2026-06-02',
        horaSalidaProgramada: '2026-06-02T08:00:00-05:00',
        precioBase: PRECIO_BASE,
      });
    const viajeParaCambioId = viajeParaCambioRes.body.id;

    await request(app.getHttpServer())
      .post(`/viajes/${viajeParaCambioId}/asientos/5A/bloquear`) // solo existe con capacidad >= 18
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .expect(201);
    const compra = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId: viajeParaCambioId,
            numeroAsiento: '5A',
            nombres: 'Pasajero',
            apellidos: 'Cambio Unidad Prueba',
            tipoDocumento: 'cedula',
            documento: '1701015073',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);

    // Unidad de reemplazo MÁS CHICA (capacidad 4) — debe rechazarse,
    // dejaría inválido el asiento 5A ya vendido.
    const tipoChicoRes = await request(app.getHttpServer())
      .post('/coop/tipos-vehiculo')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({ nombre: `Tipo Chico Reemplazo ${sufijo}`, capacidadTotal: 4 });
    const unidadChicaRes = await request(app.getHttpServer())
      .post('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        tipoVehiculoId: tipoChicoRes.body.id,
        placa: `CHI-${sufijo % 100000}`,
        identificadorOperativo: `ChicoOp-${sufijo % 100000}`,
      });

    const intentoChico = await request(app.getHttpServer())
      .patch(`/coop/viajes/${viajeParaCambioId}/unidad`)
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({ nuevaUnidadId: unidadChicaRes.body.id })
      .expect(400);
    expect(intentoChico.body.message).toContain('menos capacidad');

    // Unidad de reemplazo con capacidad SUFICIENTE — debe aceptarse, y
    // el boleto ya vendido no debe verse afectado para nada.
    const tipoGrandeRes = await request(app.getHttpServer())
      .post('/coop/tipos-vehiculo')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({ nombre: `Tipo Reemplazo ${sufijo}`, capacidadTotal: 20 });
    const unidadGrandeRes = await request(app.getHttpServer())
      .post('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        tipoVehiculoId: tipoGrandeRes.body.id,
        placa: `REP-${sufijo % 100000}`,
        identificadorOperativo: `RepOp-${sufijo % 100000}`,
      });

    await request(app.getHttpServer())
      .patch(`/coop/viajes/${viajeParaCambioId}/unidad`)
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({ nuevaUnidadId: unidadGrandeRes.body.id })
      .expect(200);

    // El boleto sigue exactamente igual — sin cascada, sin cancelación.
    const validacion = await request(app.getHttpServer())
      .post('/coop/validar-qr')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({ codigoQr: compra.body.boletos[0].codigoQr })
      .expect(201);
    expect(validacion.body.valido).toBe(true);
  });

  it('la cooperativa puede editar la hora y el precio de un viaje SIN boletos vendidos — hallazgo cerrado 22-jul-2026 (antes no existía ninguna forma de corregir un error de captura)', async () => {
    const rutaRes = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        origenPuntoOperacionId: puntoOrigenId,
        destinoPuntoOperacionId: puntoDestinoId,
        precioBaseReferencia: PRECIO_BASE,
      });
    const viajeEditableRes = await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        rutaId: rutaRes.body.id,
        unidadId: unidadIdRechazo,
        fechaSalida: '2026-06-03',
        horaSalidaProgramada: '2026-06-03T08:00:00-05:00',
        precioBase: PRECIO_BASE,
      });
    const viajeEditableId = viajeEditableRes.body.id;

    await request(app.getHttpServer())
      .patch(`/coop/viajes/${viajeEditableId}`)
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        horaSalidaProgramada: '2026-06-03T09:30:00-05:00',
        precioBase: 12.5,
      })
      .expect(200);

    const listado = await request(app.getHttpServer())
      .get('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .expect(200);
    const editado = listado.body.find(
      (v: { id: string }) => v.id === viajeEditableId,
    );
    expect(editado.precioBase).toBe(12.5);
  });

  it('se puede desactivar una unidad, y ya no se puede asignar a un viaje ("cambiar unidad" la rechaza) — hallazgo real cerrado 22-jul-2026 (antes no había forma de marcarla inactiva)', async () => {
    const tipoRes = await request(app.getHttpServer())
      .post('/coop/tipos-vehiculo')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({ nombre: `Tipo Inactivo ${sufijo}`, capacidadTotal: 20 });
    const unidadInactivaRes = await request(app.getHttpServer())
      .post('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        tipoVehiculoId: tipoRes.body.id,
        placa: `INA-${sufijo % 100000}`,
        identificadorOperativo: `InaOp-${sufijo % 100000}`,
      });

    const listaAntes = await request(app.getHttpServer())
      .get('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .expect(200);
    const unidadEnLista = listaAntes.body.find(
      (u: { id: string }) => u.id === unidadInactivaRes.body.id,
    );
    expect(unidadEnLista.activo).toBe(true); // activa por defecto

    await request(app.getHttpServer())
      .patch(`/coop/unidades/${unidadInactivaRes.body.id}/estado`)
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({ activo: false })
      .expect(200);

    const listaDespues = await request(app.getHttpServer())
      .get('/coop/unidades')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .expect(200);
    const unidadYaInactiva = listaDespues.body.find(
      (u: { id: string }) => u.id === unidadInactivaRes.body.id,
    );
    expect(unidadYaInactiva.activo).toBe(false);

    // Intentar asignarla a un viaje vía "cambiar unidad" debe rechazarse.
    const rutaRes = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        origenPuntoOperacionId: puntoOrigenId,
        destinoPuntoOperacionId: puntoDestinoId,
        precioBaseReferencia: PRECIO_BASE,
      });
    const viajeParaRechazoRes = await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        rutaId: rutaRes.body.id,
        unidadId: unidadIdRechazo,
        fechaSalida: '2026-06-05',
        horaSalidaProgramada: '2026-06-05T08:00:00-05:00',
        precioBase: PRECIO_BASE,
      });

    const intento = await request(app.getHttpServer())
      .patch(`/coop/viajes/${viajeParaRechazoRes.body.id}/unidad`)
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({ nuevaUnidadId: unidadInactivaRes.body.id })
      .expect(400);
    expect(intento.body.message).toContain('inactiva');
  });

  it('rechaza editar un viaje que ya tiene boletos vendidos', async () => {
    const rutaRes = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        origenPuntoOperacionId: puntoOrigenId,
        destinoPuntoOperacionId: puntoDestinoId,
        precioBaseReferencia: PRECIO_BASE,
      });
    const viajeConVentaRes = await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        rutaId: rutaRes.body.id,
        unidadId: unidadIdRechazo,
        fechaSalida: '2026-06-04',
        horaSalidaProgramada: '2026-06-04T08:00:00-05:00',
        precioBase: PRECIO_BASE,
      });
    const viajeConVentaId = viajeConVentaRes.body.id;

    await request(app.getHttpServer())
      .post(`/viajes/${viajeConVentaId}/asientos/1A/bloquear`)
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .expect(201);
    await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId: viajeConVentaId,
            numeroAsiento: '1A',
            nombres: 'Pasajero',
            apellidos: 'Editar Rechazo Prueba',
            tipoDocumento: 'cedula',
            documento: '1701016444',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/coop/viajes/${viajeConVentaId}`)
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({ precioBase: 99 })
      .expect(400);
    expect(res.body.message).toContain('boletos vendidos');
  });

  it('cada boleto trae su propio desglose de precio en la respuesta — hallazgo cerrado 22-jul-2026 (antes solo traía id y codigoQr)', async () => {
    await bloquearYRegistrarAsiento('1D', tokenPasajero);
    const res = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '1D',
            nombres: 'Pasajero',
            apellidos: 'Hallazgo Prueba',
            tipoDocumento: 'cedula',
            documento: '1701017814',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);

    const boleto = res.body.boletos[0];
    // Ampliado 15-ago-2026 -- hallazgo real del director en el
    // recorrido en vivo de producción: faltaba cooperativa, ruta,
    // hora, unidad y a nombre de quién queda el boleto.
    expect(Object.keys(boleto).sort()).toEqual([
      'cargoPlataforma',
      'codigoQr',
      'compradorDocumento',
      'compradorNombre',
      'cooperativaNombre',
      'esVip',
      'fechaSalida',
      'horaSalidaProgramada',
      'id',
      'ivaMonto',
      'numeroAsiento',
      'precioPagado',
      'rutaDestinoCiudad',
      'rutaOrigenCiudad',
      'tasaTerminal',
      'unidadIdentificador',
      'unidadPlaca',
    ]);
    expect(boleto.numeroAsiento).toBe('1D');
    expect(boleto.precioPagado).toBe(PRECIO_BASE);
    // Verificación real de los valores, no solo de las llaves --
    // mismo criterio de rigor del resto del proyecto.
    expect(boleto.cooperativaNombre).toBeTruthy();
    expect(boleto.rutaOrigenCiudad).toBeTruthy();
    expect(boleto.rutaDestinoCiudad).toBeTruthy();
    expect(boleto.compradorNombre).toBeTruthy();
    expect(new Date(boleto.horaSalidaProgramada).toString()).not.toBe('Invalid Date');
  });

  it('el desglose por boleto sigue disponible aunque se reintente la misma idempotencyKey (RF-CHECK-005 + hallazgo del 22-jul-2026 combinados)', async () => {
    await bloquearYRegistrarAsiento('2A', tokenPasajero);
    const idempotencyKey = `idem-desglose-${sufijo}`;
    const payload = {
      pasajeros: [
        {
          viajeId,
          numeroAsiento: '2A',
          nombres: 'Pasajero',
          apellidos: 'Reintento Desglose Prueba',
          tipoDocumento: 'cedula',
          documento: '1701019182',
          tipoTarifa: 'adulto',
        },
      ],
      idempotencyKey,
    };

    const primera = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send(payload)
      .expect(201);

    const segunda = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send(payload)
      .expect(201);

    expect(segunda.body.boletos[0].precioPagado).toBe(
      primera.body.boletos[0].precioPagado,
    );
    expect(segunda.body.boletos[0].numeroAsiento).toBe('2A');
  });

  it('la misma idempotencyKey enviada dos veces NO cobra ni genera boleto dos veces (RF-CHECK-005)', async () => {
    await bloquearYRegistrarAsiento('1C', tokenPasajero);
    const idempotencyKey = `idem-e2e-${sufijo}`;
    const payload = {
      pasajeros: [
        {
          viajeId,
          numeroAsiento: '1C',
          nombres: 'Pasajero',
          apellidos: 'Idempotencia Prueba',
          tipoDocumento: 'cedula',
          documento: '1701000000',
          tipoTarifa: 'adulto',
        },
      ],
      idempotencyKey,
    };

    const primera = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send(payload)
      .expect(201);

    const segunda = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send(payload)
      .expect(201);

    expect(segunda.body.compraId).toBe(primera.body.compraId);
    expect(segunda.body.reintento).toBe(true);
  });

  it('un pago rechazado no genera boleto, y el motivo queda claro (camino de error, sin depender de la pasarela real)', async () => {
    // El simulador de pago (infraestructura/pagos/simulador.pasarela.ts)
    // rechaza a propósito cuando el monto total es EXACTAMENTE 999999.
    // Como hoy la tasa de terminal y el cargo de plataforma son 0 (no
    // hay fila en configuracion_plataforma — ver hallazgo más abajo) el
    // monto total de un solo pasajero adulto es igual al precio base del
    // viaje: basta un viaje con precioBase = 999999 para disparar el
    // rechazo de forma determinística, sin depender de nada externo.
    const rutaRechazo = await request(app.getHttpServer())
      .post('/coop/rutas')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        origenPuntoOperacionId: puntoOrigenId,
        destinoPuntoOperacionId: puntoDestinoId,
        precioBaseReferencia: 999999,
      });

    const viajeRechazo = await request(app.getHttpServer())
      .post('/coop/viajes')
      .set('Authorization', `Bearer ${tokenCoopRechazo}`)
      .send({
        rutaId: rutaRechazo.body.id,
        unidadId: unidadIdRechazo,
        fechaSalida: '2026-12-02',
        horaSalidaProgramada: '2026-12-02T08:00:00-05:00',
        precioBase: 999999,
      });

    await request(app.getHttpServer())
      .post(`/viajes/${viajeRechazo.body.id}/asientos/1A/bloquear`)
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId: viajeRechazo.body.id,
            numeroAsiento: '1A',
            nombres: 'Pasajero',
            apellidos: 'Rechazo Prueba',
            tipoDocumento: 'cedula',
            documento: '1701001370',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201); // el endpoint responde 201 igual — el rechazo va en el cuerpo, no en el código HTTP

    expect(res.body.estado).toBe('rechazado');
    expect(res.body.boletos).toBeUndefined();
  });

  it('el cargo fijo de plataforma por pasajero ya es configurable, y el checkout lo refleja — hallazgo cerrado 22-jul-2026 (antes caía en 0 sin forma de cambiarlo)', async () => {
    const res1 = await request(app.getHttpServer())
      .get('/admin/cargo-plataforma')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(res1.body.monto).toBe(0); // valor por defecto, nadie lo ha configurado todavía en este entorno de prueba

    await request(app.getHttpServer())
      .patch('/admin/cargo-plataforma')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ monto: 0.25 })
      .expect(200);

    const res2 = await request(app.getHttpServer())
      .get('/admin/cargo-plataforma')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(res2.body.monto).toBe(0.25);

    // Confirma que el checkout de verdad usa este valor, no solo que se guardó.
    await bloquearYRegistrarAsiento('3A', tokenPasajero);
    const compra = await request(app.getHttpServer())
      .post('/compras')
      .set('Authorization', `Bearer ${tokenPasajero}`)
      .send({
        pasajeros: [
          {
            viajeId,
            numeroAsiento: '3A',
            nombres: 'Pasajero',
            apellidos: 'Cargo Plataforma Prueba',
            tipoDocumento: 'cedula',
            documento: '1701002741',
            tipoTarifa: 'adulto',
          },
        ],
      })
      .expect(201);
    expect(compra.body.boletos[0].cargoPlataforma).toBe(0.25);
    expect(compra.body.montoTotal).toBe(PRECIO_BASE + 0.25);

    // se deja de nuevo en 0 para no afectar otras pruebas de esta suite
    // ni de otros archivos que corren en paralelo contra la misma base.
    await request(app.getHttpServer())
      .patch('/admin/cargo-plataforma')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ monto: 0 })
      .expect(200);
  });

  /**
   * Zona VIP de asientos (17-ago-2026, orden real del director) --
   * fixture propio y aislado, no reutiliza el viaje compartido de la
   * suite (necesita su propia distribución de asientos con una
   * etiqueta 'vip' explícita, cosa que el tipo de vehículo compartido
   * no tiene).
   */
  describe('Zona VIP de asientos -- recargo fijo real (17-ago-2026)', () => {
    it('cobra precioBase + recargoVip en un asiento VIP, y solo precioBase en uno normal', async () => {
      const correoAdminVip = `admin.vip.${sufijo}@ticketya.ec`;
      const rucVip = `08${sufijo}`.slice(0, 13);
      await request(app.getHttpServer())
        .post('/admin/cooperativas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          cooperativa: {
            ruc: rucVip,
            razonSocial: `Coop VIP E2E ${sufijo}`,
            nombreComercial: `Coop VIP ${sufijo}`,
            modeloIntegracion: 'modelo_a',
          },
          usuario: {
            correo: correoAdminVip,
            password: 'ClaveSegura123',
            nombreCompleto: 'Admin VIP E2E',
          },
        });
      const loginCoopVip = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ correo: correoAdminVip, password: 'ClaveSegura123' });
      const tokenCoopVip = loginCoopVip.body.accessToken;

      // Distribución real con 1 asiento VIP (1A) y 1 normal (1B) --
      // mismo formato real que ya usa el panel de cooperativa.
      const tipoVip = await request(app.getHttpServer())
        .post('/coop/tipos-vehiculo')
        .set('Authorization', `Bearer ${tokenCoopVip}`)
        .send({
          nombre: `Tipo VIP ${sufijo}`,
          capacidadTotal: 2,
          distribucionAsientos: {
            pisos: [
              {
                nombre: 'Piso único',
                filas: [{ celdas: [{ numero: '1A', etiquetas: ['vip'] }, '1B'] }],
              },
            ],
          },
        });

      const unidadVip = await request(app.getHttpServer())
        .post('/coop/unidades')
        .set('Authorization', `Bearer ${tokenCoopVip}`)
        .send({
          tipoVehiculoId: tipoVip.body.id,
          placa: `VIP-${sufijo % 100000}`,
          identificadorOperativo: `Op-VIP-${sufijo % 100000}`,
        });

      const rutaVip = await request(app.getHttpServer())
        .post('/coop/rutas')
        .set('Authorization', `Bearer ${tokenCoopVip}`)
        .send({
          origenPuntoOperacionId: puntoOrigenId,
          destinoPuntoOperacionId: puntoDestinoId,
          precioBaseReferencia: 10,
        });

      const viajeVip = await request(app.getHttpServer())
        .post('/coop/viajes')
        .set('Authorization', `Bearer ${tokenCoopVip}`)
        .send({
          rutaId: rutaVip.body.id,
          unidadId: unidadVip.body.id,
          fechaSalida: '2026-12-02',
          horaSalidaProgramada: '2026-12-02T08:00:00-05:00',
          precioBase: 10,
          recargoVip: 3,
        })
        .expect(201);
      const viajeIdVip = viajeVip.body.id;

      const pasajeroVip = await request(app.getHttpServer())
        .post('/auth/registro')
        .send({
          correo: `pasajero.vip.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombres: 'Pasajero', apellidos: 'VIP Prueba',
        });
      const loginPasajeroVip = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ correo: `pasajero.vip.${sufijo}@ticketya.ec`, password: 'ClaveSegura123' });
      const tokenPasajeroVip = loginPasajeroVip.body.accessToken;

      await request(app.getHttpServer())
        .post(`/viajes/${viajeIdVip}/asientos/1A/bloquear`)
        .set('Authorization', `Bearer ${tokenPasajeroVip}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/viajes/${viajeIdVip}/asientos/1B/bloquear`)
        .set('Authorization', `Bearer ${tokenPasajeroVip}`)
        .expect(201);

      const compraVip = await request(app.getHttpServer())
        .post('/compras')
        .set('Authorization', `Bearer ${tokenPasajeroVip}`)
        .send({
          pasajeros: [
            {
              viajeId: viajeIdVip,
              numeroAsiento: '1A',
              nombres: 'Pasajero', apellidos: 'Vip Uno',
              tipoDocumento: 'cedula', documento: '1701002741',
              tipoTarifa: 'adulto',
            },
            {
              viajeId: viajeIdVip,
              numeroAsiento: '1B',
              nombres: 'Pasajero', apellidos: 'Normal Dos',
              tipoDocumento: 'cedula', documento: '1701004119',
              tipoTarifa: 'adulto',
            },
          ],
        })
        .expect(201);

      const boletoVip = compraVip.body.boletos.find((b: { numeroAsiento: string }) => b.numeroAsiento === '1A');
      const boletoNormal = compraVip.body.boletos.find((b: { numeroAsiento: string }) => b.numeroAsiento === '1B');
      expect(Number(boletoVip.precioPagado)).toBe(13); // 10 + 3 de recargo VIP
      expect(Number(boletoNormal.precioPagado)).toBe(10); // sin recargo, es un asiento normal
    });
  });
});
