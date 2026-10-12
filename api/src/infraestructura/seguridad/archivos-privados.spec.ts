import {
  REFERENCIA_PRIVADA_VALIDA,
  aUrlVisible,
  crearReferencia,
  esReferenciaPrivada,
  leerReferencia,
  nombreDeArchivoPrivadoValido,
  urlFirmada,
  verificarEnlace,
} from './archivos-privados';

const NOMBRE = '3f2b8c1e-5a47-4d0e-9b36-1c2d3e4f5a6b.webp';
const REFERENCIA = crearReferencia('comprobantes-pago', NOMBRE);

function partesDe(url: string) {
  const u = new URL(url);
  const [, , carpeta, nombre] = u.pathname.split('/');
  return { carpeta, nombre, vence: u.searchParams.get('vence') ?? undefined, firma: u.searchParams.get('firma') ?? undefined };
}

describe('archivos privados con enlace firmado', () => {
  const secretoOriginal = process.env.JWT_SECRET;
  beforeEach(() => {
    process.env.JWT_SECRET = 'secreto-de-prueba-largo-para-firmar-enlaces-1234567890';
    delete process.env.URL_API_PUBLICA;
  });
  afterAll(() => {
    process.env.JWT_SECRET = secretoOriginal;
  });

  it('una referencia privada no es una URL: no sirve para abrir nada', () => {
    expect(REFERENCIA).toBe(`privado://comprobantes-pago/${NOMBRE}`);
    expect(esReferenciaPrivada(REFERENCIA)).toBe(true);
    expect(esReferenciaPrivada('https://api.klumbus.tech/uploads/comprobantes-pago/x.webp')).toBe(false);
  });

  it('el enlace firmado funciona hasta que vence', () => {
    const ahora = 1_800_000_000;
    const p = partesDe(urlFirmada(REFERENCIA, ahora));
    expect(verificarEnlace(p.carpeta, p.nombre, p.vence, p.firma, ahora + 60)).toBe('valido');
    expect(verificarEnlace(p.carpeta, p.nombre, p.vence, p.firma, ahora + 1800)).toBe('valido');
    expect(verificarEnlace(p.carpeta, p.nombre, p.vence, p.firma, ahora + 1801)).toBe('vencido');
  });

  it('rechaza un enlace alterado: otra fecha de vencimiento, otro archivo o una firma inventada', () => {
    const ahora = 1_800_000_000;
    const p = partesDe(urlFirmada(REFERENCIA, ahora));
    // Alargar el plazo a mano
    expect(verificarEnlace(p.carpeta, p.nombre, String(Number(p.vence) + 86_400), p.firma, ahora)).toBe('invalido');
    // Usar la firma de un archivo para otro
    const otro = '11111111-2222-4333-8444-555555555555.webp';
    expect(verificarEnlace(p.carpeta, otro, p.vence, p.firma, ahora)).toBe('invalido');
    // Sin firma, con firma vacía o inventada
    expect(verificarEnlace(p.carpeta, p.nombre, p.vence, undefined, ahora)).toBe('invalido');
    expect(verificarEnlace(p.carpeta, p.nombre, p.vence, '', ahora)).toBe('invalido');
    expect(verificarEnlace(p.carpeta, p.nombre, p.vence, 'a'.repeat(64), ahora)).toBe('invalido');
  });

  it('con otro secreto el enlace deja de valer', () => {
    const ahora = 1_800_000_000;
    const p = partesDe(urlFirmada(REFERENCIA, ahora));
    process.env.JWT_SECRET = 'otro-secreto-distinto-1234567890-abcdefghij';
    expect(verificarEnlace(p.carpeta, p.nombre, p.vence, p.firma, ahora)).toBe('invalido');
  });

  it('no deja salirse de la carpeta ni pedir cualquier nombre', () => {
    for (const [carpeta, nombre] of [
      ['comprobantes-pago', '../../.env'],
      ['comprobantes-pago', '..%2F..%2Fpackage.json'],
      ['comprobantes-pago', 'a.webp'],
      ['comprobantes-pago', `${NOMBRE}.exe`],
      ['..', NOMBRE],
      ['perfiles', NOMBRE],
    ]) {
      expect(nombreDeArchivoPrivadoValido(carpeta, nombre)).toBe(false);
      expect(verificarEnlace(carpeta, nombre, '1900000000', 'f'.repeat(64), 1)).toBe('invalido');
    }
  });

  it('la referencia que el cliente manda de vuelta debe tener exactamente la forma esperada', () => {
    expect(REFERENCIA_PRIVADA_VALIDA.test(REFERENCIA)).toBe(true);
    for (const mala of [
      'https://sitio-malicioso.example/comprobante.png',
      'privado://comprobantes-pago/../../etc/passwd',
      'privado://perfiles/' + NOMBRE,
      `privado://comprobantes-pago/${NOMBRE}?x=1`,
      '',
    ]) {
      expect(REFERENCIA_PRIVADA_VALIDA.test(mala)).toBe(false);
      expect(leerReferencia(mala)).toBeNull();
    }
  });

  it('aUrlVisible firma lo privado, deja pasar una URL de antes y tolera vacíos', () => {
    expect(aUrlVisible(REFERENCIA)).toMatch(/^https:\/\/api\.klumbus\.tech\/archivos-privados\/comprobantes-pago\/.+\?vence=\d+&firma=[0-9a-f]{64}$/);
    expect(aUrlVisible('https://api.klumbus.tech/uploads/comprobantes-pago/viejo.webp')).toBe(
      'https://api.klumbus.tech/uploads/comprobantes-pago/viejo.webp',
    );
    expect(aUrlVisible(null)).toBeNull();
    expect(aUrlVisible('')).toBeNull();
    expect(aUrlVisible('privado://basura')).toBeNull(); // referencia dañada: no rompe el listado
  });

  it('la dirección base se puede cambiar por variable de entorno', () => {
    process.env.URL_API_PUBLICA = 'http://localhost:3001/';
    expect(urlFirmada(REFERENCIA)).toMatch(/^http:\/\/localhost:3001\/archivos-privados\//);
  });
});
