import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { NotificadorEmail } from '../../dominio/auth/auth.ports';
import type {
  EstadoViajesRepositorio,
  ViajeCambiado,
} from '../../dominio/estado-viajes/estado-viajes.ports';
import { AuditoriaRegistrador } from '../../infraestructura/auditoria/auditoria.registrador';
import { NOTIFICADOR_EMAIL } from '../auth/auth.service';

export const ESTADO_VIAJES_REPOSITORIO = 'ESTADO_VIAJES_REPOSITORIO';

/** Minutos de espera después de la hora de salida antes de decidir si el viaje salió o no. */
const ESPERA_MINUTOS = 15;
/** Si nadie confirma la llegada, el viaje se da por finalizado al pasar estas horas de la llegada estimada. */
const HORAS_HASTA_FINALIZACION_AUTOMATICA = 24;

/**
 * Cambio automático del estado de los viajes (24-sep-2026), cada 5 minutos:
 *
 *   - Pasaron 15 min de la hora de salida y el viaje vendió boletos:
 *     programado -> en_curso (se asume que salió).
 *   - Pasaron 15 min y NO vendió nada: programado -> cancelado. Un viaje
 *     con asientos reservados pendientes de confirmar el pago NO se
 *     cancela: esa venta todavía puede concretarse.
 *   - Pasó la hora estimada de llegada de un viaje en curso: se le pregunta
 *     por correo a la cooperativa si el bus ya llegó; al confirmarlo desde
 *     su panel, en_curso -> finalizado.
 *   - Si nadie confirma en 24 h, se finaliza solo (no queda en curso para
 *     siempre).
 *
 * Cada cambio queda en la auditoría (RF-021), como acción del sistema.
 */
@Injectable()
export class EstadoViajesService {
  private readonly logger = new Logger(EstadoViajesService.name);
  private enEjecucion = false;

  constructor(
    @Inject(ESTADO_VIAJES_REPOSITORIO)
    private readonly repo: EstadoViajesRepositorio,
    @Inject(NOTIFICADOR_EMAIL) private readonly email: NotificadorEmail,
    private readonly auditoria: AuditoriaRegistrador,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async procesar(): Promise<void> {
    if (this.enEjecucion) return;
    this.enEjecucion = true;
    try {
      const iniciados = await this.repo.iniciarViajesConVentas(ESPERA_MINUTOS);
      await this.auditarCambios(iniciados, 'salida_con_boletos_vendidos');

      const cancelados =
        await this.repo.cancelarViajesSinVentas(ESPERA_MINUTOS);
      await this.auditarCambios(cancelados, 'salida_sin_boletos_vendidos');

      const finalizados = await this.repo.finalizarViajesVencidos(
        HORAS_HASTA_FINALIZACION_AUTOMATICA,
      );
      await this.auditarCambios(finalizados, 'sin_confirmacion_de_llegada');

      await this.preguntarLlegadas();

      const total = iniciados.length + cancelados.length + finalizados.length;
      if (total > 0) {
        this.logger.log(
          `Estado de viajes: ${iniciados.length} en curso, ${cancelados.length} cancelados sin ventas, ${finalizados.length} finalizados sin confirmación.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `No se pudo actualizar el estado de los viajes: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.enEjecucion = false;
    }
  }

  /** La cooperativa confirma que el bus llegó a su destino: en_curso -> finalizado. */
  async confirmarLlegada(
    cooperativaId: string,
    viajeId: string,
    usuarioId: string,
  ) {
    const cambio = await this.repo.confirmarLlegada(cooperativaId, viajeId);
    if (!cambio) {
      throw new BadRequestException(
        'Este viaje no existe, no es de tu cooperativa o ya no está en curso.',
      );
    }
    await this.auditoria.registrar({
      accion: 'cambio_estado_viaje',
      usuarioId,
      entidadTipo: 'viaje',
      entidadId: viajeId,
      detalle: {
        anterior: cambio.anterior,
        nuevo: cambio.nuevo,
        motivo: 'llegada_confirmada_por_cooperativa',
        ruta: cambio.ruta,
        horaSalida: cambio.horaSalida,
      },
    });
    return { ok: true };
  }

  private async auditarCambios(cambios: ViajeCambiado[], motivo: string) {
    for (const c of cambios) {
      await this.auditoria.registrar({
        accion: 'cambio_estado_viaje',
        entidadTipo: 'viaje',
        entidadId: c.viajeId,
        detalle: {
          cooperativaId: c.cooperativaId,
          anterior: c.anterior,
          nuevo: c.nuevo,
          motivo,
          ruta: c.ruta,
          horaSalida: c.horaSalida,
        },
        origen: 'sistema',
      });
    }
  }

  /** Pregunta por correo, una sola vez por viaje, si el bus ya llegó. */
  private async preguntarLlegadas() {
    const viajes = await this.repo.viajesParaConsultarLlegada();
    for (const v of viajes) {
      try {
        const correos = await this.repo.correosDeCooperativa(v.cooperativaId);
        for (const correo of correos) {
          await this.email.enviarConsultaLlegada(correo, {
            cooperativaNombre: v.cooperativaNombre,
            ruta: v.ruta,
            horaSalida: v.horaSalida,
            placa: v.placa,
          });
        }
      } catch (error) {
        this.logger.warn(
          `No se pudo enviar la consulta de llegada del viaje ${v.viajeId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // Se marca aunque el correo falle: la cooperativa igual ve el viaje
      // "en curso" resaltado en su panel, y así no se reintenta cada 5 min.
      await this.repo.marcarLlegadaConsultada(v.viajeId);
    }
  }
}
