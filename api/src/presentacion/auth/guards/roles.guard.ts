import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PayloadToken } from '../../../dominio/auth/auth.ports';

export const ROLES_KEY = 'roles';

/**
 * RF-AUTH-004 — decorador para marcar qué roles pueden acceder a un
 * endpoint. Uso: @Roles('admin_cooperativa', 'admin_plataforma').
 */
export const Roles = (...roles: PayloadToken['rol'][]) =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Debe usarse SIEMPRE después de JwtAuthGuard (que es quien pobla
 * request.user) — nunca solo. Un endpoint con @Roles() pero sin
 * JwtAuthGuard no está protegido de verdad.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rolesRequeridos = this.reflector.getAllAndOverride<
      PayloadToken['rol'][]
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!rolesRequeridos || rolesRequeridos.length === 0) {
      return true; // Sin @Roles() explícito, solo exige estar logueado.
    }
    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: PayloadToken }>();
    return !!user && rolesRequeridos.includes(user.rol);
  }
}
