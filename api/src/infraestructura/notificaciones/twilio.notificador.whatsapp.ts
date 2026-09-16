import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';
import type { NotificadorWhatsApp } from '../../dominio/auth/auth.ports';

/**
 * `telefono` en toda la plataforma se guarda como 10 dígitos locales de
 * Ecuador (09XXXXXXXX, ver RegistroDto -- @Matches(/^\d{10}$/)). WhatsApp
 * (vía Twilio) exige formato E.164 -- se le quita el 0 inicial y se le
 * antepone el código de país +593.
 */
function aE164Ecuador(telefonoLocal: string): string {
  const soloDigitos = telefonoLocal.replace(/\D/g, '');
  const sinCeroInicial = soloDigitos.startsWith('0')
    ? soloDigitos.slice(1)
    : soloDigitos;
  return `+593${sinCeroInicial}`;
}

/**
 * Implementación real de NotificadorWhatsApp vía Twilio (16-sep-2026) --
 * reemplaza a SimuladorNotificadorWhatsApp, que solo imprimía en consola.
 *
 * ⚠️ Corriendo hoy contra el WhatsApp Sandbox de Twilio (gratis, sin
 * necesitar todavía un número propio de Ecuador ni verificación de
 * negocio ante Meta) -- el sandbox solo entrega mensajes a números que
 * se unieron manualmente mandando el código "join ..." al número del
 * sandbox, y solo acepta texto libre (sin plantillas). Para producción
 * real con cualquier usuario de la plataforma, hace falta reemplazar
 * TWILIO_WHATSAPP_FROM por un número de WhatsApp Business propio ya
 * aprobado por Meta -- fuera de eso, este archivo no necesita cambiar.
 *
 * Requiere las variables de entorno TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 * y TWILIO_WHATSAPP_FROM (formato "whatsapp:+1XXXXXXXXXX").
 */
@Injectable()
export class TwilioNotificadorWhatsApp implements NotificadorWhatsApp {
  private readonly cliente: ReturnType<typeof Twilio>;
  private readonly remitente: string;

  constructor(config: ConfigService) {
    this.cliente = Twilio(
      config.getOrThrow<string>('TWILIO_ACCOUNT_SID'),
      config.getOrThrow<string>('TWILIO_AUTH_TOKEN'),
    );
    this.remitente = config.getOrThrow<string>('TWILIO_WHATSAPP_FROM');
  }

  private async enviar(telefono: string, texto: string): Promise<void> {
    await this.cliente.messages.create({
      from: this.remitente,
      to: `whatsapp:${aE164Ecuador(telefono)}`,
      body: texto,
    });
  }

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
    await this.enviar(
      telefono,
      `🚌 *Klumbus* — Recordatorio de tu viaje\n${detalle.origenCiudad} → ${detalle.destinoCiudad}\n📅 ${detalle.fechaSalida}\n\n¡No llegues tarde!`,
    );
  }

  async enviarAvisoCambioOperativo(
    telefono: string,
    detalle: { viajeId: string; motivo: string },
  ): Promise<void> {
    await this.enviar(
      telefono,
      `⚠️ *Klumbus* — Aviso importante sobre tu viaje\n${detalle.motivo}`,
    );
  }

  async enviarAvisoLlegada(
    telefono: string,
    detalle: { viajeId: string; destinoCiudad: string },
  ): Promise<void> {
    await this.enviar(
      telefono,
      `📍 *Klumbus* — Tu bus está llegando a ${detalle.destinoCiudad}. No olvides tus pertenencias.`,
    );
  }

  async enviarSolicitudCalificacion(
    telefono: string,
    detalle: { viajeId: string; destinoCiudad: string },
  ): Promise<void> {
    await this.enviar(
      telefono,
      `⭐ *Klumbus* — ¿Cómo estuvo tu viaje a ${detalle.destinoCiudad}? Calificalo en la app y ayudanos a mejorar.`,
    );
  }
}
