import {
  Inject,
  Injectable,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import type { CalificacionesRepositorio } from '../../dominio/calificaciones/calificaciones.ports';

export const CALIFICACIONES_REPOSITORIO = 'CALIFICACIONES_REPOSITORIO';

@Injectable()
export class CalificacionesService {
  constructor(
    @Inject(CALIFICACIONES_REPOSITORIO)
    private readonly calificaciones: CalificacionesRepositorio,
  ) {}

  async calificarViaje(
    boletoId: string,
    usuarioId: string,
    puntuacion: number,
    comentario?: string,
  ) {
    if (!Number.isInteger(puntuacion) || puntuacion < 1 || puntuacion > 5) {
      throw new BadRequestException(
        'La puntuación debe ser un número entero entre 1 y 5.',
      );
    }

    const boleto =
      await this.calificaciones.obtenerCooperativaSiBoletoPerteneceA(
        boletoId,
        usuarioId,
      );
    if (!boleto) {
      throw new ForbiddenException(
        'Este boleto no existe o no te pertenece — solo puedes calificar un viaje que tú compraste.',
      );
    }

    // Hallazgo real, 22-jul-2026: no tiene sentido calificar un viaje
    // que todavía no ha ocurrido. Idealmente esto se abriría cuando el
    // sistema de monitoreo/alertas confirme la llegada real (fase
    // futura, no construida todavía) — mientras tanto, se usa la hora
    // de llegada ESTIMADA del viaje como el mejor proxy disponible.
    const referenciaLlegada =
      boleto.horaLlegadaEstimada ?? boleto.horaSalidaProgramada;
    if (new Date() < referenciaLlegada) {
      throw new BadRequestException(
        'Todavía no puedes calificar este viaje — espera a que llegues a tu destino.',
      );
    }

    const yaCalificado =
      await this.calificaciones.yaExisteCalificacionPara(boletoId);
    if (yaCalificado) {
      throw new ConflictException('Ya calificaste este boleto.');
    }

    return this.calificaciones.crear({
      boletoId,
      cooperativaId: boleto.cooperativaId,
      pasajeroUsuarioId: usuarioId,
      puntuacion,
      comentario,
    });
  }

  async resumenPorCooperativa(cooperativaId: string) {
    return this.calificaciones.resumenPorCooperativa(cooperativaId);
  }

  /**
   * Reseñas de texto reales (13-ago-2026). Mismo umbral mínimo de
   * confianza ya decidido en el ítem 12, Fase 2 (05-ago-2026,
   * DOCUMENTO_MAESTRO.md) para el promedio numérico -- 5 calificaciones
   * mínimo antes de mostrar nada, mismo criterio que Google/Amazon.
   * Se revisó el valor real en busqueda.service.ts (UMBRAL_MINIMO_CALIFICACIONES)
   * en vez de asumirlo -- debe mantenerse igual a ese si cambia ahí.
   */
  async listarResenas(cooperativaId: string, pagina: number, porPagina: number) {
    const UMBRAL_MINIMO_CALIFICACIONES = 5;
    const resumen = await this.calificaciones.resumenPorCooperativa(cooperativaId);
    if (resumen.cantidad < UMBRAL_MINIMO_CALIFICACIONES) {
      return { resenas: [], total: 0, pagina, porPagina };
    }
    const { resenas, total } = await this.calificaciones.listarResenasPorCooperativa(
      cooperativaId,
      pagina,
      porPagina,
    );
    return { resenas, total, pagina, porPagina };
  }

  async listarMisBoletos(usuarioId: string) {
    const boletos =
      await this.calificaciones.listarBoletosDePasajero(usuarioId);
    return boletos.map((b) => {
      const referenciaLlegada = b.horaLlegadaEstimada ?? b.horaSalidaProgramada;
      return {
        ...b,
        puedeCalificar: !b.yaCalificado && new Date() >= referenciaLlegada,
      };
    });
  }

}
