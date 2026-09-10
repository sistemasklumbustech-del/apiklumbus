import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { CifradorTotp } from '../../dominio/auth/auth.ports';

/**
 * Ítem 19, Fase 3 (05-ago-2026) -- cifrado del secreto TOTP.
 *
 * A diferencia de una contraseña (que se hashea, un solo sentido,
 * nunca se necesita leer de vuelta), el secreto TOTP tiene que poder
 * descifrarse: para verificar el código de 6 dígitos que el admin
 * ingresa, el servidor necesita el secreto real para calcular el
 * código esperado y compararlo -- un hash de un solo sentido no sirve
 * para esto. Por eso AES-256-GCM (cifrado reversible, autenticado),
 * no bcrypt -- mismo criterio de "la capa de infra decide el
 * algoritmo" que ya usa BcryptHasher para contraseñas.
 *
 * Requiere la variable de entorno TOTP_CIFRADO_CLAVE -- sin ella, 2FA
 * no puede funcionar. Debe configurarse antes de desplegar a producción
 * real (ver documento maestro, sección de requerimientos no
 * funcionales -- despliegue real pendiente).
 */
const ALGORITMO = 'aes-256-gcm';

@Injectable()
export class CifradorTotpAesGcm implements CifradorTotp {
  private obtenerClave(): Buffer {
    const secreto = process.env.TOTP_CIFRADO_CLAVE;
    if (!secreto) {
      throw new Error(
        'Falta configurar la variable de entorno TOTP_CIFRADO_CLAVE -- 2FA no puede funcionar sin ella.',
      );
    }
    // Deriva una clave de 32 bytes reales a partir del valor
    // configurado, sin importar su longitud original. Sal fija
    // aceptable aquí porque esto NO es una contraseña de usuario -- es
    // un secreto de aplicación que ya se espera de alta entropía (una
    // variable de entorno larga y aleatoria), no algo que un atacante
    // pueda intentar adivinar por diccionario como sí pasaría con
    // contraseñas reales de personas.
    return scryptSync(secreto, 'ticketya-totp-salt-fijo', 32);
  }

  cifrar(textoPlano: string): string {
    const clave = this.obtenerClave();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITMO, clave, iv);
    const cifrado = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // iv + authTag + cifrado, todo junto en un solo valor base64 -- los
    // 3 hacen falta para descifrar, separarlos en columnas distintas
    // sería más frágil sin ganar nada real.
    return Buffer.concat([iv, authTag, cifrado]).toString('base64');
  }

  descifrar(textoCifrado: string): string {
    const clave = this.obtenerClave();
    const buffer = Buffer.from(textoCifrado, 'base64');
    const iv = buffer.subarray(0, 12);
    const authTag = buffer.subarray(12, 28);
    const cifrado = buffer.subarray(28);
    const decipher = createDecipheriv(ALGORITMO, clave, iv);
    decipher.setAuthTag(authTag);
    const descifrado = Buffer.concat([decipher.update(cifrado), decipher.final()]);
    return descifrado.toString('utf8');
  }
}
