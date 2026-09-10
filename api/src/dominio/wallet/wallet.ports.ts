/**
 * Wallet / cashback -- Fase 1 (13-ago-2026): ganar y consultar saldo.
 * Fase 2 (13-ago-2026): gastar el saldo en una compra. Ver comentario
 * de diseño completo en packages/db/schema/wallet.ts sobre por qué es
 * un historial de movimientos y no un solo saldo acumulado, y por qué
 * no tiene política RLS.
 */
export interface WalletRepositorio {
  /**
   * Crea un movimiento -- crédito o débito, según `tipo`. Ya era
   * genérico desde la Fase 1 (el parámetro `tipo` siempre fue libre),
   * pero se renombra de `crearMovimientoCredito` a `crearMovimiento`
   * en la Fase 2 para que el nombre no mienta ahora que también se usa
   * para 'debito_compra' -- no cambia ningún comportamiento, solo el
   * nombre.
   */
  crearMovimiento(datos: {
    usuarioId: string;
    monto: number;
    tipo: string;
    // Programa de referidos (13-ago-2026) -- el crédito del referidor
    // no viene de una compra propia (viene del viaje de su amigo), así
    // que compraId pasa a ser opcional -- antes era obligatorio porque
    // los únicos 2 tipos que existían (cashback, débito de compra)
    // siempre tenían una compra de origen real.
    compraId?: string;
  }): Promise<{ id: string }>;

  /**
   * Saldo real, Fase 2 -- ahora resta los débitos (gastos de wallet en
   * una compra), no solo suma créditos. Los créditos siguen expirando
   * a los `diasVigencia` días (180, ClickBus, calculado directo en la
   * consulta); los débitos NUNCA expiran -- un débito representa saldo
   * ya gastado de verdad, no debe "volver a aparecer" solo porque pasó
   * tiempo.
   */
  saldoDeUsuario(usuarioId: string, diasVigencia: number): Promise<number>;

  /**
   * Hallazgo real del director (15-ago-2026, recorrido en vivo de
   * producción): el pasajero podía ver SU SALDO, pero nunca de dónde
   * salió -- ni un solo movimiento. Historial real, más reciente
   * primero, con el tipo de movimiento tal cual (para que el frontend
   * decida cómo etiquetarlo -- cashback vs. crédito de referido vs.
   * gasto, sin duplicar esa lógica aquí).
   */
  listarMovimientosDeUsuario(
    usuarioId: string,
  ): Promise<
    { id: string; monto: number; tipo: string; creadoEn: string }[]
  >;

  /** Configuración global -- mismo patrón que cargoPlataformaPorPasajeroDefault. */
  obtenerCashbackPorcentajeDefault(): Promise<number | null>;
  actualizarCashbackPorcentajeDefault(
    porcentaje: number,
    actualizadoPorUsuarioId: string,
  ): Promise<void>;
}
