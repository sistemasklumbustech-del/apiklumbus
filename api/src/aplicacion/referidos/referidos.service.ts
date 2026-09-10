import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ReferidosRepositorio } from '../../dominio/referidos/referidos.ports';
import { WalletService } from '../wallet/wallet.service';

export const REFERIDOS_REPOSITORIO = 'REFERIDOS_REPOSITORIO';

@Injectable()
export class ReferidosService {
  private readonly logger = new Logger(ReferidosService.name);

  constructor(
    @Inject(REFERIDOS_REPOSITORIO)
    private readonly referidos: ReferidosRepositorio,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Llamado desde AuthService.registrar(), justo después de crear la
   * cuenta nueva. Nunca lanza -- un código de referido inválido o
   * fraudulento no debe impedir que alguien se registre, que es la
   * acción principal (mismo criterio de "nunca bloquear la acción
   * principal por un efecto secundario" que el resto del proyecto).
   *
   * Decisión reportada: código no encontrado -- se ignora en silencio
   * (probablemente un typo, no vale la pena molestar al usuario nuevo
   * con un error por esto). Autorreferido detectado por cédula -- se
   * ignora en silencio también (no se crea la relación, pero el
   * registro continúa normal) en vez de rechazar el registro completo
   * -- bloquear la creación de una cuenta por un intento de fraude en
   * un campo aparte sería una respuesta desproporcionada.
   */
  async registrarReferido(datos: {
    codigoReferido: string;
    usuarioReferidoId: string;
    cedulaReferido: string | null;
  }): Promise<void> {
    try {
      const referidor = await this.referidos.buscarUsuarioPorCodigoPasajero(
        datos.codigoReferido,
      );
      if (!referidor) {
        this.logger.warn(`Código de referido "${datos.codigoReferido}" no existe -- ignorado.`);
        return;
      }

      // Anti-fraude (RF explícito de la orden): un usuario no puede
      // referirse a sí mismo. Chequeo por id (defensivo, en la
      // práctica el usuario referido es una cuenta recién creada, no
      // puede coincidir con una cuenta existente) y por cédula (el
      // caso real: la misma persona crea una segunda cuenta con otro
      // correo para autorreferirse y cobrar el crédito).
      if (referidor.id === datos.usuarioReferidoId) {
        this.logger.warn('Intento de autorreferido por mismo id de usuario -- ignorado.');
        return;
      }
      if (
        referidor.cedula &&
        datos.cedulaReferido &&
        referidor.cedula === datos.cedulaReferido
      ) {
        this.logger.warn(
          `Intento de autorreferido detectado por cédula coincidente (código "${datos.codigoReferido}") -- ignorado.`,
        );
        return;
      }

      await this.referidos.crearRelacion({
        usuarioReferidorId: referidor.id,
        usuarioReferidoId: datos.usuarioReferidoId,
      });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error desconocido';
      this.logger.error(`No se pudo registrar la relación de referido: ${mensaje}`);
    }
  }

  /**
   * Descuento de bienvenida -- solo si es la primera compra del
   * referido (relación con `descuento_aplicado_en` todavía nulo).
   * Usado por checkout.service.ts, mismo patrón que
   * WalletService.saldoDisponible (devuelve el número crudo, no
   * envuelto, para uso interno).
   */
  async descuentoDisponible(
    usuarioId: string,
  ): Promise<{ relacionId: string; monto: number } | null> {
    const relacion = await this.referidos.obtenerRelacionPendienteDeDescuento(usuarioId);
    if (!relacion) return null;

    const config = await this.referidos.obtenerConfiguracion();
    const monto = config.descuentoReferido ?? 0;
    if (monto <= 0) return null;

    return { relacionId: relacion.id, monto };
  }

  /**
   * Se llama SOLO después de que el pago se aprobó -- mismo criterio
   * que marcarCreditoUsado y debitarPorCompra en checkout.service.ts.
   * Nunca lanza, mismo motivo que debitarPorCompra: revertir una
   * compra ya confirmada sería peor que dejar una relación por marcar
   * a mano.
   */
  async marcarDescuentoConsumido(relacionId: string): Promise<void> {
    try {
      await this.referidos.marcarDescuentoAplicado(relacionId);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error desconocido';
      this.logger.error(
        `No se pudo marcar el descuento de referido como consumido (relación ${relacionId}): ${mensaje}`,
      );
    }
  }

  /**
   * Disparado desde PanelEmpresaService.validarBoletoPorQr, mismo
   * punto exacto y mismo criterio que
   * WalletService.acreditarCashbackPorValidacion -- justo después de
   * que el boleto del REFERIDO pasa a 'usado'. Nunca lanza.
   *
   * Idempotencia real: `obtenerRelacionPendienteDeCredito` solo
   * encuentra relaciones con `boleto_que_disparo_credito_id IS NULL`
   * -- una vez que se marca con el primer boleto, nunca vuelve a
   * aparecer, así que el amigo puede viajar 10 veces más sin que el
   * crédito se repita.
   */
  async acreditarReferidorPorValidacion(datos: {
    usuarioReferidoId: string | null;
    boletoId: string;
  }): Promise<void> {
    if (!datos.usuarioReferidoId) return; // invitado -- no puede haber sido "el referido" de nadie sin cuenta

    try {
      const relacion = await this.referidos.obtenerRelacionPendienteDeCredito(
        datos.usuarioReferidoId,
      );
      if (!relacion) return;

      const config = await this.referidos.obtenerConfiguracion();
      const monto = config.creditoReferidor ?? 0;
      if (monto <= 0) return;

      await this.wallet.crearMovimientoDeReferido({
        usuarioId: relacion.usuarioReferidorId,
        monto,
      });

      await this.referidos.marcarCreditoDisparado(relacion.id, datos.boletoId);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error desconocido';
      this.logger.error(
        `No se pudo acreditar el crédito de referido para el boleto ${datos.boletoId}: ${mensaje}`,
      );
    }
  }

  async obtenerConfiguracion(): Promise<{ creditoReferidor: number; descuentoReferido: number }> {
    const config = await this.referidos.obtenerConfiguracion();
    return {
      creditoReferidor: config.creditoReferidor ?? 0,
      descuentoReferido: config.descuentoReferido ?? 0,
    };
  }

  async actualizarConfiguracion(
    datos: { creditoReferidor: number; descuentoReferido: number },
    usuarioId: string,
  ): Promise<void> {
    await this.referidos.actualizarConfiguracion(datos, usuarioId);
  }

  /** Hallazgo real del director (15-ago-2026) -- el pasajero nunca
   * podía ver a quién había referido. */
  async misReferidos(
    usuarioId: string,
  ): Promise<{ id: string; nombreReferido: string; creadoEn: string; creditoDisparado: boolean }[]> {
    return this.referidos.listarMisReferidos(usuarioId);
  }
}
