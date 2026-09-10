import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import type { LiquidacionesRepositorio } from '../../dominio/liquidaciones/liquidaciones.ports';

export const LIQUIDACIONES_REPOSITORIO = 'LIQUIDACIONES_REPOSITORIO';

@Injectable()
export class LiquidacionesService {
  constructor(
    @Inject(LIQUIDACIONES_REPOSITORIO)
    private readonly liquidaciones: LiquidacionesRepositorio,
  ) {}

  async generar(cooperativaId: string, periodoInicio: string, periodoFin: string) {
    if (periodoInicio > periodoFin) {
      throw new BadRequestException(
        'La fecha de inicio del período no puede ser posterior a la de fin.',
      );
    }
    const resultado = await this.liquidaciones.generarLiquidacionCooperativa(
      cooperativaId,
      periodoInicio,
      periodoFin,
    );
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return resultado.liquidacion;
  }

  listar(cooperativaId?: string) {
    return this.liquidaciones.listarLiquidacionesCooperativa(cooperativaId);
  }

  async marcarPagada(id: string) {
    const resultado = await this.liquidaciones.marcarLiquidacionPagada(id);
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return { ok: true };
  }
}
