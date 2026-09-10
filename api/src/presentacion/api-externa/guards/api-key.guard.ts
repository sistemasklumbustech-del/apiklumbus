import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExternaService } from '../../../aplicacion/api-externa/api-externa.service';

interface PeticionConCooperativa {
  headers: Record<string, string | undefined>;
  cooperativaId?: string;
}

/**
 * Autenticación por llave API (Modelo B) -- distinta del JwtAuthGuard
 * usado en el resto del panel. El sistema propio de la cooperativa
 * manda `Authorization: Bearer tkya_live_<prefijo>.<secreto>`. El
 * prefijo hace el lookup rápido; el secreto se verifica contra el
 * hash guardado (bcrypt, nunca en texto plano). Si es válida, se
 * adjunta `cooperativaId` a la petición para que el controller no
 * tenga que volver a resolverlo.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly service: ApiExternaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PeticionConCooperativa>();
    const encabezado = req.headers['authorization'];

    if (!encabezado?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Falta la llave API en el header Authorization.');
    }

    const llaveCompleta = encabezado.slice('Bearer '.length).trim();
    const separador = llaveCompleta.indexOf('.');
    if (separador === -1) {
      throw new UnauthorizedException('Formato de llave API inválido.');
    }

    const apiKeyPrefix = llaveCompleta.slice(0, separador);
    const secreto = llaveCompleta.slice(separador + 1);

    const resultado = await this.service.validarCredencial(apiKeyPrefix, secreto);
    if (!resultado) {
      throw new UnauthorizedException('Llave API inválida o revocada.');
    }

    req.cooperativaId = resultado.cooperativaId;
    return true;
  }
}
