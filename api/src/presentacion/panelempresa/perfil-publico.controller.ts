import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  PerfilPublicoRepositorio,
  type PerfilPublicoCooperativa,
} from '../../infraestructura/panelempresa/perfil-publico.repositorio';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PayloadToken } from '../../dominio/auth/auth.ports';

export class GuardarPerfilPublicoDto {
  @IsOptional()
  @IsString()
  @MaxLength(600)
  descripcion?: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  servicios!: string[];

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  beneficios!: string[];
}

/** Sin duplicados ni vacíos, con espacios recortados. */
function limpiarLista(lista: string[]): string[] {
  const vistos = new Set<string>();
  const resultado: string[] = [];
  for (const item of lista) {
    const t = item.trim().replace(/\s+/g, ' ');
    const clave = t.toLowerCase();
    if (t === '' || vistos.has(clave)) continue;
    vistos.add(clave);
    resultado.push(t);
  }
  return resultado;
}

/** Perfil público de la cooperativa (26-sep-2026): la cooperativa sale SIEMPRE de su token. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_cooperativa')
@Controller('coop/perfil-publico')
export class PerfilPublicoController {
  constructor(private readonly perfil: PerfilPublicoRepositorio) {}

  private cooperativa(user: PayloadToken): string {
    if (!user.cooperativaId) {
      throw new ForbiddenException(
        'Este usuario no pertenece a ninguna cooperativa.',
      );
    }
    return user.cooperativaId;
  }

  @Get()
  obtener(@Request() req: { user: PayloadToken }) {
    return this.perfil.obtener(this.cooperativa(req.user));
  }

  @Put()
  async guardar(
    @Body() dto: GuardarPerfilPublicoDto,
    @Request() req: { user: PayloadToken },
  ) {
    const datos: PerfilPublicoCooperativa = {
      descripcion: (dto.descripcion ?? '').trim(),
      servicios: limpiarLista(dto.servicios),
      beneficios: limpiarLista(dto.beneficios),
    };
    await this.perfil.guardar(this.cooperativa(req.user), datos);
    return datos;
  }
}
