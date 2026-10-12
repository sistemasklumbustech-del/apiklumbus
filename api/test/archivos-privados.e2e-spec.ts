import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import sharp from 'sharp';
import { Client } from 'pg';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from './../src/app.module';
import { limpiarCooperativasDePrueba } from './helpers/limpieza';
import { REFERENCIA_PRIVADA_VALIDA, TTL_ENLACE_SEGUNDOS, leerReferencia, urlFirmada } from './../src/infraestructura/seguridad/archivos-privados';

// Carpeta privada propia de esta prueba.
const CARPETA_PRIVADA = mkdtempSync(join(tmpdir(), 'klumbus-privados-'));
process.env.ARCHIVOS_PRIVADOS_DIR = CARPETA_PRIVADA;

/** Comprobantes de pago privados con enlace firmado (12-oct-2026). */
describe('Archivos privados (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();
  const correoAdmin = `director.archivos.${sufijo}@ticketya.ec`;
  const correoCoop = `admin.coop.archivos.${sufijo}@ticketya.ec`;
  const nombreCoop = `Coop Archivos E2E ${sufijo}`;
  let tokenCoop: string;
  let referencia: string;
  let ruta: string; // /archivos-privados/<carpeta>/<nombre>

  const consultar = async (consulta: string, valores: unknown[] = []) => {
    const pg = new Client({ connectionString: process.env.DATABASE_URL_PUBLICO });
    await pg.connect();
    try {
      return (await pg.query(consulta, valores)).rows;
    } finally {
      await pg.end();
    }
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    await request(app.getHttpServer())
      .post('/auth/registro')
      .send({ aceptoTerminos: true, correo: correoAdmin, password: 'ClaveSegura123', nombres: 'Director', apellidos: 'Archivos' })
      .expect(201);
    await consultar("UPDATE usuarios SET rol='admin_plataforma' WHERE correo=$1", [correoAdmin]);
    const loginAdmin = await request(app.getHttpServer()).post('/auth/login').send({ correo: correoAdmin, password: 'ClaveSegura123' }).expect(201);
    await request(app.getHttpServer())
      .post('/admin/cooperativas')
      .set('Authorization', `Bearer ${loginAdmin.body.accessToken}`)
      .send({
        cooperativa: { ruc: `07${String(sufijo).slice(-11)}`, razonSocial: 'Cooperativa Archivos E2E S.A.', nombreComercial: nombreCoop, modeloIntegracion: 'modelo_a' },
        usuario: { correo: correoCoop, password: 'ClaveSegura123', nombreCompleto: 'Admin Coop Archivos' },
      })
      .expect(201);
    const loginCoop = await request(app.getHttpServer()).post('/auth/login').send({ correo: correoCoop, password: 'ClaveSegura123' }).expect(201);
    tokenCoop = loginCoop.body.accessToken;
  });

  afterAll(async () => {
    await limpiarCooperativasDePrueba([nombreCoop]);
    await app.close();
  });

  const subir = async (contenido: Buffer, nombre: string, tipo: string) =>
    request(app.getHttpServer())
      .post('/coop/ventanilla/comprobante')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .attach('comprobante', contenido, { filename: nombre, contentType: tipo });

  it('el comprobante subido queda en la carpeta privada y se devuelve una referencia, no una URL', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#336699' } }).png().toBuffer();
    const res = await subir(png, 'comprobante.png', 'image/png').then((r) => {
      expect(r.status).toBe(201);
      return r;
    });
    referencia = res.body.comprobanteUrl;
    expect(referencia).toMatch(REFERENCIA_PRIVADA_VALIDA);
    const partes = leerReferencia(referencia)!;
    ruta = `/archivos-privados/${partes.carpeta}/${partes.nombre}`;
    expect(existsSync(join(CARPETA_PRIVADA, partes.carpeta, partes.nombre))).toBe(true);
    expect(existsSync(join(process.cwd(), 'uploads', partes.carpeta, partes.nombre))).toBe(false);
  });

  it('lo que no es una imagen se rechaza', async () => {
    expect((await subir(Buffer.from('<html><script>alert(1)</script></html>'), 'a.png', 'image/png')).status).toBe(400);
    expect((await subir(Buffer.from('%PDF-1.4'), 'a.pdf', 'application/pdf')).status).toBe(400);
  });

  it('con el enlace firmado se abre; el archivo no se cachea y llega con su tipo', async () => {
    const enlace = new URL(urlFirmada(referencia));
    const res = await request(app.getHttpServer()).get(enlace.pathname + enlace.search).expect(200);
    expect(res.headers['content-type']).toContain('image/webp');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['content-disposition']).toBe('inline');
  });

  it('sin firma, con la firma alterada o vencido, no se abre', async () => {
    const enlace = new URL(urlFirmada(referencia));
    const vence = enlace.searchParams.get('vence')!;
    const firma = enlace.searchParams.get('firma')!;

    await request(app.getHttpServer()).get(ruta).expect(403);
    await request(app.getHttpServer()).get(`${ruta}?vence=${vence}&firma=${'0'.repeat(64)}`).expect(403);
    await request(app.getHttpServer()).get(`${ruta}?vence=${Number(vence) + 86_400}&firma=${firma}`).expect(403);

    // Un enlace emitido hace más de 30 minutos
    const viejo = new URL(urlFirmada(referencia, Math.floor(Date.now() / 1000) - TTL_ENLACE_SEGUNDOS - 60));
    const res = await request(app.getHttpServer()).get(viejo.pathname + viejo.search).expect(403);
    expect(res.body.message).toBe('El enlace no es válido o venció.');
  });

  it('no se puede pedir otro archivo ni salirse de la carpeta, ni abrir la ruta pública antigua', async () => {
    const enlace = new URL(urlFirmada(referencia));
    const query = enlace.search;
    for (const nombre of ['..%2F..%2Fpackage.json', '..%2F..%2F.env', 'a.webp', '%2e%2e%2f%2e%2e%2fpackage.json']) {
      const res = await request(app.getHttpServer()).get(`/archivos-privados/comprobantes-pago/${nombre}${query}`);
      expect([403, 404]).toContain(res.status);
    }
    const res = await request(app.getHttpServer()).get(`/archivos-privados/perfiles/${enlace.pathname.split('/').pop()}${query}`);
    expect(res.status).toBe(403);
    await request(app.getHttpServer()).get(ruta.replace('/archivos-privados/', '/uploads/')).expect(404);
  });

  it('una firma vale para ese archivo y no para otro, aunque exista', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#aa0000' } }).png().toBuffer();
    const otra = (await subir(png, 'otro.png', 'image/png')).body.comprobanteUrl as string;
    const mia = new URL(urlFirmada(referencia));
    const rutaOtra = `/archivos-privados/${leerReferencia(otra)!.carpeta}/${leerReferencia(otra)!.nombre}`;
    await request(app.getHttpServer()).get(rutaOtra + mia.search).expect(403);
  });

  it('en una venta de ventanilla solo se acepta un comprobante de nuestro almacenamiento', async () => {
    const res = await request(app.getHttpServer())
      .post('/coop/ventanilla/vender')
      .set('Authorization', `Bearer ${tokenCoop}`)
      .send({ comprobanteUrl: 'https://sitio-malicioso.example/falso.png' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toContain('El comprobante no es válido');
  });
});
