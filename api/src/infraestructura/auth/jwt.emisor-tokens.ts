import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EmisorTokens, PayloadToken } from '../../dominio/auth/auth.ports';

/**
 * RF-AUTH-005 — expiración de sesión. El valor por defecto (60m para
 * pasajeros) se configura en JwtModule (ver auth.module.ts).
 *
 * Personal de cooperativa y administradores (21-sep-2026): un turno
 * administrativo dura ~8 horas, y con 60 minutos la sesión vencía a
 * mitad de una venta en ventanilla o de una edición. Ese personal
 * recibe un token de 8h (configurable con SESION_PERSONAL_DURACION,
 * ej. "10h"); el pasajero mantiene los 60 minutos originales. Los
 * roles administrativos siguen protegidos con 2FA obligatorio en el
 * login.
 */
const ROLES_PERSONAL: PayloadToken['rol'][] = [
  'vendedor',
  'admin_cooperativa',
  'admin_plataforma',
  'super_admin',
];

@Injectable()
export class JwtEmisorTokens implements EmisorTokens {
  constructor(private readonly jwt: JwtService) {}

  firmar(payload: PayloadToken): string {
    if (ROLES_PERSONAL.includes(payload.rol)) {
      return this.jwt.sign(payload, {
        expiresIn: (process.env.SESION_PERSONAL_DURACION ?? '8h') as `${number}h`,
      });
    }
    return this.jwt.sign(payload);
  }
}
