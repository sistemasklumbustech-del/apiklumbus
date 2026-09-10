/**
 * Despachador de webhooks — Modelo B (02-ago-2026), RF-API-003.
 * "Sin perder el evento de venta" es el criterio de aceptación exacto
 * -- por eso todo pasa por webhooks_log (cola persistida), nunca un
 * fetch() de una sola vez sin registro.
 */

export interface EventoWebhookPendiente {
  id: string;
  cooperativaId: string;
  webhookUrl: string;
  evento: string;
  payload: unknown;
  intentos: number;
}

export interface WebhooksRepositorio {
  /** null si la cooperativa no tiene credencial activa con webhook configurado -- no es un error, Modelo B es opcional. */
  obtenerWebhookActivo(cooperativaId: string): Promise<{ webhookUrl: string } | null>;

  crearEventoWebhook(
    cooperativaId: string,
    compraId: string,
    evento: string,
    payload: unknown,
  ): Promise<{ id: string }>;

  marcarEntregado(id: string, respuesta: string): Promise<void>;

  /** El propio repositorio decide, según el máximo de intentos, si pasa a 'fallido' o sigue 'pendiente'. */
  registrarIntentoFallido(id: string, respuesta: string): Promise<void>;

  /** Cross-cooperativa a propósito -- lo usa el cron, no una sesión de usuario. */
  listarPendientesParaReintentar(maxIntentos: number): Promise<EventoWebhookPendiente[]>;
}
