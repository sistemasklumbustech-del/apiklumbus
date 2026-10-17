import {
  Body,
  Controller,
  HttpCode,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { NotificacionesPushService } from '../../aplicacion/notificaciones-push/notificaciones-push.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PayloadToken } from '../../dominio/auth/auth.ports';
import {
  BajaDispositivoDto,
  RegistrarDispositivoDto,
} from './dto/notificaciones-push.dto';

/**
 * Registro del teléfono para los avisos push de la app (oct-2026). Solo para personas con sesión
 * iniciada: la app registra el token al iniciar sesión y lo da de baja al cerrarla.
 */
@Controller('notificaciones-push')
@UseGuards(JwtAuthGuard)
export class NotificacionesPushController {
  constructor(private readonly push: NotificacionesPushService) {}

  @Post('dispositivos')
  @HttpCode(200)
  async registrar(
    @Body() dto: RegistrarDispositivoDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.push.registrarDispositivo(
      req.user.sub,
      dto.token,
      dto.plataforma,
    );
    return { ok: true };
  }

  @Post('dispositivos/baja')
  @HttpCode(200)
  async darDeBaja(
    @Body() dto: BajaDispositivoDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.push.eliminarDispositivo(req.user.sub, dto.token);
    return { ok: true };
  }
}
