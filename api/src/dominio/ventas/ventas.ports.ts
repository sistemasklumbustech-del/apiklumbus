/**
 * Dominio de ventas — RF-CHECK, RN-001, RN-002.
 */

export type TipoTarifa = 'adulto' | 'nino' | 'tercera_edad' | 'discapacidad';

/**
 * RN-001 — tarifas diferenciadas (LOTTTSV Art. 79).
 *
 * ⚠ Para 'discapacidad' el descuento real va del 25% al 80% "según
 * porcentaje de discapacidad certificado por el CONADIS, verificable
 * mediante carnet" — este sistema todavía no captura ni verifica ese
 * carnet/porcentaje individual (no hay UI ni tabla para eso). Se usa
 * 50% como valor intermedio de marcador de posición, NO como el
 * descuento real que le corresponde a cada persona — dejar esto tal
 * cual sería incorrecto en producción real; hace falta construir la
 * verificación de carnet CONADIS antes de cerrar esto como resuelto.
 */
export function factorDescuento(tipoTarifa: TipoTarifa): number {
  switch (tipoTarifa) {
    case 'adulto':
      return 1;
    case 'nino':
      return 0.5;
    case 'tercera_edad':
      return 0.5;
    case 'discapacidad':
      return 0.5; // ⚠ placeholder, ver nota arriba — no es el valor real caso por caso.
  }
}

/** RF-MENOR-001 — detección de menor de edad por tarifa o fecha de nacimiento. */
export function esMenorDeEdad(
  tipoTarifa: TipoTarifa,
  fechaNacimiento: string | null | undefined,
): boolean {
  if (tipoTarifa === 'nino') return true;
  if (!fechaNacimiento) return false;
  const nacimiento = new Date(fechaNacimiento);
  const edadMs = Date.now() - nacimiento.getTime();
  const edadAnios = edadMs / (1000 * 60 * 60 * 24 * 365.25);
  return edadAnios < 18;
}

export interface AutorizacionMenor {
  tipoAcompanamiento: 'con_padre_madre_tutor' | 'con_autorizacion';
  adultoAcompananteIndice?: number;
  adultoResponsableNombre?: string;
  adultoResponsableDocumento?: string;
  adultoResponsableTelefono?: string;
  documentoAutorizacionUrl?: string;
}

export interface PasajeroCheckout {
  viajeId: string;
  numeroAsiento: string;
  /** Item 31.1, Fase 7 (13-ago-2026) -- separado en 2 campos reales, ver validadores-documento.ts. */
  nombres: string;
  apellidos: string;
  tipoDocumento: 'cedula' | 'pasaporte';
  documento: string;
  tipoTarifa: TipoTarifa;
  fechaNacimiento?: string;
  /** LOTTTSV Art. 48 -- atencion preferente, NO afecta tipoTarifa ni el precio. */
  esEmbarazada?: boolean;
  autorizacionMenor?: AutorizacionMenor;
  /** Discapacidad (13-ago-2026) -- numero de carne CONADIS/MSP o cedula, declarado, sin verificacion automatica. */
  numeroDocumentoDiscapacidad?: string;
}

export interface DesgloseAsiento {
  viajeId: string;
  numeroAsiento: string;
  cooperativaId: string;
  precioPagado: number;
  tasaTerminal: number;
  cargoPlataforma: number;
  /** Porción de precioPagado que corresponde a IVA — el precio YA lo trae incluido, esto es solo el desglose informativo. */
  ivaMonto: number;
  /** Si la cooperativa decide mostrar el desglose de IVA en el boleto (puede pagarlo igual y no mostrarlo). */
  ivaVisible: boolean;
  /** Correccion real 18-ago-2026 -- el pasajero no sabia que su asiento era VIP. */
  esVip: boolean;
}

export interface ResultadoPago {
  aprobado: boolean;
  referenciaExterna: string;
  motivoRechazo?: string;
}

