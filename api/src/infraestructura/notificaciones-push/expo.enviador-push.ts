import { Injectable } from '@nestjs/common';
import type {
  EnviadorPush,
  MensajePush,
} from '../../dominio/notificaciones-push/notificaciones-push.ports';

const URL_EXPO = 'https://exp.host/--/api/v2/push/send';
/** Expo acepta hasta 100 mensajes por llamada. */
const MAXIMO_POR_LLAMADA = 100;

interface TicketExpo {
  status: 'ok' | 'error';
  details?: { error?: string };
}

/**
 * Envío por el servicio de Expo (`exp.host`), que reparte a Firebase (Android) y APNs (iPhone) con
 * las credenciales del proyecto de la app en EAS. Sin SDK: es una sola llamada HTTP. Si se define
 * `EXPO_ACCESS_TOKEN` se envía como Bearer (necesario solo si el proyecto activó "enhanced security").
 */
@Injectable()
export class ExpoEnviadorPush implements EnviadorPush {
  async enviar(
    tokens: string[],
    mensaje: MensajePush,
  ): Promise<{ tokensInvalidos: string[] }> {
    const tokensInvalidos: string[] = [];
    for (let i = 0; i < tokens.length; i += MAXIMO_POR_LLAMADA) {
      const lote = tokens.slice(i, i + MAXIMO_POR_LLAMADA);
      const respuesta = await fetch(URL_EXPO, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(
          lote.map((to) => ({
            to,
            title: mensaje.titulo,
            body: mensaje.cuerpo,
            data: mensaje.datos ?? {},
            sound: 'default',
            channelId: 'default',
          })),
        ),
        signal: AbortSignal.timeout(8000),
      });
      if (!respuesta.ok) throw new Error(`Expo respondió ${respuesta.status}`);
      const { data } = (await respuesta.json()) as { data?: TicketExpo[] };
      (data ?? []).forEach((ticket, indice) => {
        if (
          ticket.status === 'error' &&
          ticket.details?.error === 'DeviceNotRegistered'
        ) {
          tokensInvalidos.push(lote[indice]);
        }
      });
    }
    return { tokensInvalidos };
  }
}
