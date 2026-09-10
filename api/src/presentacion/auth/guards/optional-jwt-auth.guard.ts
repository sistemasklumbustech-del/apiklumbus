import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Item 31, Fase 7 (11-ago-2026) -- compra como invitado (sin cuenta).
 * A diferencia de JwtAuthGuard, este NUNCA bloquea la peticion: si hay
 * un token valido, req.user queda poblado igual que siempre; si no hay
 * token (o es invalido), la peticion sigue adelante con req.user en
 * null, en vez de lanzar 401. La decision de si el usuario es
 * obligatorio o no queda en el propio endpoint, no en el guard.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(err: unknown, user: unknown): TUser {
    return (user ?? null) as TUser;
  }
}
