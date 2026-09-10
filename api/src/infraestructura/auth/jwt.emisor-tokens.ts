import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EmisorTokens, PayloadToken } from '../../dominio/auth/auth.ports';

/**
 * RF-AUTH-005 — expiración de sesión. El tiempo de expiración se
 * configura en JwtModule (ver auth.module.ts), no aquí, para que quede
 * en un solo lugar visible.
 */
@Injectable()
export class JwtEmisorTokens implements EmisorTokens {
  constructor(private readonly jwt: JwtService) {}

  firmar(payload: PayloadToken): string {
    return this.jwt.sign(payload);
  }
}
