import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WalletRepositorio } from '../../dominio/wallet/wallet.ports';

export const WALLET_REPOSITORIO = 'WALLET_REPOSITORIO';

/** Mismo plazo real que ClickBus (CashBus), decisión del director. */
const DIAS_VIGENCIA_CASHBACK = 180;

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @Inject(WALLET_REPOSITORIO)
    private readonly wallet: WalletRepositorio,
  ) {}

  /**
   * Disparado desde PanelEmpresaService.validarBoletoPorQr, justo
   * después de que el boleto ya pasó a 'usado' de verdad -- nunca
   * antes. Solo si el comprador tiene cuenta real (compradorUsuarioId
   * no nulo); un invitado no participa, mismo criterio que ClickBus.
   *
   * Nunca lanza -- un fallo al acreditar cashback no debe revertir ni
   * bloquear la validación del boleto en el andén, que ya ocurrió de
   * verdad (mismo criterio que notificarCompraConfirmada y el
   * despachador de webhooks: la acción principal ya es irreversible,
   * un efecto secundario que falla se registra, no se propaga).
   *
   * Idempotencia real: no se necesita ningún control explícito aquí
   * porque el propio UPDATE de validarBoletoPorQr ya usa
   * `WHERE estado = 'vigente'` -- un boleto no puede pasar a 'usado'
   * dos veces, así que este método tampoco puede ejecutarse dos veces
   * para el mismo boleto en el flujo normal.
   */
  async acreditarCashbackPorValidacion(datos: {
    compradorUsuarioId: string | null;
    compraId: string;
    precioPagado: number;
  }): Promise<void> {
    if (!datos.compradorUsuarioId) return; // invitado -- no participa, mismo criterio que ClickBus

    try {
      const porcentaje = await this.wallet.obtenerCashbackPorcentajeDefault();
      if (!porcentaje || porcentaje <= 0) return; // 0% por defecto hasta que el director decida el número real

      const monto = Math.round(((datos.precioPagado * porcentaje) / 100) * 100) / 100;
      if (monto <= 0) return;

      await this.wallet.crearMovimiento({
        usuarioId: datos.compradorUsuarioId,
        monto,
        tipo: 'credito_cashback',
        compraId: datos.compraId,
      });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error desconocido';
      this.logger.error(`No se pudo acreditar cashback de la compra ${datos.compraId}: ${mensaje}`);
    }
  }

  async saldo(usuarioId: string): Promise<{ saldo: number }> {
    const saldo = await this.wallet.saldoDeUsuario(usuarioId, DIAS_VIGENCIA_CASHBACK);
    return { saldo };
  }

  /**
   * Hallazgo real del director (15-ago-2026, recorrido en vivo de
   * producción): el pasajero podía ver su saldo, pero nunca de dónde
   * venía.
   */
  async movimientos(
    usuarioId: string,
  ): Promise<{ id: string; monto: number; tipo: string; creadoEn: string }[]> {
    return this.wallet.listarMovimientosDeUsuario(usuarioId);
  }

  /**
   * Fase 2 (13-ago-2026) -- versión cruda del saldo, para uso interno
   * de CheckoutService (necesita el número, no el `{ saldo }` envuelto
   * que expone el endpoint HTTP).
   */
  async saldoDisponible(usuarioId: string): Promise<number> {
    return this.wallet.saldoDeUsuario(usuarioId, DIAS_VIGENCIA_CASHBACK);
  }

  /**
   * Fase 2 (13-ago-2026) -- gastar el saldo en una compra. Se llama
   * desde CheckoutService justo después de que el pago se aprobó
   * (nunca antes -- si el pago se rechaza, no se llama a este método,
   * el saldo del wallet queda intacto).
   *
   * Igual que acreditarCashbackPorValidacion, nunca lanza -- se
   * consideró dejarlo lanzar (esto es dinero real, no un efecto
   * cosmético como una notificación), pero para cuando este método se
   * llama la compra YA está confirmada: pago aprobado, boletos ya
   * emitidos, pasajero ya notificado. Revertir todo eso por un fallo
   * al registrar el débito sería peor que el problema que se intenta
   * evitar. Se registra con un mensaje de error más urgente que el de
   * cashback (menciona explícitamente que el saldo queda inflado),
   * para que sea fácil de encontrar en los logs y corregir a mano.
   */
  async debitarPorCompra(datos: {
    usuarioId: string;
    monto: number;
    compraId: string;
  }): Promise<void> {
    if (datos.monto <= 0) return;
    try {
      await this.wallet.crearMovimiento({
        usuarioId: datos.usuarioId,
        monto: datos.monto,
        tipo: 'debito_compra',
        compraId: datos.compraId,
      });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error desconocido';
      this.logger.error(
        `No se pudo registrar el débito de wallet de la compra ${datos.compraId} (usuario ${datos.usuarioId}, monto ${datos.monto}) -- el saldo mostrado quedará inflado hasta corregirlo a mano: ${mensaje}`,
      );
    }
  }

  async obtenerCashbackPorcentajeDefault(): Promise<number> {
    return (await this.wallet.obtenerCashbackPorcentajeDefault()) ?? 0;
  }

  async actualizarCashbackPorcentajeDefault(porcentaje: number, usuarioId: string): Promise<void> {
    await this.wallet.actualizarCashbackPorcentajeDefault(porcentaje, usuarioId);
  }

  /**
   * Programa de referidos (13-ago-2026) -- crédito al referidor,
   * llamado desde ReferidosService.acreditarReferidorPorValidacion.
   * A diferencia de los créditos/débitos anteriores, este no tiene una
   * compra de origen propia del usuario que lo recibe (viene del viaje
   * de su amigo referido) -- compraId queda sin enviar a propósito.
   * No envuelve en try/catch aquí -- ReferidosService ya lo hace
   * alrededor de toda la operación (crear el movimiento + marcar la
   * relación), mismo criterio de "nunca lanza" pero manejado un nivel
   * arriba para que ambos pasos se traten como una sola unidad.
   */
  async crearMovimientoDeReferido(datos: { usuarioId: string; monto: number }): Promise<void> {
    if (datos.monto <= 0) return;
    await this.wallet.crearMovimiento({
      usuarioId: datos.usuarioId,
      monto: datos.monto,
      tipo: 'credito_referido',
    });
  }
}