/** Puerto hacia la pasarela de pago — la capa de infra decide el proveedor real. */
export interface PasarelaPago {
  procesar(montoTotal: number, idempotencyKey: string): Promise<ResultadoPago>;
}

export interface BoletoEmitido {
  id: string;
  codigoQr: string;
  numeroAsiento: string;
  precioPagado: number;
  tasaTerminal: number;
  cargoPlataforma: number;
  ivaMonto: number;
  // Hallazgo real del director (15-ago-2026, recorrido en vivo de
  // producción): el boleto/confirmación no mostraba nada de esto.
  cooperativaNombre: string;
  rutaOrigenCiudad: string;
  rutaDestinoCiudad: string;
  fechaSalida: string;
  horaSalidaProgramada: string;
  unidadPlaca: string | null;
  unidadIdentificador: string | null;
  compradorNombre: string;
  compradorDocumento: string | null;
  /** Correccion real 18-ago-2026 -- el pasajero no sabia que su asiento era VIP. */
  esVip: boolean;
}

/**
 * Vacío real de diseño encontrado el 29-jul-2026: el crédito de
 * reprogramación existía en el backend desde el 28-jul, pero el
 * pasajero no tenía ningún lugar donde consultar su saldo.
 */
export interface CreditoPasajero {
  id: string;
  cooperativaId: string;
  cooperativaNombre: string;
  monto: number;
  usadoEn: string | null;
  creadoEn: string;
}

/** Métodos de pago manuales (29-jul-2026) -- lo que la cooperativa ve para confirmar/rechazar un pago. */
export interface PagoManualPendiente {
  pagoId: string;
  compraId: string;
  proveedor: string;
  monto: number;
  comprobanteUrl: string | null;
  compradorNombre: string;
  creadoEn: string;
}

/** Solicitud de factura del pasaje (29-jul-2026) -- ver solicitudes-factura.ts. */
export interface SolicitudFactura {
  id: string;
  boletoId: string;
  estado: 'pendiente' | 'emitida';
  datosTributarios: Record<string, string>;
  urlFactura: string | null;
  pasajeroNombre: string;
  creadoEn: string;
}

export interface PagoExistente {
  compraId: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'revertido';
  boletos: BoletoEmitido[];
}

export interface MapeoAsientoPasajero {
  viajeId: string;
  numeroAsiento: string;
  pasajeroCompraId: string;
  cooperativaId: string;
  precioPagado: number;
  tasaTerminal: number;
  cargoPlataforma: number;
  ivaMonto: number;
  esVip: boolean;
}

export interface CompraRepositorio {
  /** RF-CHECK-005 — idempotencia: si ya existe un pago con esta clave, devuelve su resultado sin reprocesar. */
  buscarPagoPorIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PagoExistente | null>;

  /**
   * Verifica que cada asiento esté bloqueado por este usuario y su hold
   * no haya expirado, y devuelve el desglose de precio de cada uno.
   * Lanza si algún asiento no es válido para este checkout.
   */
  /**
   * Item 31, Fase 7 (11-ago-2026) -- compra como invitado. usuarioId es
   * null para un invitado -- el dueno del hold se reconoce entonces por
   * sesionInvitadoId en su lugar.
   */
  validarYCalcularAsientos(
    asientos: PasajeroCheckout[],
    usuarioId: string | null,
    sesionInvitadoId: string | null,
  ): Promise<DesgloseAsiento[]>;

  /**
   * Crea compra + pasajeros_compra + fila de pago en estado 'pendiente'.
   * Item 31, Fase 7 (11-ago-2026) -- telefonoContacto/correoContacto
   * solo se usan cuando usuarioId es null (compra como invitado).
   */
  crearCompraPendiente(
    usuarioId: string | null,
    pasajeros: PasajeroCheckout[],
    desglose: DesgloseAsiento[],
    idempotencyKey: string,
    /** Métodos de pago manuales (29-jul-2026) -- default 'simulado' para no romper el checkout con tarjeta ya existente. */
    proveedor?: string,
    telefonoContacto?: string,
    correoContacto?: string,
  ): Promise<{ compraId: string; mapeo: MapeoAsientoPasajero[] }>;

