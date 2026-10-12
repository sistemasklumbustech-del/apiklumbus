import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { aplicarSeguridadHttp, origenPermitido, origenesPermitidos } from './configuracion-http';

describe('CORS de la API', () => {
  const produccion = { NODE_ENV: 'production' };

  it('acepta el sitio web de Klumbus, con y sin www', () => {
    expect(origenPermitido('https://klumbustech.com', produccion)).toBe(true);
    expect(origenPermitido('https://www.klumbustech.com', produccion)).toBe(true);
  });

  it('rechaza cualquier otro origen, aunque se parezca', () => {
    for (const origen of [
      'https://sitio-malicioso.example',
      'https://klumbustech.com.evil.example',
      'https://evilklumbustech.com',
      'http://klumbustech.com',
      'null',
    ]) {
      expect(origenPermitido(origen, produccion)).toBe(false);
    }
  });

  it('deja pasar lo que no viene de un navegador (sin Origin): app móvil y API externa de cooperativas', () => {
    expect(origenPermitido(undefined, produccion)).toBe(true);
  });

  it('localhost solo se acepta fuera de producción', () => {
    expect(origenPermitido('http://localhost:3000', {})).toBe(true);
    expect(origenPermitido('http://127.0.0.1:3000', { NODE_ENV: 'development' })).toBe(true);
    expect(origenPermitido('http://localhost:3000', produccion)).toBe(false);
  });

  it('CORS_ORIGENES agrega orígenes sin tocar los de siempre', () => {
    const env = { NODE_ENV: 'production', CORS_ORIGENES: ' https://vista-previa.klumbustech.com/ , https://otro.example ' };
    expect(origenesPermitidos(env)).toEqual([
      'https://klumbustech.com',
      'https://www.klumbustech.com',
      'https://vista-previa.klumbustech.com',
      'https://otro.example',
    ]);
    expect(origenPermitido('https://vista-previa.klumbustech.com', env)).toBe(true);
  });
});

@Controller('prueba')
class PruebaController {
  @Get()
  obtener() {
    return { ok: true };
  }
}

describe('Cabeceras de seguridad y CORS de la API (con la configuración real)', () => {
  let app: NestExpressApplication;
  const entornoOriginal = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    const modulo = await Test.createTestingModule({ controllers: [PruebaController] }).compile();
    app = modulo.createNestApplication<NestExpressApplication>();
    aplicarSeguridadHttp(app);
    await app.init();
  });
  afterAll(async () => {
    process.env.NODE_ENV = entornoOriginal;
    await app.close();
  });

  it('envía las cabeceras de seguridad y no revela que es Express', async () => {
    const res = await request(app.getHttpServer()).get('/prueba').expect(200);
    expect(res.headers['strict-transport-security']).toBe('max-age=15552000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    // Imágenes de /uploads vistas desde el sitio web (otro origen).
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('con el sitio de Klumbus como origen, responde el permiso CORS con credenciales', async () => {
    const res = await request(app.getHttpServer()).get('/prueba').set('Origin', 'https://klumbustech.com').expect(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://klumbustech.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('con un origen ajeno NO responde el permiso CORS', async () => {
    const res = await request(app.getHttpServer())
      .get('/prueba')
      .set('Origin', 'https://sitio-malicioso.example')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('la pregunta previa (OPTIONS) de un origen ajeno tampoco recibe permiso', async () => {
    const res = await request(app.getHttpServer())
      .options('/prueba')
      .set('Origin', 'https://sitio-malicioso.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
