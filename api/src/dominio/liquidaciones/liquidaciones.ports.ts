/**
 * Liquidaciones a cooperativas — RF-ADMIN-003, RN-007.
 *
 * Alcance de esta primera entrega (28-jul-2026): generar, listar y
 * marcar como pagada la liquidación de UNA cooperativa. Deliberadamente
 * fuera de esta entrega: liquidaciones de terminal (RF-ADMIN-006, tabla
 * separada por diseño — ver comentario en schema/liquidaciones.ts) y
 * ajustes manuales — se agregan en una segunda entrega, más chica,
 * después de confirmar que esta primera funciona bien en producción.
 */

export interface LiquidacionCooperativa {
  id: string;
  cooperativaId: string;
  periodoInicio: string; // YYYY-MM-DD
  periodoFin: string;
  montoVentasBruto: number;
  montoComisionPlataforma: number;
  montoAjustes: number;
  montoLiquidado: number;
  estado: 'pendiente' | 'pagada';
  pagadoEn: string | null;
  creadoEn: string;
}

export interface ResultadoGenerarLiquidacion {
  ok: true;
  liquidacion: LiquidacionCooperativa;
}

export interface ErrorGenerarLiquidacion {
  ok: false;
  motivo: string;
}

export interface LiquidacionesRepositorio {
  /**
   * Calcula y crea la liquidación de una cooperativa para un período.
   *
   * Modelo de negocio real (confirmado con el usuario, 28-jul-2026):
   * la plataforma NO cobra comisión porcentual sobre las ventas de la
   * cooperativa. Su único ingreso es el cargo fijo por boleto (ya
   * configurable en /admin/cargo-plataforma, cobrado aparte al
   * pasajero). La cooperativa recibe el 100% de su tarifa Y el 100% de
   * la tasa de abordaje (ella le compra ese saldo al terminal por
   * fuera de la plataforma — el terminal nunca le cobra directo al
   * pasajero).
   *
   * Reglas que debe cumplir la implementación:
   * - Solo cuenta boletos con estado 'vigente' o 'usado' — los
   *   'cancelado' no representan una venta real que liquidar.
   * - montoVentasBruto = (tarifa, excluyendo cargo fijo de plataforma
   *   e IVA) + (tasa de abordaje completa, vía comprobantes_tasa_terminal).
   * - montoLiquidado = montoVentasBruto, sin ningún descuento.
   * - Rechaza si ya existe una liquidación para esa cooperativa con un
   *   período que se solapa con el solicitado — evita pagar dos veces
   *   por las mismas ventas.
   */
  generarLiquidacionCooperativa(
    cooperativaId: string,
    periodoInicio: string,
    periodoFin: string,
  ): Promise<ResultadoGenerarLiquidacion | ErrorGenerarLiquidacion>;

  listarLiquidacionesCooperativa(
    cooperativaId?: string,
  ): Promise<LiquidacionCooperativa[]>;

  marcarLiquidacionPagada(
    id: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;
}