  /**
   * Métodos de pago manuales (29-jul-2026) -- mientras no hay pasarela
   * real conectada, el pasajero paga por fuera (transferencia,
   * efectivo, DeUna, PayPhone) y sube un comprobante; la cooperativa
   * confirma o rechaza desde su panel. Mismo patrón que
   * Tiendanube/Billowshop, investigado antes de construir.
   */
  verificarMetodoPagoActivo(cooperativaId: string, tipo: string): Promise<boolean>;

  /**
   * Convierte el bloqueo temporal corto (minutos, pensado para pago
   * con tarjeta) en una reserva de largo plazo que NO expira sola --
   * necesario porque revisar un comprobante puede tardar horas, no
   * minutos. El asiento queda tomado hasta que la cooperativa
   * confirme o rechace.
   */
  marcarAsientosPendientesConfirmacionPago(
    mapeo: MapeoAsientoPasajero[],
  ): Promise<void>;

  adjuntarComprobante(
    compraId: string,
    usuarioId: string,
    comprobanteUrl: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;

  listarPagosPendientesConfirmacion(
    cooperativaId: string,
  ): Promise<PagoManualPendiente[]>;

  /** Atómico -- mismo patrón que los demás flujos de dinero de este proyecto. */
  confirmarPagoManual(
    pagoId: string,
    cooperativaId: string,
    confirmadoPorUsuarioId: string,
  ): Promise<
    | { ok: true; compraId: string; montoCargoPlataforma: number }
    | { ok: false; motivo: string }
  >;

  rechazarPagoManual(
    pagoId: string,
    cooperativaId: string,
    motivo: string | undefined,
    confirmadoPorUsuarioId: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;

  /**
   * Confirma el pago: marca los asientos como ocupados, crea los
   * boletos con QR y el comprobante de tasa de terminal, y actualiza el
   * pago a 'aprobado'. Agrupa las escrituras por cooperativa
   * internamente (una compra puede, en teoría, involucrar más de una).
   */
  confirmarPago(
    compraId: string,
    referenciaExterna: string,
    mapeo: MapeoAsientoPasajero[],
  ): Promise<{ boletos: BoletoEmitido[] }>;

  /** Registra el rechazo sin tocar los asientos (su hold expira solo). */
  rechazarPago(compraId: string, motivo: string): Promise<void>;

  /**
   * Cancela un boleto propio — hallazgo real 22-jul-2026: antes no
   * existía NINGUNA forma de cancelar un boleto ya comprado, ni
   * siquiera manualmente. No procesa reembolso real (los pagos hoy son
   * simulados, no hay dinero real que devolver) — libera el asiento
   * (vuelve a 'disponible', comprable por otro pasajero) y marca el
   * boleto como 'cancelado'.
   */
  /** Recibo completo de una compra -- solo si le pertenece al usuario. */
  obtenerReciboCompra(
    compraId: string,
    usuarioId: string,
  ): Promise<ReciboCompra | null>;

  cancelarBoleto(
    boletoId: string,
    usuarioId: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;

  /**
   * Reprogramación con crédito (Fase C, 29-jul-2026). Devuelve null si
   * el boleto no existe o no le pertenece al usuario.
   */
  obtenerDetalleBoletoParaReprogramar(
    boletoId: string,
    usuarioId: string,
  ): Promise<{
    estado: string;
    viajeAsientoId: string;
    horaSalidaProgramada: string | Date;
    cooperativaId: string;
    precioPagado: number;
    tasaTerminal: number;
    pasajeroCompraId: string;
    nombres: string;
    apellidos: string;
    tipoDocumento: 'cedula' | 'pasaporte';
    documento: string;
    tipoTarifa: TipoTarifa;
    fechaNacimiento: string | null;
  } | null>;

  /**
   * Política de reprogramación por cooperativa (29-jul-2026, hallazgo
   * real): algunas cooperativas no permiten reprogramar en absoluto,
   * separado de si permiten cancelar (son decisiones de negocio
   * distintas -- cancelar es una venta perdida, reprogramar no).
   */
  obtenerHorasLimiteReprogramacion(
    cooperativaId: string,
  ): Promise<{ permitido: boolean; horas: number }>;

  cancelarBoletoPorReprogramacion(
    boletoId: string,
    viajeAsientoId: string,
  ): Promise<void>;

  crearCreditoPasajero(
    usuarioId: string,
    cooperativaId: string,
    monto: number,
    boletoOrigenId: string,
  ): Promise<void>;

  /**
   * Vacío real de diseño encontrado el 29-jul-2026: el crédito de
   * reprogramación existía en el backend desde el 28-jul, pero el
   * pasajero no tenía ningún lugar donde consultar su saldo.
   */
  listarCreditosUsuario(usuarioId: string): Promise<CreditoPasajero[]>;

  /**
   * Métodos de pago manuales (29-jul-2026) -- lo que el pasajero ve al
   * pagar, sin necesitar acceso al panel de esa cooperativa (a
   * diferencia de listarMetodosPago en panel-empresa, que es solo para
   * la propia cooperativa administrarlos).
   */
  listarMetodosPagoActivosPorViaje(
    viajeId: string,
  ): Promise<Array<{ tipo: string; datosCuenta: Record<string, string> }>>;

  /** Facturación electrónica del servicio de Colombus (29-jul-2026) -- ver dominio/facturacion/facturacion.ports.ts. */
  obtenerDatosFiscalesPlataforma(): Promise<{ ruc: string; razonSocial: string }>;
  crearComprobantePlataforma(
    compraId: string,
    montoComprobante: number,
    rucEmisor: string,
    resultado: {
      claveAcceso?: string;
      numeroAutorizacion?: string;
      xmlUrl?: string;
      pdfUrl?: string;
      exitoso: boolean;
      error?: string;
    },
  ): Promise<void>;

  /**
   * Solicitud de factura del pasaje (29-jul-2026) -- puente con la
   * cooperativa (ella emite en su propio sistema, ver
   * solicitudes-factura.ts para el contexto completo). Distinto de la
   * factura del servicio de Colombus (arriba).
   */
  solicitarFacturaCooperativa(
    boletoId: string,
    usuarioId: string,
    datosTributarios: Record<string, string>,
  ): Promise<{ ok: true; id: string } | { ok: false; motivo: string }>;
  listarSolicitudesFactura(cooperativaId: string): Promise<SolicitudFactura[]>;
  marcarFacturaEmitida(
    solicitudId: string,
    cooperativaId: string,
    urlFactura: string | undefined,
  ): Promise<{ ok: true } | { ok: false; motivo: string }>;

  /**
   * Consumir un crédito en una compra nueva (29-jul-2026) — cierra el
   * ciclo: hasta ahora el crédito solo se generaba, nunca se podía
   * gastar. En dos pasos porque el monto a descontar hay que conocerlo
   * ANTES de cobrar, pero el boleto (para vincular el crédito) recién
   * existe DESPUÉS de que el pago se aprueba.
   */
  obtenerCreditoParaUsar(
    creditoId: string,
    usuarioId: string,
    cooperativaId: string,
  ): Promise<{ monto: number } | null>;

  /** Atómico (mismo patrón que los tokens de un solo uso) — evita que se use dos veces por una carrera. */
  marcarCreditoUsado(creditoId: string, boletoUsadoId: string): Promise<boolean>;

  /** 27-jul-2026 -- controla como se muestra el IVA al pasajero en el checkout. */
  obtenerModoIvaBoleto(): Promise<'calculado' | 'cero' | 'oculto'>;

  /**
   * Contacto de soporte global (13-ago-2026) -- usado en el pie de
   * página del boleto PDF. Mismo patrón que obtenerModoIvaBoleto: el
   * checkout lee configuracion_plataforma directo, sin depender de
   * AdminService (evita una dependencia cruzada entre módulos que no
   * tiene sentido real -- ventas no debería necesitar todo admin solo
   * para leer 2 columnas).
   */
  obtenerContactoSoporte(): Promise<{ correo: string | null; telefono: string | null }>;

  /** Registra y envia (via NotificadorEmail) la confirmacion de una compra ya aprobada. Nunca lanza -- si falla, queda registrado como fallido, sin afectar la venta. */
  notificarCompraConfirmada(
    compraId: string,
    montoTotal: number,
    cantidadBoletos: number,
  ): Promise<void>;

  /**
   * Ítem 13, Fase 2 (05-ago-2026) -- descarga de boleto en PDF.
   * Reubicado 13-ago-2026 (auditoría, hallazgo de organización): vivía
   * en CalificacionesRepositorio, sin relación real con calificaciones
   * -- ahora vive donde pertenece de verdad.
   *
   * Ampliado 13-ago-2026 (rediseño premium tipo pase de abordar) con
   * los campos reales que ya existían en el esquema pero no se traían:
   * tipoDocumento/documento/tipoTarifa (ítem 31.1), ivaMonto (ya vivía
   * en boletos, nunca se exponía en el PDF), nombre real de las 2
   * terminales (puntosOperacion.nombre, separado de ciudad desde el
   * inicio), y las políticas de cancelación/reprogramación de la
   * cooperativa (mismos campos que ya usa el checkout para avisar
   * ANTES de comprar -- aquí se reutilizan, no se duplican).
   *
   * Null si el boleto no existe o no le pertenece a quien lo pide --
   * el service lo traduce a un 403, no a un 404 (no revela si el
   * boleto existe o no).
   */
  obtenerDatosBoletoParaPdf(
    boletoId: string,
    usuarioId: string,
  ): Promise<{
    codigoQr: string;
    estado: string;
    precioPagado: number;
    ivaMonto: number;
    pasajeroNombre: string;
    tipoDocumento: string;
    documento: string;
    tipoTarifa: string;
    numeroAsiento: string;
    cooperativaNombre: string;
    origenNombre: string;
    origenCiudad: string;
    destinoNombre: string;
    destinoCiudad: string;
    fechaSalida: string;
    horaSalidaProgramada: Date;
    permiteCancelacion: boolean;
    horasLimiteCancelacion: number | null;
    permiteReprogramacion: boolean;
    horasLimiteReprogramacion: number | null;
    unidadIdentificador: string | null;
    compradorNombre: string;
    compradorDocumento: string | null;
    /** Correccion real 18-ago-2026 -- el pasajero no sabia que su asiento era VIP. */
    esVip: boolean;
  } | null>;
}

export interface DetalleBoletoRecibo {
  boletoId: string;
  codigoQr: string;
  numeroAsiento: string;
  precioPagado: number;
  estado: string;
  pasajeroNombre: string;
  pasajeroDocumento: string;
  cooperativaNombre: string;
  rutaOrigenCiudad: string;
  rutaDestinoCiudad: string;
  fechaSalida: string;
  horaSalidaProgramada: string;
}

export interface ReciboCompra {
  compraId: string;
  montoTotal: number;
  montoTarifasCooperativa: number;
  montoCargoPlataforma: number;
  montoTasaTerminal: number;
  montoImpuestos: number;
  ivaVisible: boolean;
  pagoProveedor: string;
  pagoEstado: string;
  boletos: DetalleBoletoRecibo[];
}
