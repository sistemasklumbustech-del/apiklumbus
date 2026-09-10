import { Injectable, Logger } from '@nestjs/common';
import type { NotificadorWhatsApp } from '../../dominio/auth/auth.ports';

/**
 * Notificador de WhatsApp simulado (03-ago-2026) -- mismo criterio que
 * SimuladorNotificador (correo) y simulador.pasarela.ts: imprime en
 * consola en vez de enviar de verdad, para poder construir y probar el
 * flujo completo sin depender de una cuenta real de Twilio todavía. Se
 * reemplaza por la integración real cuando el proyecto llegue a la Fase
 * de conexiones externas (documento maestro, hoja de ruta Fase 4),
 * priorizado sobre Resend según la decisión del director del 30-jul-2026.
 */
@Injectable()
export class SimuladorNotificadorWhatsApp implements NotificadorWhatsApp {
  private readonly logger = new Logger(SimuladorNotificadorWhatsApp.name);

  async enviarRecordatorioViaje(
    telefono: string,
    detalle: {
      viajeId: string;
      origenCiudad: string;
      destinoCiudad: string;
      fechaSalida: string;
      horaSalidaProgramada: string;
    },
  ): Promise<void> {
    this.logger.log(
      `[SIMULADO WHATSAPP] Recordatorio para ${telefono} -> viaje ${detalle.viajeId}, ` +
        `${detalle.origenCiudad} → ${detalle.destinoCiudad}, ${detalle.fechaSalida} ${detalle.horaSalidaProgramada}`,
    );
  }

  async enviarAvisoCambioOperativo(
    telefono: string,
    detalle: { viajeId: string; motivo: string },
  ): Promise<void> {
    this.logger.log(
      `[SIMULADO WHATSAPP] Aviso de cambio operativo para ${telefono} -> viaje ${detalle.viajeId}: ${detalle.motivo}`,
    );
  }

  /** Fase 8, item 32 (11-ago-2026) -- aviso al llegar a destino. */
  async enviarAvisoLlegada(
    telefono: string,
    detalle: { viajeId: string; destinoCiudad: string },
  ): Promise<void> {
    this.logger.log(
      `[SIMULADO WHATSAPP] Aviso de llegada para ${telefono} -> viaje ${detalle.viajeId}, ` +
        `llegando a ${detalle.destinoCiudad}. No olvides tus pertenencias.`,
    );
  }

  /** Fase 8, item 33 (11-ago-2026) -- solicitud de calificación post-viaje. */
  async enviarSolicitudCalificacion(
    telefono: string,
    detalle: { viajeId: string; destinoCiudad: string },
  ): Promise<void> {
    this.logger.log(
      `[SIMULADO WHATSAPP] Solicitud de calificación para ${telefono} -> viaje ${detalle.viajeId}, ` +
        `llegada a ${detalle.destinoCiudad}. ¿Cómo estuvo tu viaje?`,
    );
  }
}
