import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { VerificadorTokenSocialJwks } from './verificador-token-social';
import { TokenSocialInvalidoError } from '../../dominio/auth/auth.ports';

const CLIENT_ID = 'cliente-google-123.apps.googleusercontent.com';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const otraLlave = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'clave-1',
  alg: 'RS256',
  use: 'sig',
};

function b64url(valor: object | Buffer): string {
  const buf = Buffer.isBuffer(valor)
    ? valor
    : Buffer.from(JSON.stringify(valor));
  return buf.toString('base64url');
}

/** Arma un JWT RS256 firmado con la llave indicada. */
function firmar(
  reclamos: Record<string, unknown>,
  opciones: { llave?: typeof privateKey; kid?: string; alg?: string } = {},
): string {
  const cabecera = b64url({
    alg: opciones.alg ?? 'RS256',
    kid: opciones.kid ?? 'clave-1',
    typ: 'JWT',
  });
  const cuerpo = b64url(reclamos);
  const firma = createSign('RSA-SHA256')
    .update(`${cabecera}.${cuerpo}`)
    .sign(opciones.llave ?? privateKey);
  return `${cabecera}.${cuerpo}.${b64url(firma)}`;
}

const ahora = () => Math.floor(Date.now() / 1000);
const reclamosGoogle = (extra: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: 'google-sub-1',
  exp: ahora() + 3600,
  iat: ahora() - 10,
  email: 'Ana.Perez@Gmail.com',
  email_verified: true,
  name: 'Ana Pérez',
  picture: 'https://foto/x.png',
  ...extra,
});

describe('VerificadorTokenSocialJwks', () => {
  let verificador: VerificadorTokenSocialJwks;
  let peticiones: number;

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_IDS = `otro-cliente,${CLIENT_ID}`;
    process.env.APPLE_CLIENT_IDS = 'com.klumbus.app';
    verificador = new VerificadorTokenSocialJwks();
    peticiones = 0;
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      peticiones++;
      return Promise.resolve(
        new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }),
      );
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.GOOGLE_CLIENT_IDS;
    delete process.env.APPLE_CLIENT_IDS;
  });

  it('acepta un token válido de Google y devuelve la identidad (correo en minúsculas)', async () => {
    const identidad = await verificador.verificar(
      'google',
      firmar(reclamosGoogle()),
    );
    expect(identidad).toEqual({
      proveedorId: 'google-sub-1',
      correo: 'ana.perez@gmail.com',
      correoVerificado: true,
      nombre: 'Ana Pérez',
      fotoUrl: 'https://foto/x.png',
    });
  });

  it('guarda las claves del proveedor: dos verificaciones piden las claves una sola vez', async () => {
    await verificador.verificar('google', firmar(reclamosGoogle()));
    await verificador.verificar('google', firmar(reclamosGoogle()));
    expect(peticiones).toBe(1);
  });

  it('rechaza un token firmado con otra llave', async () => {
    const falso = firmar(reclamosGoogle(), { llave: otraLlave.privateKey });
    await expect(verificador.verificar('google', falso)).rejects.toThrow(
      TokenSocialInvalidoError,
    );
  });

  it('rechaza un token vencido, de otro emisor o para otra aplicación', async () => {
    await expect(
      verificador.verificar(
        'google',
        firmar(reclamosGoogle({ exp: ahora() - 600 })),
      ),
    ).rejects.toThrow('venció');
    await expect(
      verificador.verificar(
        'google',
        firmar(reclamosGoogle({ iss: 'https://evil.example' })),
      ),
    ).rejects.toThrow(TokenSocialInvalidoError);
    await expect(
      verificador.verificar(
        'google',
        firmar(reclamosGoogle({ aud: 'cliente-ajeno' })),
      ),
    ).rejects.toThrow('para esta aplicación');
  });

  it('rechaza algoritmos distintos de RS256 y claves desconocidas', async () => {
    await expect(
      verificador.verificar(
        'google',
        firmar(reclamosGoogle(), { alg: 'none' }),
      ),
    ).rejects.toThrow(TokenSocialInvalidoError);
    await expect(
      verificador.verificar(
        'google',
        firmar(reclamosGoogle(), { kid: 'no-existe' }),
      ),
    ).rejects.toThrow(TokenSocialInvalidoError);
    await expect(
      verificador.verificar('google', 'esto-no-es-un-jwt-valido-para-nada'),
    ).rejects.toThrow(TokenSocialInvalidoError);
  });

  it('exige que el nonce coincida, tal cual o como SHA-256 en hexadecimal (Apple)', async () => {
    const nonce = 'intento-123';
    const hash = createHash('sha256').update(nonce).digest('hex');
    await expect(
      verificador.verificar('google', firmar(reclamosGoogle({ nonce })), nonce),
    ).resolves.toBeDefined();
    await expect(
      verificador.verificar(
        'google',
        firmar(reclamosGoogle({ nonce: hash })),
        nonce,
      ),
    ).resolves.toBeDefined();
    await expect(
      verificador.verificar(
        'google',
        firmar(reclamosGoogle({ nonce: 'otro' })),
        nonce,
      ),
    ).rejects.toThrow('este intento');
  });

  it('Apple: acepta email_verified como texto "true" y el emisor de Apple', async () => {
    const token = firmar({
      iss: 'https://appleid.apple.com',
      aud: 'com.klumbus.app',
      sub: 'apple-sub-9',
      exp: ahora() + 3600,
      email: 'abc@privaterelay.appleid.com',
      email_verified: 'true',
    });
    const identidad = await verificador.verificar('apple', token);
    expect(identidad).toMatchObject({
      proveedorId: 'apple-sub-9',
      correoVerificado: true,
      nombre: null,
    });
  });

  it('un proveedor sin identificadores configurados queda apagado', async () => {
    delete process.env.APPLE_CLIENT_IDS;
    await expect(verificador.verificar('apple', 'a.b.c')).rejects.toMatchObject(
      { noConfigurado: true },
    );
  });
});
