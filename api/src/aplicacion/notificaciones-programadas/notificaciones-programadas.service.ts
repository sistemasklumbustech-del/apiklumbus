import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { NotificacionesProgramadasRepositorio } from '../../dominio/notificaciones-programadas/notificaciones-programadas.ports';
import type { NotificadorWhatsApp } from '../../dominio/auth/auth.ports';

export const NOTIFICACIONES_PROGRAMADAS_REPOSITORIO =
  'NOTIFICACIONES_PROGRAMADAS_REPOSITORIO';
export const NOTIFICADOR_WHATSAPP = 'NOTIFICADOR_WHATSAPP';

/** Ventana de recordatorio -- 24h antes de la salida. */
const HORAS_ANTES_RECORDATORIO = 24;

/** Fase 8, item 32 (11-ago-2026) -- ventana de aviso de llegada, 20 min antes de la hora estimada. */
const MINUTOS_ANTES_AVISO_LLEGADA = 20;

/** Fase 8, item 33 (11-ago-2026) -- colchon antes de pedir calificacion, 30 min despues de la llegada. */
const MINUTOS_DESPUES_PARA_CALIFICACION = 30;

@Injectable()
export class NotificacionesProgramadasService {
  private readonly logger = new Logger(NotificacionesProgramadasService.name);

  constructor(
    @Inject(NOTIFICACIONES_PROGRAMADAS_REPOSITORIO)
    private readonly repo: NotificacionesProgramadasRepositorio,
    @Inject(NOTIFICADOR_WHATSAPP)
    private readonly whatsapp: NotificadorWhatsApp,
  ) {}

  /**
   * RF-NOTIF-002 -- recordatorio de viaje próximo. Corre cada hora;
   * revisa una ventana de 24h por delante. Nunca lanza -- un fallo de
   * notificación no debe afectar nada más del sistema (mismo criterio
   * que notificarCompraConfirmada).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async enviarRecordatoriosDeViaje(): Promise<void> {
    const pendientes = await this.repo.listarRecordatoriosPendientes(
      HORAS_ANTES_RECORDATORIO,
    );
    for (const p of pendientes) {
      const { id } = await this.repo.registrarRecordatorio(p.viajeId, p.compraId, p.telefono);
      if (!p.telefono) {
        await this.repo.marcarNotificacionFallida(id, 'El comprador no tiene teléfono registrado.');
        continue;
      }
      try {
        await this.whatsapp.enviarRecordatorioViaje(p.telefono, {
          viajeId: p.viajeId,
          origenCiudad: p.origenCiudad,
          destinoCiudad: p.destinoCiudad,
          fechaSalida: p.fechaSalida,
          horaSalidaProgramada: p.horaSalidaProgramada,
        });
        await this.repo.marcarNotificacionEnviada(id);
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : 'Error desconocido';
        this.logger.error(`No se pudo enviar recordatorio del viaje ${p.viajeId}: ${mensaje}`);
        await this.repo.marcarNotificacionFallida(id, mensaje);
      }
    }
  }

  /**
   * RF-NOTIF-003 -- aviso de cambio operativo. Disparo síncrono desde
   * PanelEmpresaService.cambiarUnidadViaje, justo después de que el
   * cambio se aplicó de verdad. Nunca lanza -- un fallo de notificación
   * no debe revertir un cambio de unidad ya aplicado.
   */
  async notificarCambioOperativo(
    cooperativaId: string,
    viajeId: string,
    motivo: string,
  ): Promise<void> {
    try {
      const compras = await this.repo.listarComprasAfectadasPorViaje(cooperativaId, viajeId);
      for (const compra of compras) {
        const { id } = await this.repo.registrarAvisoCambioOperativo(
          viajeId,
          compra.compraId,
          compra.telefono,
        );
        if (!compra.telefono) {
          await this.repo.marcarNotificacionFallida(id, 'El comprador no tiene teléfono registrado.');
          continue;
        }
        try {
          await this.whatsapp.enviarAvisoCambioOperativo(compra.telefono, { viajeId, motivo });
          await this.repo.marcarNotificacionEnviada(id);
        } catch (error) {
          const mensaje = error instanceof Error ? error.message : 'Error desconocido';
          await this.repo.marcarNotificacionFallida(id, mensaje);
        }
      }
    } catch (error) {
      this.logger.error(
        `No se pudo notificar el cambio operativo del viaje ${viajeId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Fase 8, item 32 (11-ago-2026) -- aviso al llegar a destino
   * (recordatorio de recoger pertenencias). Corre cada 10 minutos;
   * revisa una ventana movil de 20 min antes de la hora estimada de
   * llegada. Mismo criterio de idempotencia y manejo de errores que
   * enviarRecordatoriosDeViaje: nunca lanza.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async enviarAvisosDeLlegada(): Promise<void> {
    const pendientes = await this.repo.listarAvisosLlegadaPendientes(
      MINUTOS_ANTES_AVISO_LLEGADA,
    );
    for (const p of pendientes) {
      const { id } = await this.repo.registrarAvisoLlegada(p.viajeId, p.compraId, p.telefono);
      if (!p.telefono) {
        await this.repo.marcarNotificacionFallida(id, 'El comprador no tiene teléfono registrado.');
        continue;
      }
      try {
        await this.whatsapp.enviarAvisoLlegada(p.telefono, {
          viajeId: p.viajeId,
          destinoCiudad: p.destinoCiudad,
        });
        await this.repo.marcarNotificacionEnviada(id);
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : 'Error desconocido';
        this.logger.error(`No se pudo enviar aviso de llegada del viaje ${p.viajeId}: ${mensaje}`);
        await this.repo.marcarNotificacionFallida(id, mensaje);
      }
    }
  }

  /**
   * Fase 8, item 33 (11-ago-2026) -- solicitud de calificación al
   * terminar el viaje. Corre cada hora; revisa viajes completados con
   * al menos 30 min desde la llegada. Mismo criterio de idempotencia y
   * manejo de errores.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async enviarSolicitudesDeCalificacion(): Promise<void> {
    const pendientes = await this.repo.listarViajesCompletadosPendientesDeCalificacion(
      MINUTOS_DESPUES_PARA_CALIFICACION,
    );
    for (const p of pendientes) {
      const { id } = await this.repo.registrarSolicitudCalificacion(p.viajeId, p.compraId, p.telefono);
      if (!p.telefono) {
        await this.repo.marcarNotificacionFallida(id, 'El comprador no tiene teléfono registrado.');
        continue;
      }
      try {
        await this.whatsapp.enviarSolicitudCalificacion(p.telefono, {
          viajeId: p.viajeId,
          destinoCiudad: p.destinoCiudad,
        });
        await this.repo.marcarNotificacionEnviada(id);
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : 'Error desconocido';
        this.logger.error(`No se pudo enviar solicitud de calificación del viaje ${p.viajeId}: ${mensaje}`);
        await this.repo.marcarNotificacionFallida(id, mensaje);
      }
    }
  }
}
