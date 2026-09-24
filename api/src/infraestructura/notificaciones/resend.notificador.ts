import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { AdjuntoCorreo, NotificadorEmail } from '../../dominio/auth/auth.ports';

const REMITENTE = 'Klumbus <notificaciones@klumbustech.com>';
const URL_FRONTEND = 'https://klumbustech.com';

/** El texto de reclamos lo escribe un usuario: se escapa antes de ir dentro del HTML del correo. */
function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function plantillaBase(tituloHtml: string, cuerpoHtml: string): string {
  // HTML de correo simple con estilos inline a propósito -- la mayoría
  // de clientes de correo (Gmail, Outlook) ignoran o mutilan <style> en
  // el <head>, así que cualquier color/espaciado real tiene que ir
  // inline para verse igual en todos lados.
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1a1a2e;">
      <p style="font-weight: 800; font-size: 20px; letter-spacing: -0.5px; margin: 0 0 24px;">
        KLUMB<span style="color:#f5a623;">US</span>
      </p>
      <h1 style="font-size: 18px; margin: 0 0 16px;">${tituloHtml}</h1>
      ${cuerpoHtml}
      <p style="margin-top: 32px; font-size: 12px; color: #6b7280;">
        Este es un correo automático de Klumbus, no respondas a esta dirección.
      </p>
    </div>
  `;
}

/**
 * Implementación real de NotificadorEmail vía Resend (16-sep-2026) --
 * reemplaza a SimuladorNotificador, que solo imprimía en consola. El
 * dominio klumbustech.com ya está verificado en Resend (DKIM + SPF).
 *
 * Requiere la variable de entorno RESEND_API_KEY.
 */
@Injectable()
export class ResendNotificador implements NotificadorEmail {
  private readonly resend: Resend;

  constructor(config: ConfigService) {
    this.resend = new Resend(config.getOrThrow<string>('RESEND_API_KEY'));
  }

  async enviarResetPassword(correo: string, tokenPlano: string): Promise<void> {
    const link = `${URL_FRONTEND}/restablecer-password?token=${tokenPlano}`;
    await this.enviar({
      from: REMITENTE,
      to: correo,
      subject: 'Recupera tu contraseña — Klumbus',
      html: plantillaBase(
        'Recupera tu contraseña',
        `
          <p style="font-size: 14px; line-height: 1.6;">
            Recibimos una solicitud para restablecer tu contraseña. Si fuiste vos, hacé clic en el botón de abajo. Si no pediste esto, podés ignorar este correo.
          </p>
          <p style="margin: 24px 0;">
            <a href="${link}" style="background:#2451c4; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:600; font-size:14px; display:inline-block;">
              Restablecer contraseña
            </a>
          </p>
          <p style="font-size: 12px; color: #6b7280; word-break: break-all;">
            O copiá y pegá este enlace: ${link}
          </p>
        `,
      ),
    });
  }

  /**
   * El SDK de Resend NO lanza excepciones ante un rechazo de la API: devuelve
   * { error }. Sin este chequeo, un envio fallido quedaba registrado como
   * "enviado".
   */
  private async enviar(
    payload: Parameters<Resend['emails']['send']>[0],
  ): Promise<void> {
    const { error } = await this.resend.emails.send(payload);
    if (error) {
      throw new Error(`Resend rechazó el envío: ${error.name} — ${error.message}`);
    }
  }

  async enviarConfirmacionCompra(
    correo: string,
    detalle: {
      compraId: string;
      montoTotal: number;
      cantidadBoletos: number;
      tieneCuenta?: boolean;
    },
    adjuntos?: AdjuntoCorreo[],
  ): Promise<void> {
    const hayAdjuntos = !!adjuntos && adjuntos.length > 0;
    await this.enviar({
      from: REMITENTE,
      to: correo,
      subject: 'Tu boleto — Klumbus',
      attachments: hayAdjuntos
        ? adjuntos.map((a) => ({ filename: a.nombreArchivo, content: a.contenido }))
        : undefined,
      html: plantillaBase(
        '¡Compra confirmada!',
        `
          <p style="font-size: 14px; line-height: 1.6;">
            Tu compra fue procesada correctamente.
          </p>
          <table style="width:100%; font-size:14px; margin: 16px 0; border-collapse: collapse;">
            <tr><td style="padding:6px 0; color:#6b7280;">N° de orden</td><td style="padding:6px 0; text-align:right;">${detalle.compraId}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">Boletos</td><td style="padding:6px 0; text-align:right;">${detalle.cantidadBoletos}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280; font-weight:700;">Total pagado</td><td style="padding:6px 0; text-align:right; font-weight:700;">$${detalle.montoTotal.toFixed(2)}</td></tr>
          </table>
          ${
            hayAdjuntos
              ? `<p style="font-size: 14px; line-height: 1.6;">Adjuntamos tu${detalle.cantidadBoletos > 1 ? 's' : ''} boleto${detalle.cantidadBoletos > 1 ? 's' : ''} en PDF, con el código QR. Presentá el QR (en el celular o impreso) al abordar.</p>`
              : ''
          }
          ${
            detalle.tieneCuenta === false
              ? ''
              : `<p style="margin: 24px 0;">
            <a href="${URL_FRONTEND}/mis-boletos" style="background:#2451c4; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:600; font-size:14px; display:inline-block;">
              Ver mis boletos
            </a>
          </p>`
          }
        `,
      ),
    });
  }

  async enviarConsultaLlegada(
    correo: string,
    detalle: {
      cooperativaNombre: string;
      ruta: string;
      horaSalida: string;
      placa: string;
    },
  ): Promise<void> {
    await this.enviar({
      from: REMITENTE,
      to: correo,
      subject: '¿Ya llegó el bus? — Klumbus',
      html: plantillaBase(
        '¿Ya llegó el bus a su destino?',
        `
          <p style="font-size: 14px; line-height: 1.6;">
            Pasó la hora estimada de llegada de un viaje de ${escaparHtml(detalle.cooperativaNombre)}:
          </p>
          <table style="width:100%; font-size:14px; margin: 16px 0; border-collapse: collapse;">
            <tr><td style="padding:6px 0; color:#6b7280;">Ruta</td><td style="padding:6px 0; text-align:right;">${escaparHtml(detalle.ruta)}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">Salida</td><td style="padding:6px 0; text-align:right;">${escaparHtml(detalle.horaSalida)}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">Unidad</td><td style="padding:6px 0; text-align:right;">${escaparHtml(detalle.placa)}</td></tr>
          </table>
          <p style="font-size: 14px; line-height: 1.6;">
            Si el bus ya llegó, confírmalo en tu panel para dar el viaje por finalizado.
          </p>
          <p style="margin: 24px 0;">
            <a href="${URL_FRONTEND}/panel-empresa/viajes?estado=en_curso" style="background:#2451c4; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:600; font-size:14px; display:inline-block;">
              Confirmar llegada
            </a>
          </p>
        `,
      ),
    });
  }

  async enviarReclamoNuevo(
    correo: string,
    detalle: {
      reclamoId: string;
      tipo: string;
      descripcion: string;
      pasajeroNombre: string;
      ruta: string;
      fechaSalida: string;
    },
  ): Promise<void> {
    await this.enviar({
      from: REMITENTE,
      to: correo,
      subject: 'Nuevo reclamo de un pasajero — Klumbus',
      html: plantillaBase(
        'Tienes un reclamo nuevo',
        `
          <table style="width:100%; font-size:14px; margin: 16px 0; border-collapse: collapse;">
            <tr><td style="padding:6px 0; color:#6b7280;">Pasajero</td><td style="padding:6px 0; text-align:right;">${escaparHtml(detalle.pasajeroNombre)}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">Viaje</td><td style="padding:6px 0; text-align:right;">${escaparHtml(detalle.ruta)} · ${escaparHtml(detalle.fechaSalida)}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">Tipo</td><td style="padding:6px 0; text-align:right;">${escaparHtml(detalle.tipo)}</td></tr>
          </table>
          <p style="font-size: 14px; line-height: 1.6; background:#f3f4f6; padding:12px; border-radius:8px; white-space:pre-wrap;">${escaparHtml(detalle.descripcion)}</p>
          <p style="margin: 24px 0;">
            <a href="${URL_FRONTEND}/panel-empresa/reclamos" style="background:#2451c4; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:600; font-size:14px; display:inline-block;">
              Ver el reclamo
            </a>
          </p>
        `,
      ),
    });
  }

  async enviarReclamoResuelto(
    correo: string,
    detalle: {
      reclamoId: string;
      estado: 'resuelto' | 'rechazado';
      respuesta: string;
      montoReconocido: number | null;
      cooperativaNombre: string;
      ruta: string;
    },
  ): Promise<void> {
    const aFavor = detalle.estado === 'resuelto';
    await this.enviar({
      from: REMITENTE,
      to: correo,
      subject: 'Respuesta a tu reclamo — Klumbus',
      html: plantillaBase(
        aFavor ? 'Tu reclamo fue aceptado' : 'Tu reclamo fue revisado',
        `
          <p style="font-size: 14px; line-height: 1.6;">
            ${escaparHtml(detalle.cooperativaNombre)} respondió tu reclamo del viaje ${escaparHtml(detalle.ruta)}.
          </p>
          <p style="font-size: 14px; line-height: 1.6; background:#f3f4f6; padding:12px; border-radius:8px; white-space:pre-wrap;">${escaparHtml(detalle.respuesta)}</p>
          ${
            aFavor && detalle.montoReconocido !== null
              ? `<p style="font-size: 14px; line-height: 1.6;">Monto que la cooperativa reconoce devolverte: <strong>$${detalle.montoReconocido.toFixed(2)}</strong>. La devolución la coordina directamente la cooperativa.</p>`
              : ''
          }
          <p style="margin: 24px 0;">
            <a href="${URL_FRONTEND}/perfil?tab=reclamos" style="background:#2451c4; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:600; font-size:14px; display:inline-block;">
              Ver mis reclamos
            </a>
          </p>
        `,
      ),
    });
  }

  async enviarCambioCorreo(
    correoNuevo: string,
    tokenPlano: string,
  ): Promise<void> {
    const link = `${URL_FRONTEND}/confirmar-cambio-correo?token=${tokenPlano}`;
    await this.enviar({
      from: REMITENTE,
      to: correoNuevo,
      subject: 'Confirmá tu nuevo correo — Klumbus',
      html: plantillaBase(
        'Confirmá tu nuevo correo',
        `
          <p style="font-size: 14px; line-height: 1.6;">
            Pediste usar este correo en tu cuenta de Klumbus. Confirmalo con el botón de abajo: hasta entonces tu cuenta sigue con el correo anterior. Si no fuiste vos, ignorá este mensaje y no pasará nada.
          </p>
          <p style="margin: 24px 0;">
            <a href="${link}" style="background:#2451c4; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:600; font-size:14px; display:inline-block;">
              Confirmar mi nuevo correo
            </a>
          </p>
          <p style="font-size: 12px; color: #6b7280; word-break: break-all;">
            O copiá y pegá este enlace: ${link}
          </p>
        `,
      ),
    });
  }

  async enviarVerificacionCorreo(
    correo: string,
    tokenPlano: string,
  ): Promise<void> {
    const link = `${URL_FRONTEND}/verificar-correo?token=${tokenPlano}`;
    await this.enviar({
      from: REMITENTE,
      to: correo,
      subject: 'Verificá tu correo — Klumbus',
      html: plantillaBase(
        'Verificá tu correo',
        `
          <p style="font-size: 14px; line-height: 1.6;">
            Gracias por registrarte en Klumbus. Confirmá tu correo haciendo clic en el botón de abajo.
          </p>
          <p style="margin: 24px 0;">
            <a href="${link}" style="background:#2451c4; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:600; font-size:14px; display:inline-block;">
              Verificar mi correo
            </a>
          </p>
          <p style="font-size: 12px; color: #6b7280; word-break: break-all;">
            O copiá y pegá este enlace: ${link}
          </p>
        `,
      ),
    });
  }
}
