import { Injectable, Logger } from '@nestjs/common';
import type { NotificadorEmail } from '../../dominio/auth/auth.ports';

/**
 * Notificador de correo simulado -- mismo criterio que
 * infraestructura/pagos/simulador.pasarela.ts: imprime en consola en vez
 * de enviar de verdad, para poder construir y probar el flujo completo
 * sin depender de una cuenta real de Resend todavia. Se reemplaza por la
 * integracion real al final, sin tocar nada del dominio ni la aplicacion.
 */
@Injectable()
export class SimuladorNotificador implements NotificadorEmail {
  private readonly logger = new Logger(SimuladorNotificador.name);

  async enviarResetPassword(correo: string, tokenPlano: string): Promise<void> {
    const link = `https://colombus.ec/restablecer?token=${tokenPlano}`;
    this.logger.log(
      `[SIMULADO] Correo de recuperacion para ${correo} -> ${link}`,
    );
  }

  async enviarConfirmacionCompra(
    correo: string,
    detalle: { compraId: string; montoTotal: number; cantidadBoletos: number },
  ): Promise<void> {
    this.logger.log(
      `[SIMULADO] Confirmacion de compra para ${correo} -> compra ${detalle.compraId}, ${detalle.cantidadBoletos} boleto(s), total $${detalle.montoTotal.toFixed(2)}`,
    );
  }

  async enviarVerificacionCorreo(correo: string, tokenPlano: string): Promise<void> {
    const link = `https://colombus.ec/verificar-correo?token=${tokenPlano}`;
    this.logger.log(
      `[SIMULADO] Correo de verificacion para ${correo} -> ${link}`,
    );
  }
}
