import { Body, Controller, Get, Patch, Request, UseGuards } from '@nestjs/common';
import { WalletService } from '../../aplicacion/wallet/wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PayloadToken } from '../../dominio/auth/auth.ports';
import { ActualizarCashbackPorcentajeDto } from './dto/wallet.dto';

/**
 * Wallet / cashback, Fase 1 (13-ago-2026) -- ganar y consultar saldo.
 * Fuera de alcance a propósito en esta fase: gastar el saldo en una
 * compra (Fase 2) -- no hay ningún endpoint de "usar saldo" todavía.
 */
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  /** El pasajero ve su propio saldo -- nunca el de otro usuario. */
  @UseGuards(JwtAuthGuard)
  @Get('saldo')
  async saldo(@Request() req: { user: PayloadToken }) {
    return this.wallet.saldo(req.user.sub);
  }

  /** Hallazgo real del director (15-ago-2026) -- el pasajero solo veía
   * el número final, nunca de dónde salió. */
  @UseGuards(JwtAuthGuard)
  @Get('movimientos')
  async movimientos(@Request() req: { user: PayloadToken }) {
    return this.wallet.movimientos(req.user.sub);
  }

  /**
   * Configuración global -- mismo patrón exacto que
   * GET/PATCH /admin/cargo-plataforma (mismo nivel de acceso,
   * super_admin exclusivo, ver matriz sección 3.8 del documento
   * maestro). No estaba en la lista explícita de 4 tareas de esta
   * fase, pero sin esto el porcentaje nunca podría cambiar de 0 --
   * se construyó como extensión mínima y necesaria, reportada aquí.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Get('cashback-porcentaje')
  async obtenerCashbackPorcentaje() {
    return { porcentaje: await this.wallet.obtenerCashbackPorcentajeDefault() };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Patch('cashback-porcentaje')
  async actualizarCashbackPorcentaje(
    @Body() dto: ActualizarCashbackPorcentajeDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.wallet.actualizarCashbackPorcentajeDefault(dto.porcentaje, req.user.sub);
    return { ok: true };
  }
}
