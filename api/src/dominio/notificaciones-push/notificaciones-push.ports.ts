/**
 * Notificaciones push de la app móvil (oct-2026). Es un canal más, aparte del correo y WhatsApp:
 * no reemplaza ningún aviso, solo llega además al teléfono de quien tiene cuenta y la app instalada.
 * Nunca debe afectar la operación que lo dispara (compra, pago, reclamo): un fallo se registra y se sigue.
 */
export interface MensajePush {
  titulo: string;
  cuerpo: string;
  /** Datos que la app usa al tocar el aviso para abrir la pantalla correcta (`tipo` y los ids). */
  datos?: Record<string, string>;
}

export type PlataformaPush = 'android' | 'ios';

export interface DispositivosPushRepositorio {
  /** Registra el teléfono para la cuenta; si el token ya existía (otra cuenta o inactivo) pasa a esta. */
  registrar(
    usuarioId: string,
    token: string,
    plataforma: PlataformaPush,
  ): Promise<void>;
  /** Da de baja el token de esa cuenta (cierre de sesión en la app). */
  eliminar(usuarioId: string, token: string): Promise<void>;
  listarTokensActivos(usuarioId: string): Promise<string[]>;
  desactivar(tokens: string[]): Promise<void>;
  /** Cuenta del comprador de una compra; null si fue una venta sin cuenta (invitado o ventanilla). */
  obtenerUsuarioDeCompra(compraId: string): Promise<string | null>;
  /** Cuenta del comprador al que pertenece un pago; null si no tiene cuenta o el pago no existe. */
  obtenerUsuarioDePago(pagoId: string): Promise<string | null>;
}

export interface EnviadorPush {
  /** Devuelve los tokens que el proveedor reporta como ya no válidos (app desinstalada, etc.). */
  enviar(
    tokens: string[],
    mensaje: MensajePush,
  ): Promise<{ tokensInvalidos: string[] }>;
}
