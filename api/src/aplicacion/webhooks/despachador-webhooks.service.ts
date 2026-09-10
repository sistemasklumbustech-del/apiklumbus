import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { WebhooksRepositorio } from '../../dominio/webhooks/webhooks.ports';

export const WEBHOOKS_REPOSITORIO = 'WEBHOOKS_REPOSITORIO';
const MAX_INTENTOS = 5;

/**
 * Despachador de webhooks — Modelo B (02-ago-2026), RF-API-003.
 * `dispararEventoVenta` se llama justo después de confirmar una venta
 * real (tarjeta o pago manual). NUNCA lanza -- un problema con el
 * webhook de una cooperativa no debe revertir ni bloquear una venta ya
 * cobrada, mismo criterio que `generarFacturaPlataforma` en
 * CheckoutService.
 */
@Injectable()
export class DespachadorWebhooksService {
  private readonly logger = new Logger(DespachadorWebhooksService.name);

  constructor(
    @Inject(WEBHOOKS_REPOSITORIO) private readonly repo: WebhooksRepositorio,
  ) {}

  async dispararEventoVenta(
    cooperativaId: string,
    compraId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const credencial = await this.repo.obtenerWebhookActivo(cooperativaId);
      // No es un error -- la mayoría de cooperativas hoy no usan Modelo B.
      if (!credencial) return;

      const { id } = await this.repo.crearEventoWebhook(
        cooperativaId,
        compraId,
        'venta_creada',
        payload,
      );
      await this.intentarEnviar(id, credencial.webhookUrl, payload);
    } catch (error) {
      this.logger.warn(
        `No se pudo disparar el webhook de venta para la compra ${compraId}: ${(error as Error).message}`,
      );
    }
  }

  private async intentarEnviar(id: string, url: string, payload: unknown): Promise<void> {
    try {
      const respuesta = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (respuesta.ok) {
        await this.repo.marcarEntregado(id, `HTTP ${respuesta.status}`);
      } else {
        await this.repo.registrarIntentoFallido(id, `HTTP ${respuesta.status}`);
      }
    } catch (error) {
      await this.repo.registrarIntentoFallido(id, (error as Error).message);
    }
  }

  /**
   * Reintentos automáticos cada 5 minutos. Sin backoff exponencial por
   * ahora -- con el volumen actual (cero cooperativas reales conectadas
   * todavía), cada 5 min hasta 5 intentos (25 min de ventana) es
   * suficiente; se afina cuando exista la primera integración real.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reintentarPendientes(): Promise<void> {
    const pendientes = await this.repo.listarPendientesParaReintentar(MAX_INTENTOS);
    for (const evento of pendientes) {
      await this.intentarEnviar(evento.id, evento.webhookUrl, evento.payload);
    }
  }
}
