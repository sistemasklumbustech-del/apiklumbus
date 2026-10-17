import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type {
  DispositivosPushRepositorio,
  EnviadorPush,
  MensajePush,
  PlataformaPush,
} from '../../dominio/notificaciones-push/notificaciones-push.ports';

export const DISPOSITIVOS_PUSH_REPOSITORIO = 'DISPOSITIVOS_PUSH_REPOSITORIO';
export const ENVIADOR_PUSH = 'ENVIADOR_PUSH';

/** Token de Expo: `ExponentPushToken[xxxx]` (o el formato antiguo `ExpoPushToken[xxxx]`). */
const FORMATO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/;

@Injectable()
export class NotificacionesPushService {
  private readonly logger = new Logger(NotificacionesPushService.name);

  constructor(
    @Inject(DISPOSITIVOS_PUSH_REPOSITORIO)
    private readonly dispositivos: DispositivosPushRepositorio,
    @Inject(ENVIADOR_PUSH) private readonly enviador: EnviadorPush,
  ) {}

  async registrarDispositivo(
    usuarioId: string,
    token: string,
    plataforma: PlataformaPush,
  ): Promise<void> {
    if (!FORMATO_TOKEN.test(token)) {
      throw new BadRequestException('El token del dispositivo no es válido.');
    }
    await this.dispositivos.registrar(usuarioId, token, plataforma);
  }

  async eliminarDispositivo(usuarioId: string, token: string): Promise<void> {
    await this.dispositivos.eliminar(usuarioId, token);
  }

  /** Avisa a todos los teléfonos de una cuenta. Nunca lanza: un fallo de push no debe afectar nada más. */
  async enviarAUsuario(
    usuarioId: string | null | undefined,
    mensaje: MensajePush,
  ): Promise<void> {
    if (!usuarioId || process.env.PUSH_DESHABILITADO === '1') return;
    try {
      const tokens = await this.dispositivos.listarTokensActivos(usuarioId);
      if (tokens.length === 0) return;
      const { tokensInvalidos } = await this.enviador.enviar(tokens, mensaje);
      if (tokensInvalidos.length > 0)
        await this.dispositivos.desactivar(tokensInvalidos);
    } catch (error) {
      this.logger.warn(
        `No se pudo enviar el aviso push al usuario ${usuarioId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Avisa al comprador al que pertenece un pago (pago manual rechazado, por ejemplo). */
  async enviarAPago(pagoId: string, mensaje: MensajePush): Promise<void> {
    if (process.env.PUSH_DESHABILITADO === '1') return;
    try {
      await this.enviarAUsuario(
        await this.dispositivos.obtenerUsuarioDePago(pagoId),
        mensaje,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar por push el pago ${pagoId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Avisa al comprador de una compra, si tiene cuenta (una venta de invitado o ventanilla no tiene). */
  async enviarACompra(compraId: string, mensaje: MensajePush): Promise<void> {
    if (process.env.PUSH_DESHABILITADO === '1') return;
    try {
      await this.enviarAUsuario(
        await this.dispositivos.obtenerUsuarioDeCompra(compraId),
        mensaje,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar por push la compra ${compraId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
