import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Request,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ComercialService } from '../../aplicacion/comercial/comercial.service';
import {
  CrearEspacioPublicitarioDto,
  CrearPlanComercialDto,
  ActualizarEstadoLeadDto,
  CrearCampanaDto,
} from './dto/comercial.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PayloadToken } from '../../dominio/auth/auth.ports';

/** RF-COMM -- gestion comercial/publicitaria. Hallazgo real
 * (25-ago-2026): solo admin_plataforma podia entrar, aunque
 * super_admin -- el nivel mas alto -- tambien deberia poder, mismo
 * patron ya usado en AdminController real. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_plataforma', 'super_admin')
@Controller('admin')
export class ComercialController {
  constructor(private readonly comercial: ComercialService) {}

  @Post('espacios-publicitarios')
  async crearEspacioPublicitario(@Body() dto: CrearEspacioPublicitarioDto) {
    return this.comercial.crearEspacioPublicitario(dto);
  }

  @Get('espacios-publicitarios')
  async listarEspaciosPublicitarios() {
    return this.comercial.listarEspaciosPublicitarios();
  }

  @Post('planes-comerciales')
  async crearPlanComercial(@Body() dto: CrearPlanComercialDto) {
    return this.comercial.crearPlanComercial(dto);
  }

  @Get('planes-comerciales')
  async listarPlanesComerciales() {
    return this.comercial.listarPlanesComerciales();
  }

  @Get('leads')
  async listarLeads() {
    return this.comercial.listarLeads();
  }

  @Patch('leads/:id')
  async actualizarEstadoLead(
    @Param('id') id: string,
    @Body() dto: ActualizarEstadoLeadDto,
  ) {
    await this.comercial.actualizarEstadoLead(id, dto);
    return { ok: true };
  }

  @Post('campanas')
  async crearCampana(@Body() dto: CrearCampanaDto) {
    return this.comercial.crearCampana(dto);
  }

  @Get('campanas')
  async listarCampanas() {
    return this.comercial.listarCampanas();
  }

  @Patch('campanas/:id/aprobar')
  async aprobarCampana(
    @Param('id') id: string,
    @Request() req: { user: PayloadToken },
  ) {
    const resultado = await this.comercial.aprobarCampana(id, req.user.sub);
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return resultado;
  }

  @Patch('campanas/:id/rechazar')
  async rechazarCampana(@Param('id') id: string) {
    const resultado = await this.comercial.rechazarCampana(id);
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return resultado;
  }

  @Get('campanas/:id/metricas')
  async obtenerMetricasCampana(@Param('id') id: string) {
    return this.comercial.obtenerMetricasCampana(id);
  }
}
