import {
  CONTEXTO_DOCUMENTO_DISCAPACIDAD,
  CONTEXTO_NUMERO_CUENTA_COBRO,
  cifrarDato,
  cifrarDatoOpcional,
  descifrarDato,
  descifrarDatoOpcional,
  estaCifrado,
} from './datos-sensibles';

describe('cifrado de datos sensibles', () => {
  const claveOriginal = process.env.TOTP_CIFRADO_CLAVE;
  beforeEach(() => {
    process.env.TOTP_CIFRADO_CLAVE = 'clave-de-prueba-larga-para-el-cifrado-1234567890';
  });
  afterAll(() => {
    process.env.TOTP_CIFRADO_CLAVE = claveOriginal;
  });

  it('cifra y descifra de ida y vuelta, incluso con tildes y símbolos', () => {
    for (const texto of ['2201234567', 'CONADIS-123456', 'Ñandú ✓ 0991-123']) {
      const cifrado = cifrarDato(texto, CONTEXTO_NUMERO_CUENTA_COBRO);
      expect(cifrado).not.toContain(texto);
      expect(descifrarDato(cifrado, CONTEXTO_NUMERO_CUENTA_COBRO)).toBe(texto);
    }
  });

  it('el valor guardado lleva el prefijo de versión, y el mismo texto cifrado dos veces da resultados distintos', () => {
    const a = cifrarDato('2201234567', CONTEXTO_NUMERO_CUENTA_COBRO);
    const b = cifrarDato('2201234567', CONTEXTO_NUMERO_CUENTA_COBRO);
    expect(a.startsWith('enc:v1:')).toBe(true);
    expect(estaCifrado(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('no cifra dos veces un valor que ya está cifrado', () => {
    const una = cifrarDato('2201234567', CONTEXTO_NUMERO_CUENTA_COBRO);
    expect(cifrarDato(una, CONTEXTO_NUMERO_CUENTA_COBRO)).toBe(una);
  });

  it('un dato guardado antes del cifrado (sin prefijo) se lee tal cual', () => {
    expect(descifrarDato('2201234567', CONTEXTO_NUMERO_CUENTA_COBRO)).toBe('2201234567');
  });

  it('un valor cifrado para una columna no se puede usar en otra', () => {
    const cifrado = cifrarDato('2201234567', CONTEXTO_NUMERO_CUENTA_COBRO);
    expect(() => descifrarDato(cifrado, CONTEXTO_DOCUMENTO_DISCAPACIDAD)).toThrow();
  });

  it('un valor alterado se rechaza en vez de devolver basura', () => {
    const cifrado = cifrarDato('2201234567', CONTEXTO_NUMERO_CUENTA_COBRO);
    const bytes = Buffer.from(cifrado.slice('enc:v1:'.length), 'base64');
    bytes[bytes.length - 1] ^= 0xff;
    const alterado = 'enc:v1:' + bytes.toString('base64');
    expect(() => descifrarDato(alterado, CONTEXTO_NUMERO_CUENTA_COBRO)).toThrow();
  });

  it('con otra clave maestra no se puede descifrar', () => {
    const cifrado = cifrarDato('2201234567', CONTEXTO_NUMERO_CUENTA_COBRO);
    process.env.TOTP_CIFRADO_CLAVE = 'otra-clave-distinta-1234567890-abcdefghij';
    expect(() => descifrarDato(cifrado, CONTEXTO_NUMERO_CUENTA_COBRO)).toThrow();
  });

  it('sin la variable de entorno falla con un mensaje claro', () => {
    delete process.env.TOTP_CIFRADO_CLAVE;
    expect(() => cifrarDato('x', CONTEXTO_NUMERO_CUENTA_COBRO)).toThrow(/TOTP_CIFRADO_CLAVE/);
  });

  it('las versiones opcionales dejan pasar null y vacío', () => {
    expect(cifrarDatoOpcional(null, CONTEXTO_DOCUMENTO_DISCAPACIDAD)).toBeNull();
    expect(cifrarDatoOpcional(undefined, CONTEXTO_DOCUMENTO_DISCAPACIDAD)).toBeNull();
    expect(descifrarDatoOpcional(null, CONTEXTO_DOCUMENTO_DISCAPACIDAD)).toBeNull();
    const cifrado = cifrarDatoOpcional('CONADIS-1', CONTEXTO_DOCUMENTO_DISCAPACIDAD) as string;
    expect(descifrarDatoOpcional(cifrado, CONTEXTO_DOCUMENTO_DISCAPACIDAD)).toBe('CONADIS-1');
  });
});
