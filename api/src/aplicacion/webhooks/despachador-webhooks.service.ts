import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { WebhooksRepositorio } from '../../dominio/webhooks/webhooks.ports';
import {
  CABECERA_EVENTO_ID,
  CABECERA_FIRMA,
  CABECERA_TIMESTAMP,
  firmarWebhook,
} from '../../dominio/webhooks/firma-webhook';

export const WEBHOOKS_REPOSITORIO = 'WEBHOOKS_REPOSITORIO';
export const WEBHOOKS_CIFRADOR = 'WEBHOOKS_CIFRADOR';
const MAX_INTENTOS = 5;

/** Lo único que el despachador necesita del cifrador de secretos. */
export interface CifradorSecretosWebhook {
  descifrar(textoCifrado: string): string;
}

export interface ResultadoEnvioPrueba {
  entregado: boolean;
  firmado: boolean;
  respuesta: string;
}

/**
 * Despachador de webhooks — Modelo B (02-ago-2026), RF-API-003.
 * `dispararEventoVenta` se llama justo después de confirmar una venta
 * real (tarjeta o pago manual). NUNCA lanza -- un problema con el
 * webhook de una cooperativa no debe revertir ni bloquear una venta ya
 * cobrada, mismo criterio que `generarFacturaPlataforma` en
 * CheckoutService.
 *
 * Cada envío se firma (ver `firma-webhook.ts`). La firma se calcula en el
 * momento de enviar, no al crear el evento: así un reintento lleva un
 * timestamp vigente y no lo rechaza la ventana anti-replay del receptor.
 */
@Injectable()
export class DespachadorWebhooksService {
  private readonly logger = new Logger(DespachadorWebhooksService.name);

  constructor(
    @Inject(WEBHOOKS_REPOSITORIO) private readonly repo: WebhooksRepositorio,
    @Inject(WEBHOOKS_CIFRADOR) private readonly cifrador: CifradorSecretosWebhook,
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
      await this.intentarEnviar(id, credencial.webhookUrl, credencial.secretoCifrado, payload);
    } catch (error) {
      this.logger.warn(
        `No se pudo disparar el webhook de venta para la compra ${compraId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Envía un evento de prueba firmado a la URL de la cooperativa, sin
   * registrarlo en la cola ni reintentar: sirve para que su equipo compruebe
   * la URL y su verificación de firma antes de la primera venta real.
   */
  async dispararEventoPrueba(cooperativaId: string): Promise<ResultadoEnvioPrueba | null> {
    const credencial = await this.repo.obtenerWebhookActivo(cooperativaId);
    if (!credencial) return null;
    const payload = {
      evento: 'prueba',
      mensaje: 'Evento de prueba de Klumbus. No corresponde a ninguna venta.',
    };
    const resultado = await this.enviar(
      `prueba-${Date.now()}`,
      credencial.webhookUrl,
      credencial.secretoCifrado,
      payload,
    );
    return {
      entregado: resultado.ok,
      firmado: credencial.secretoCifrado !== null,
      respuesta: resultado.respuesta,
    };
  }

  private async intentarEnviar(
    id: string,
    url: string,
    secretoCifrado: string | null,
    payload: unknown,
  ): Promise<void> {
    const resultado = await this.enviar(id, url, secretoCifrado, payload);
    if (resultado.ok) {
      await this.repo.marcarEntregado(id, resultado.respuesta);
    } else {
      await this.repo.registrarIntentoFallido(id, resultado.respuesta);
    }
  }

  private async enviar(
    eventoId: string,
    url: string,
    secretoCifrado: string | null,
    payload: unknown,
  ): Promise<{ ok: boolean; respuesta: string }> {
    try {
      // El cuerpo se serializa una sola vez: la firma cubre exactamente estos bytes.
      const cuerpo = JSON.stringify(payload);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        [CABECERA_EVENTO_ID]: eventoId,
      };
      // Las llaves anteriores a la firma no tienen secreto: se envían sin firma
      // hasta que la cooperativa genere uno desde su panel.
      if (secretoCifrado) {
        const timestamp = Math.floor(Date.now() / 1000);
        headers[CABECERA_TIMESTAMP] = String(timestamp);
        headers[CABECERA_FIRMA] = firmarWebhook(this.cifrador.descifrar(secretoCifrado), timestamp, cuerpo);
      }
      const respuesta = await fetch(url, {
        method: 'POST',
        headers,
        body: cuerpo,
        signal: AbortSignal.timeout(10000),
      });
      return { ok: respuesta.ok, respuesta: `HTTP ${respuesta.status}` };
    } catch (error) {
      return { ok: false, respuesta: (error as Error).message };
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
      await this.intentarEnviar(evento.id, evento.webhookUrl, evento.secretoCifrado, evento.payload);
    }
  }
}
