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
import { CuentasCobroService } from '../../aplicacion/cuentas-cobro/cuentas-cobro.service';
import {
  ConsultarCuentasCobroDto,
  RechazarCuentaCobroDto,
  RegistrarCuentaCobroDto,
} from './dto/cuentas-cobro.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PayloadToken } from '../../dominio/auth/auth.ports';

/** La cooperativa sale SIEMPRE del token firmado, nunca del cliente. */
function cooperativaDelToken(user: PayloadToken): string {
  if (!user.cooperativaId) {
    throw new ForbiddenException(
      'Este usuario no pertenece a ninguna cooperativa.',
    );
  }
  return user.cooperativaId;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_cooperativa')
@Controller('coop/cuenta-cobro')
export class CuentaCobroCoopController {
  constructor(private readonly cuentas: CuentasCobroService) {}

  @Get()
  listar(@Request() req: { user: PayloadToken }) {
    return this.cuentas.listarDeCooperativa(cooperativaDelToken(req.user));
  }

  @Post()
  registrar(
    @Body() dto: RegistrarCuentaCobroDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.cuentas.registrar(
      cooperativaDelToken(req.user),
      req.user.sub,
      dto,
    );
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_plataforma', 'super_admin')
@Controller('admin/cuentas-cobro')
export class CuentasCobroAdminController {
  constructor(private readonly cuentas: CuentasCobroService) {}

  @Get()
  listar(@Query() dto: ConsultarCuentasCobroDto) {
    return this.cuentas.listarParaAdmin(dto.estado);
  }

  @Patch(':id/verificar')
  verificar(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: PayloadToken },
  ) {
    return this.cuentas.verificar(id, req.user.sub);
  }

  @Patch(':id/rechazar')
  rechazar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RechazarCuentaCobroDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.cuentas.rechazar(id, req.user.sub, dto.motivo);
  }
}
