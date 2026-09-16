import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { NotificadorEmail } from '../../dominio/auth/auth.ports';

const REMITENTE = 'Klumbus <notificaciones@klumbustech.com>';
const URL_FRONTEND = 'https://klumbustech.com';

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
    await this.resend.emails.send({
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

  async enviarConfirmacionCompra(
    correo: string,
    detalle: { compraId: string; montoTotal: number; cantidadBoletos: number },
  ): Promise<void> {
    await this.resend.emails.send({
      from: REMITENTE,
      to: correo,
      subject: 'Confirmación de tu compra — Klumbus',
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
          <p style="margin: 24px 0;">
            <a href="${URL_FRONTEND}/mis-boletos" style="background:#2451c4; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:600; font-size:14px; display:inline-block;">
              Ver mis boletos
            </a>
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
    await this.resend.emails.send({
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
