import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { HasherContrasena } from '../../dominio/auth/auth.ports';

/**
 * RNF-SEG-002 — contraseñas con hash + sal (bcrypt), nunca en texto
 * plano ni cifrado reversible.
 *
 * Se usa `bcryptjs` (implementación 100% JavaScript) en vez de `bcrypt`
 * (que depende de un binario nativo compilado) a propósito: `bcrypt`
 * requiere herramientas de compilación de C++ instaladas (Visual Studio
 * Build Tools en Windows) solo para poder correr `npm install`, lo cual
 * es un obstáculo real para un equipo que recién está empezando en
 * Windows. `bcryptjs` es algo más lento en cómputo puro, pero
 * imperceptible para el volumen de logins de este proyecto, y elimina
 * ese punto de fricción por completo.
 */
@Injectable()
export class BcryptHasher implements HasherContrasena {
  private readonly rondas = 12;

  async hash(passwordPlano: string): Promise<string> {
    return bcrypt.hash(passwordPlano, this.rondas);
  }

  async comparar(passwordPlano: string, hash: string): Promise<boolean> {
    return bcrypt.compare(passwordPlano, hash);
  }
}
