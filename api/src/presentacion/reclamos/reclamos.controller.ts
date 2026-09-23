import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ReclamosService } from '../../aplicacion/reclamos/reclamos.service';
import {
  ConsultarMisReclamosDto,
  ConsultarReclamosCoopDto,
  CrearReclamoDto,
  ResolverReclamoDto,
} from './dto/reclamos.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PayloadToken } from '../../dominio/auth/auth.ports';

/** Lado del pasajero: crear un reclamo sobre un boleto suyo y ver sus reclamos. */
@UseGuards(JwtAuthGuard)
@Controller('reclamos')
export class ReclamosController {
  constructor(private readonly reclamos: ReclamosService) {}

  @Post()
  async crear(
    @Body() dto: CrearReclamoDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.reclamos.crear(req.user.sub, dto);
  }

  @Get('mios')
  async mios(
    @Query() dto: ConsultarMisReclamosDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.reclamos.listarDePasajero(req.user.sub, {
      estado: dto.estado,
      pagina: dto.pagina ?? 1,
      limite: dto.limite ?? 25,
    });
  }
}

/**
 * La cooperativa sale SIEMPRE de su token firmado (mismo criterio que el
 * panel de empresa): un admin_cooperativa no puede operar sobre los
 * reclamos de otra cooperativa aunque lo intente.
 */
function cooperativaDelToken(user: PayloadToken): string {
  if (!user.cooperativaId) {
    throw new ForbiddenException(
      'Este usuario no pertenece a ninguna cooperativa.',
    );
  }
  return user.cooperativaId;
}

/** Lado de la cooperativa: bandeja de reclamos, tomarlos y resolverlos. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_cooperativa')
@Controller('coop/reclamos')
export class ReclamosCoopController {
  constructor(private readonly reclamos: ReclamosService) {}

  @Get()
  async listar(
    @Query() dto: ConsultarReclamosCoopDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.reclamos.listarDeCooperativa(cooperativaDelToken(req.user), {
      estado: dto.estado,
      tipo: dto.tipo,
      busqueda: dto.busqueda,
      desde: dto.desde,
      hasta: dto.hasta,
      pagina: dto.pagina ?? 1,
      limite: dto.limite ?? 25,
    });
  }

  @Get('resumen')
  async resumen(@Request() req: { user: PayloadToken }) {
    return this.reclamos.resumenDeCooperativa(cooperativaDelToken(req.user));
  }

  @Patch(':id/en-revision')
  async tomar(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: PayloadToken },
  ) {
    return this.reclamos.tomar(cooperativaDelToken(req.user), id, req.user.sub);
  }

  @Patch(':id/resolver')
  async resolver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolverReclamoDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.reclamos.resolver(
      cooperativaDelToken(req.user),
      id,
      req.user.sub,
      dto,
    );
  }
}
