import { Body, Controller, Get, Post, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { LiquidacionesService } from '../../aplicacion/liquidaciones/liquidaciones.service';
import {
  GenerarLiquidacionDto,
  ConsultarLiquidacionesDto,
} from './dto/liquidaciones.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

/**
 * Liquidaciones a cooperativas — RF-ADMIN-003. Exclusivo del admin de
 * plataforma. Hallazgo real (25-ago-2026): solo admin_plataforma
 * podia entrar, aunque super_admin -- el nivel mas alto -- tambien
 * deberia poder, mismo patron ya usado en AdminController real.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_plataforma', 'super_admin')
@Controller('admin/liquidaciones')
export class LiquidacionesController {
  constructor(private readonly liquidaciones: LiquidacionesService) {}

  @Post()
  async generar(@Body() dto: GenerarLiquidacionDto) {
    return this.liquidaciones.generar(
      dto.cooperativaId,
      dto.periodoInicio,
      dto.periodoFin,
    );
  }

  @Get()
  async listar(@Query() dto: ConsultarLiquidacionesDto) {
    return this.liquidaciones.listar({
      cooperativaId: dto.cooperativaId,
      estado: dto.estado,
      desde: dto.desde,
      hasta: dto.hasta,
      pagina: dto.pagina ?? 1,
      limite: dto.limite ?? 25,
    });
  }

  @Patch(':id/pagar')
  async marcarPagada(@Param('id') id: string) {
    return this.liquidaciones.marcarPagada(id);
  }
}
