/**
 * Programa de referidos "Invita y Gana" (13-ago-2026). Ver comentario
 * de diseño completo en packages/db/schema/referidos.ts.
 */
export interface ReferidosRepositorio {
  /**
   * Busca al usuario dueño de un código de pasajero (`COL-XXXXXX`) --
   * el mismo código que ya existe desde el ítem 3.1.1, reutilizado
   * como código de referido para no crear una columna nueva ni un
   * sistema de códigos separado. Trae la cédula también, para el
   * chequeo anti-fraude de autorreferido.
   */
  buscarUsuarioPorCodigoPasajero(
    codigo: string,
  ): Promise<{ id: string; cedula: string | null } | null>;

  crearRelacion(datos: {
    usuarioReferidorId: string;
    usuarioReferidoId: string;
  }): Promise<{ id: string }>;

  /**
   * La relación pendiente de DESCUENTO del propio referido -- para su
   * primera compra. `null` si nunca lo refirieron, o si ya consumió
   * su descuento antes.
   */
  obtenerRelacionPendienteDeDescuento(
    usuarioReferidoId: string,
  ): Promise<{ id: string } | null>;
  marcarDescuentoAplicado(relacionId: string): Promise<void>;

  /**
   * La relación pendiente de CRÉDITO del referidor -- se busca por el
   * id del usuario REFERIDO (el que acaba de validar su boleto), para
   * saber a quién acreditarle. `null` si esta persona nunca fue
   * referida, o si el crédito de esa relación ya se disparó antes.
   */
  obtenerRelacionPendienteDeCredito(
    usuarioReferidoId: string,
  ): Promise<{ id: string; usuarioReferidorId: string } | null>;
  marcarCreditoDisparado(relacionId: string, boletoId: string): Promise<void>;

  obtenerConfiguracion(): Promise<{
    creditoReferidor: number | null;
    descuentoReferido: number | null;
  }>;
  actualizarConfiguracion(
    datos: { creditoReferidor: number; descuentoReferido: number },
    actualizadoPorUsuarioId: string,
  ): Promise<void>;

  /**
   * Hallazgo real del director (15-ago-2026, recorrido en vivo de
   * producción): no existía NINGUNA forma de que el pasajero viera a
   * quién había referido -- solo la configuración de admin. Se
   * distingue si el crédito ya se disparó de verdad (boleto validado)
   * o sigue pendiente, y no revela nada del referido más allá de su
   * nombre -- ni correo, ni cédula, ni teléfono.
   */
  listarMisReferidos(usuarioReferidorId: string): Promise<
    {
      id: string;
      nombreReferido: string;
      creadoEn: string;
      creditoDisparado: boolean;
    }[]
  >;
}
