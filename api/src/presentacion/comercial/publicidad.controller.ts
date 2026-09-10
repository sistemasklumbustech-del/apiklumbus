import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ComercialService } from '../../aplicacion/comercial/comercial.service';
import { CrearLeadDto, ListarActivasDto } from './dto/comercial.dto';

/** Endpoints publicos, sin login -- captacion de leads y publicidad en vivo de la landing. */
@Controller('publicidad')
export class PublicidadController {
  constructor(private readonly comercial: ComercialService) {}

  @Post('leads')
  async crearLead(@Body() dto: CrearLeadDto) {
    return this.comercial.crearLead(dto);
  }

  /** RF-COMM-005 -- campanas activas y vigentes hoy, para un espacio/ubicacion. */
  @Get('activas')
  async listarActivas(@Query() query: ListarActivasDto) {
    return this.comercial.listarCampanasActivas(query.ubicacion);
  }

  @Post(':campanaId/impresion')
  async registrarImpresion(@Param('campanaId') campanaId: string) {
    await this.comercial.registrarImpresion(campanaId);
    return { ok: true };
  }

  @Post(':campanaId/clic')
  async registrarClic(@Param('campanaId') campanaId: string) {
    await this.comercial.registrarClic(campanaId);
    return { ok: true };
  }
}
