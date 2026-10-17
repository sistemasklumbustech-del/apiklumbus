import { Injectable } from '@nestjs/common';
import {
  createHash,
  createPublicKey,
  verify,
  type JsonWebKey,
} from 'node:crypto';
import {
  TokenSocialInvalidoError,
  type IdentidadExterna,
  type ProveedorSocial,
  type VerificadorTokenSocial,
} from '../../dominio/auth/auth.ports';

interface ConfiguracionProveedor {
  urlClaves: string;
  emisores: string[];
  /** Variable de entorno con los identificadores de cliente aceptados, separados por comas. */
  variableAudiencias: string;
}

const PROVEEDORES: Record<ProveedorSocial, ConfiguracionProveedor> = {
  google: {
    urlClaves: 'https://www.googleapis.com/oauth2/v3/certs',
    emisores: ['https://accounts.google.com', 'accounts.google.com'],
    variableAudiencias: 'GOOGLE_CLIENT_IDS',
  },
  apple: {
    urlClaves: 'https://appleid.apple.com/auth/keys',
    emisores: ['https://appleid.apple.com'],
    variableAudiencias: 'APPLE_CLIENT_IDS',
  },
};

/** Cuánto se guardan las claves públicas del proveedor antes de volver a pedirlas. */
const VIGENCIA_CLAVES_MS = 60 * 60 * 1000;
/** Tolerancia de reloj entre este servidor y el del proveedor. */
const TOLERANCIA_SEGUNDOS = 60;

function decodificarBase64Url(texto: string): Buffer {
  return Buffer.from(texto.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function leerJson<T>(texto: string): T {
  return JSON.parse(decodificarBase64Url(texto).toString('utf8')) as T;
}

interface ClaveWeb extends JsonWebKey {
  kid?: string;
}

interface Reclamos {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
}

/**
 * Verifica los tokens de identidad (JWT RS256) de Google y Apple con sus claves públicas, sin
 * librerías de terceros: firma, emisor, destinatario (nuestros identificadores de cliente),
 * vencimiento y, si se pide, el nonce. Un proveedor sin identificadores configurados en el entorno
 * queda apagado (`noConfigurado`), así que publicar este código no activa nada por sí solo.
 */
@Injectable()
export class VerificadorTokenSocialJwks implements VerificadorTokenSocial {
  private readonly claves = new Map<
    ProveedorSocial,
    { obtenidas: number; lista: ClaveWeb[] }
  >();

  async verificar(
    proveedor: ProveedorSocial,
    idToken: string,
    nonce?: string,
  ): Promise<IdentidadExterna> {
    const config = PROVEEDORES[proveedor];
    const audiencias = (process.env[config.variableAudiencias] ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    if (audiencias.length === 0) {
      throw new TokenSocialInvalidoError(
        `El inicio de sesión con ${proveedor === 'google' ? 'Google' : 'Apple'} todavía no está disponible.`,
        true,
      );
    }

    const partes = idToken.split('.');
    if (partes.length !== 3)
      throw new TokenSocialInvalidoError('El token no es válido.');
    let cabecera: { alg?: string; kid?: string };
    let reclamos: Reclamos;
    try {
      cabecera = leerJson(partes[0]);
      reclamos = leerJson(partes[1]);
    } catch {
      throw new TokenSocialInvalidoError('El token no es válido.');
    }
    if (cabecera.alg !== 'RS256' || !cabecera.kid)
      throw new TokenSocialInvalidoError('El token no es válido.');

    const clave = await this.buscarClave(proveedor, cabecera.kid);
    if (!clave) throw new TokenSocialInvalidoError('El token no es válido.');
    const firmaValida = verify(
      'RSA-SHA256',
      Buffer.from(`${partes[0]}.${partes[1]}`),
      createPublicKey({ key: clave, format: 'jwk' }),
      decodificarBase64Url(partes[2]),
    );
    if (!firmaValida)
      throw new TokenSocialInvalidoError('El token no es válido.');

    const ahora = Math.floor(Date.now() / 1000);
    if (!reclamos.iss || !config.emisores.includes(reclamos.iss)) {
      throw new TokenSocialInvalidoError('El token no es válido.');
    }
    const destinatarios = Array.isArray(reclamos.aud)
      ? reclamos.aud
      : [reclamos.aud];
    if (!destinatarios.some((a) => a && audiencias.includes(a))) {
      throw new TokenSocialInvalidoError(
        'El token no es para esta aplicación.',
      );
    }
    if (
      typeof reclamos.exp !== 'number' ||
      reclamos.exp + TOLERANCIA_SEGUNDOS < ahora
    ) {
      throw new TokenSocialInvalidoError('El token venció. Intenta de nuevo.');
    }
    if (
      typeof reclamos.iat === 'number' &&
      reclamos.iat - TOLERANCIA_SEGUNDOS > ahora
    ) {
      throw new TokenSocialInvalidoError('El token no es válido.');
    }
    if (!reclamos.sub)
      throw new TokenSocialInvalidoError('El token no es válido.');
    if (nonce) {
      const hash = createHash('sha256').update(nonce).digest('hex');
      if (reclamos.nonce !== nonce && reclamos.nonce !== hash) {
        throw new TokenSocialInvalidoError(
          'El token no corresponde a este intento de ingreso.',
        );
      }
    }

    return {
      proveedorId: reclamos.sub,
      correo: reclamos.email ? reclamos.email.trim().toLowerCase() : null,
      correoVerificado:
        reclamos.email_verified === true || reclamos.email_verified === 'true',
      nombre: reclamos.name?.trim() || null,
      fotoUrl: reclamos.picture ?? null,
    };
  }

  /** Busca la clave por `kid`; si no está (el proveedor las rota), vuelve a pedirlas una vez. */
  private async buscarClave(
    proveedor: ProveedorSocial,
    kid: string,
  ): Promise<ClaveWeb | undefined> {
    const guardadas = this.claves.get(proveedor);
    if (guardadas && Date.now() - guardadas.obtenidas < VIGENCIA_CLAVES_MS) {
      const encontrada = guardadas.lista.find((k) => k.kid === kid);
      if (encontrada) return encontrada;
    }
    const respuesta = await fetch(PROVEEDORES[proveedor].urlClaves, {
      signal: AbortSignal.timeout(8000),
    });
    if (!respuesta.ok)
      throw new TokenSocialInvalidoError(
        'No se pudo verificar tu identidad. Intenta de nuevo.',
      );
    const { keys } = (await respuesta.json()) as { keys: ClaveWeb[] };
    this.claves.set(proveedor, { obtenidas: Date.now(), lista: keys });
    return keys.find((k) => k.kid === kid);
  }
}
