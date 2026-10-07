import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PostpagoService } from '../../aplicacion/postpago/postpago.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import type { PayloadToken } from '../../dominio/auth/auth.ports';

export class ConsultarTareasPostpagoDto {
  @IsOptional()
  @IsIn(['pendiente', 'en_proceso', 'exitosa', 'agotada'])
  estado?: 'pendiente' | 'en_proceso' | 'exitosa' | 'agotada';

  @IsOptional()
  @IsUUID()
  compraId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite?: number;
}

/**
 * Tareas posteriores al pago (06-oct-2026): factura del pasaje, registro de
 * la tasa en el terminal y factura del cargo de servicio. Las que se
 * agotaron (`estado=agotada`) son las que necesitan revisión de una persona.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_plataforma', 'super_admin')
@Controller('admin/postpago')
export class PostpagoController {
  constructor(private readonly postpago: PostpagoService) {}

  @Get('tareas')
  async listar(@Query() dto: ConsultarTareasPostpagoDto) {
    const { filas, total } = await this.postpago.listar({
      estado: dto.estado,
      compraId: dto.compraId,
      pagina: dto.pagina ?? 1,
      limite: dto.limite ?? 25,
    });
    return { filas, total, pagina: dto.pagina ?? 1, limite: dto.limite ?? 25 };
  }

  @Post('tareas/:id/reintentar')
  async reintentar(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: PayloadToken }) {
    const reiniciada = await this.postpago.reintentar(id, req.user.sub);
    if (!reiniciada) {
      throw new NotFoundException('La tarea no existe o no está agotada.');
    }
    return { ok: true };
  }
}
