import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuditoriaService } from '../../aplicacion/auditoria/auditoria.service';
import { ConsultarAuditoriaDto } from './dto/auditoria.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

/**
 * Auditoría de la plataforma (RF-021) -- solo lectura, solo para los
 * administradores de plataforma. Ver quién hizo qué, desde qué IP, con qué
 * resultado, y qué hizo el propio sistema.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_plataforma', 'super_admin')
@Controller('admin/auditoria')
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Get()
  async listar(@Query() dto: ConsultarAuditoriaDto) {
    return this.auditoria.listar({
      accion: dto.accion,
      origen: dto.origen,
      resultado: dto.resultado,
      busqueda: dto.busqueda,
      ip: dto.ip,
      desde: dto.desde,
      hasta: dto.hasta,
      pagina: dto.pagina ?? 1,
      limite: dto.limite ?? 50,
    });
  }

  @Get('acciones')
  async acciones() {
    return this.auditoria.listarAcciones();
  }

  @Get('exportar')
  async exportar(@Query() dto: ConsultarAuditoriaDto, @Res() res: Response) {
    const csv = await this.auditoria.exportarCsv({
      accion: dto.accion,
      origen: dto.origen,
      resultado: dto.resultado,
      busqueda: dto.busqueda,
      ip: dto.ip,
      desde: dto.desde,
      hasta: dto.hasta,
    });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="auditoria.csv"',
    });
    res.send(csv);
  }
}
