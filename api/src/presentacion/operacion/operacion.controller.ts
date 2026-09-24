import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { OperacionService } from '../../aplicacion/operacion/operacion.service';
import {
  ConsultarViajesOperacionDto,
  FiltrosOperacionDto,
  OpcionesRutasDto,
} from './dto/operacion.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

function aFiltros(dto: FiltrosOperacionDto) {
  return {
    desde: dto.desde,
    hasta: dto.hasta,
    cooperativaId: dto.cooperativaId,
    rutaId: dto.rutaId,
    estado: dto.estado,
  };
}

/**
 * Panel operativo de la plataforma (RF-022) -- solo lectura, solo para los
 * administradores de plataforma. Toda la operación de todas las
 * cooperativas: resumen del período, viajes, rutas destacadas y alertas.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_plataforma', 'super_admin')
@Controller('admin/operacion')
export class OperacionController {
  constructor(private readonly operacion: OperacionService) {}

  @Get('resumen')
  async resumen(@Query() dto: FiltrosOperacionDto) {
    return this.operacion.resumen(aFiltros(dto));
  }

  @Get('viajes')
  async viajes(@Query() dto: ConsultarViajesOperacionDto) {
    return this.operacion.listarViajes({
      ...aFiltros(dto),
      pagina: dto.pagina ?? 1,
      limite: dto.limite ?? 25,
    });
  }

  @Get('rutas')
  async rutas(@Query() dto: FiltrosOperacionDto) {
    return this.operacion.rutasDestacadas(aFiltros(dto));
  }

  /** Alertas del momento (no dependen del rango de fechas elegido). */
  @Get('alertas')
  async alertas() {
    return this.operacion.alertas();
  }

  @Get('opciones-rutas')
  async opcionesRutas(@Query() dto: OpcionesRutasDto) {
    return this.operacion.opcionesRutas(dto.cooperativaId);
  }

  @Get('exportar')
  async exportar(@Query() dto: FiltrosOperacionDto, @Res() res: Response) {
    const csv = await this.operacion.exportarCsv(aFiltros(dto));
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="operacion-viajes.csv"',
    });
    res.send(csv);
  }
}
