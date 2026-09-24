import { Inject, Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CompraRepositorio,
  PasajeroCheckout,
  PasarelaPago,
  MetodoPagoEnLinea,
  FiltrosSolicitudesFactura,
  FiltrosHistorialPagos,
} from '../../dominio/ventas/ventas.ports';
import { esMenorDeEdad } from '../../dominio/ventas/ventas.ports';
import type { AlmacenamientoArchivos } from '../../dominio/auth/auth.ports';
import { ALMACENAMIENTO_ARCHIVOS } from '../auth/auth.service';
import type { ProveedorFacturacionElectronica } from '../../dominio/facturacion/facturacion.ports';
import { DespachadorWebhooksService } from '../webhooks/despachador-webhooks.service';
import { WalletService } from '../wallet/wallet.service';
import { ReferidosService } from '../referidos/referidos.service';
import { TerminosService } from '../terminos/terminos.service';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {
  LOGO_BOLETO_PNG_BASE64,
  LOGO_BOLETO_PROPORCION,
} from './logo-boleto';
import { AuditoriaRegistrador } from '../../infraestructura/auditoria/auditoria.registrador';

export const COMPRA_REPOSITORIO = 'COMPRA_REPOSITORIO';
export const PASARELA_PAGO = 'PASARELA_PAGO';
export const PROVEEDOR_FACTURACION = 'PROVEEDOR_FACTURACION';

/**
 * Ítem 13, Fase 2 (05-ago-2026) -- descarga de boleto en PDF. Fecha
 * local Ecuador en ambos formateos, mismo criterio que el resto del
 * proyecto (America/Guayaquil, sin horario de verano). Reubicadas
 * 13-ago-2026 (auditoría) desde CalificacionesService -- mismo
 * comportamiento exacto, sin cambios funcionales.
 */
function formatearFechaBoleto(fechaSalida: string): string {
  return new Date(`${fechaSalida}T00:00:00`).toLocaleDateString('es-EC', {
    timeZone: 'America/Guayaquil',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatearHoraBoleto(hora: Date): string {
  return hora.toLocaleTimeString('es-EC', {
    timeZone: 'America/Guayaquil',
    hour: '2-digit',
    minute: '2-digit',
  });
}

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(COMPRA_REPOSITORIO) private readonly compras: CompraRepositorio,
    @Inject(PASARELA_PAGO) private readonly pasarela: PasarelaPago,
    @Inject(ALMACENAMIENTO_ARCHIVOS) private readonly almacenamiento: AlmacenamientoArchivos,
    @Inject(PROVEEDOR_FACTURACION) private readonly facturacion: ProveedorFacturacionElectronica,
    private readonly webhooks: DespachadorWebhooksService,
    private readonly wallet: WalletService,
    private readonly referidos: ReferidosService,
    private readonly terminos: TerminosService,
    private readonly auditoria: AuditoriaRegistrador,
  ) {}

  /**
   * RF-CHECK-001 a 005 completo: valida los asientos, calcula el
   * desglose (RN-001, RN-002), crea la compra pendiente, procesa el pago
   * (simulado -- ver infraestructura/pagos/simulador.pasarela.ts), y segun
   * el resultado confirma (genera boletos + QR, RF-TICKET) o rechaza
   * (deja el hold expirar solo, RF-CHECK-004: "sin bloquear el asiento
   * indefinidamente").
   */
  /**
   * RF-003 (hallazgo real, 17-sep-2026): antes no existía ninguna
   * forma de ver el desglose EXACTO antes de pagar -- procesarCompra
   * crea la orden y cobra en la misma llamada, así que el total
   * "antes de pagar" que veía el pasajero era, en el mejor de los
   * casos, una estimación. Esta cotización reutiliza el mismo cálculo
   * real de validarYCalcularAsientos (mismo precio, misma tasa, mismo
   * cargo de plataforma, mismo IVA que se cobraría de verdad) sin
   * crear ninguna compra ni tocar el pago -- solo lectura. El
   * frontend la usa para el modal de "revisa antes de confirmar", y
   * llama a procesarCompra/venderEnVentanilla recién después de que
   * el usuario confirma explícitamente.
   */
  async cotizarCompra(
    pasajeros: PasajeroCheckout[],
    usuarioId: string | null,
    sesionInvitadoId?: string,
  ) {
    const desglose = await this.compras.validarYCalcularAsientos(
      pasajeros,
      usuarioId,
      sesionInvitadoId ?? null,
    );
    const montoTarifasCooperativa = desglose.reduce((a, d) => a + d.precioPagado, 0);
    const montoTasaTerminal = desglose.reduce((a, d) => a + d.tasaTerminal, 0);
    const montoCargoPlataforma = desglose.reduce((a, d) => a + d.cargoPlataforma, 0);
    const montoImpuestos = desglose.reduce((a, d) => a + d.ivaMonto, 0);
    const montoTotal = montoTarifasCooperativa + montoTasaTerminal + montoCargoPlataforma;

    return {
      desglose,
      montoTarifasCooperativa: Number(montoTarifasCooperativa.toFixed(2)),
      montoTasaTerminal: Number(montoTasaTerminal.toFixed(2)),
      montoCargoPlataforma: Number(montoCargoPlataforma.toFixed(2)),
      montoImpuestos: Number(montoImpuestos.toFixed(2)),
      montoTotal: Number(montoTotal.toFixed(2)),
    };
  }

  // Item 31, Fase 7 (11-ago-2026) -- compra como invitado. Al menos
  // uno de usuarioId/telefonoContacto/correoContacto debe traer valor
  // (validado abajo).
  async procesarCompra(
    pasajeros: PasajeroCheckout[],
    usuarioId: string | null,
    idempotencyKeyCliente?: string,
    creditoIdAUsar?: string,
    telefonoContacto?: string,
    correoContacto?: string,
    sesionInvitadoId?: string,
    usarSaldoWallet?: boolean,
    aceptoTerminos?: boolean,
    direccionIp?: string,
    metodoPagoEnLinea: MetodoPagoEnLinea = 'tarjeta',
  ) {
    if (!usuarioId && !telefonoContacto && !correoContacto) {
      throw new BadRequestException(
        'Falta un telefono o correo de contacto -- sin cuenta ni contacto no hay forma de entregar el boleto.',
      );
    }

    // RF-024 -- solo se exige a quien compra como invitado; quien ya
    // tiene cuenta aceptó al registrarse (fail fast, antes de bloquear
    // asientos o cobrar nada).
    if (!usuarioId) {
      this.terminos.validarAceptada(!!aceptoTerminos);
    }

    // Wallet/cashback Fase 2 (13-ago-2026) -- investigado en los
    // Terminos de Uso reales de ClickBus (seccion 5.7.5.1): el saldo
    // de wallet no es acumulable con otra forma de descuento, el
    // cliente elige una de las 2.
    if (usarSaldoWallet && creditoIdAUsar) {
      throw new BadRequestException(
        'No se puede usar saldo de wallet junto con un crédito de reprogramación en la misma compra -- elige uno.',
      );
    }

    const idempotencyKey = idempotencyKeyCliente ?? randomUUID();

    // RF-CHECK-005 -- si esta misma clave ya se proceso antes (reintento
    // de red del cliente), se devuelve el resultado original en vez de
    // volver a cobrar.
    const existente =
      await this.compras.buscarPagoPorIdempotencyKey(idempotencyKey);
    if (existente) {
      return {
        compraId: existente.compraId,
        estado:
          existente.estado === 'aprobado'
            ? ('aprobado' as const)
            : ('rechazado' as const),
        boletos: existente.boletos,
        reintento: true,
      };
    }

    // RF-MENOR -- se valida ANTES de bloquear asientos o cobrar nada
    // (fail fast), no despues.
    for (let i = 0; i < pasajeros.length; i++) {
      const p = pasajeros[i];
      if (!esMenorDeEdad(p.tipoTarifa, p.fechaNacimiento)) continue;

      const auth = p.autorizacionMenor;
      if (!auth) {
        throw new BadRequestException(
          `El pasajero "${p.nombres} ${p.apellidos}" es menor de edad -- falta indicar como viaja acompanado (autorizacionMenor).`,
        );
      }
      if (auth.tipoAcompanamiento === 'con_padre_madre_tutor') {
        if (
          auth.adultoAcompananteIndice === undefined ||
          auth.adultoAcompananteIndice === i ||
          !pasajeros[auth.adultoAcompananteIndice]
        ) {
          throw new BadRequestException(
            `El pasajero "${p.nombres} ${p.apellidos}" debe indicar el indice de un adulto acompanante distinto, dentro de la misma compra.`,
          );
        }
        const adulto = pasajeros[auth.adultoAcompananteIndice];
        if (esMenorDeEdad(adulto.tipoTarifa, adulto.fechaNacimiento)) {
          throw new BadRequestException(
            `El acompanante indicado para "${p.nombres} ${p.apellidos}" tambien es menor de edad -- debe ser un adulto.`,
          );
        }
      } else if (auth.tipoAcompanamiento === 'con_autorizacion') {
        if (!auth.adultoResponsableNombre || !auth.adultoResponsableDocumento) {
          throw new BadRequestException(
            `El pasajero "${p.nombres} ${p.apellidos}" viaja con autorizacion -- falta el nombre y documento del adulto responsable.`,
          );
        }
      }
    }

    // Discapacidad, captura real (13-ago-2026) -- mismo criterio de
    // "fail fast" que RF-MENOR arriba: se valida ANTES de bloquear
    // asientos o cobrar nada. Solo exige la DECLARACIÓN del número de
    // documento -- nunca lo verifica contra ningún sistema del
    // CONADIS (no existe una API pública conocida para eso, y no es
    // parte de este alcance); la verificación real es física, en el
    // andén, por el personal de la cooperativa (ver
    // panel-empresa.repositorio.drizzle.ts::validarBoletoPorQr).
    for (const p of pasajeros) {
      if (p.tipoTarifa !== 'discapacidad') continue;
      if (!p.numeroDocumentoDiscapacidad?.trim()) {
        throw new BadRequestException(
          `El pasajero "${p.nombres} ${p.apellidos}" tiene tarifa de discapacidad -- falta el número de carné CONADIS/MSP o de cédula donde conste la condición.`,
        );
      }
    }

    const desglose = await this.compras.validarYCalcularAsientos(
      pasajeros,
      usuarioId,
      sesionInvitadoId ?? null,
    );
    const montoTotal = desglose.reduce(
      (acc, d) => acc + d.precioPagado + d.tasaTerminal + d.cargoPlataforma,
      0,
    );

    // Consumir un crédito en una compra nueva (29-jul-2026) — cierra el
    // ciclo que quedó a medias el 28-jul: el crédito solo se generaba,
    // nunca se podía gastar. Solo aplica si TODOS los asientos de esta
    // compra son de la misma cooperativa que emitió el crédito — un
    // crédito de la cooperativa A no puede usarse para pagarle a la B.
    let montoAPagar = montoTotal;
    let creditoAplicado = 0;
    if (creditoIdAUsar) {
      // Item 31, Fase 7 (11-ago-2026) -- un credito de reprogramacion
      // pertenece a una cuenta real -- un invitado no puede tener
      // ninguno que gastar.
      if (!usuarioId) {
        throw new BadRequestException(
          'No se puede usar un credito de reprogramacion sin una cuenta.',
        );
      }
      const cooperativasEnCompra = new Set(desglose.map((d) => d.cooperativaId));
      if (cooperativasEnCompra.size !== 1) {
        throw new BadRequestException(
          'No se puede usar un crédito en una compra que mezcla boletos de varias cooperativas.',
        );
      }
      const [cooperativaId] = cooperativasEnCompra;
      const credito = await this.compras.obtenerCreditoParaUsar(
        creditoIdAUsar,
        usuarioId,
        cooperativaId,
      );
      if (!credito) {
        throw new BadRequestException(
          'Este crédito no existe, ya se usó, o no corresponde a la cooperativa de este viaje.',
        );
      }
      creditoAplicado = Math.min(credito.monto, montoTotal);
      montoAPagar = Number((montoTotal - creditoAplicado).toFixed(2));
    }

    // Wallet/cashback Fase 2 (13-ago-2026) -- excluyente con el crédito
    // de arriba (ya validado al inicio del método). Un invitado no
    // tiene wallet -- se ignora en silencio, mismo criterio que ganar
    // cashback (WalletService.acreditarCashbackPorValidacion también
    // simplemente no hace nada para un invitado, sin lanzar error).
    // Decisión reportada: silencioso, no rechazo explícito, porque
    // "usarSaldoWallet: true" en una compra de invitado no es un error
    // del cliente -- el frontend simplemente no debería mostrar esa
    // opción sin sesión, y si igual llega, no tiene sentido bloquear
    // toda la compra por un campo que no aplica.
    let saldoWalletAplicado = 0;
    if (usarSaldoWallet && usuarioId) {
      const saldoDisponible = await this.wallet.saldoDisponible(usuarioId);
      saldoWalletAplicado = Math.min(saldoDisponible, montoTotal);
      montoAPagar = Number((montoTotal - saldoWalletAplicado).toFixed(2));
    }

    // Programa de referidos (13-ago-2026) -- descuento de bienvenida en
    // la PRIMERA compra del referido. Decisión de diseño, investigada y
    // reportada (la orden pedía decidir esto, no asumirlo): se trata
    // como la prioridad más baja de los 3 mecanismos de descuento, no
    // como un cuarto campo que el pasajero elige. Si ya pidió
    // explícitamente crédito de reprogramación o saldo de wallet, esa
    // elección explícita gana y el descuento de referido NO se aplica
    // en esa compra (sigue disponible para la próxima, nunca se marca
    // como consumido si no llegó a usarse). Si no pidió ninguno de los
    // 2, y es su primera compra como referido, se aplica solo -- nunca
    // se rechaza la compra con un 400 por esto, a diferencia de
    // wallet+crédito juntos, porque aquí no hay 2 elecciones explícitas
    // chocando, solo una elección explícita compitiendo con un
    // beneficio automático.
    let descuentoReferidoAplicado = 0;
    let relacionReferidoAAplicar: string | null = null;
    if (!creditoIdAUsar && !usarSaldoWallet && usuarioId) {
      const descuento = await this.referidos.descuentoDisponible(usuarioId);
      if (descuento) {
        descuentoReferidoAplicado = Math.min(descuento.monto, montoTotal);
        montoAPagar = Number((montoTotal - descuentoReferidoAplicado).toFixed(2));
        relacionReferidoAAplicar = descuento.relacionId;
      }
    }

    const { compraId, mapeo } = await this.compras.crearCompraPendiente(
      usuarioId,
      pasajeros,
      desglose,
      idempotencyKey,
      undefined,
      telefonoContacto,
      correoContacto,
    );

    if (!usuarioId) {
      await this.terminos.registrarAceptacion({ compraId, direccionIp });
    }

    const resultadoPago = await this.pasarela.procesar(
      montoAPagar,
      idempotencyKey,
      metodoPagoEnLinea,
    );

    if (!resultadoPago.aprobado) {
      await this.compras.rechazarPago(
        compraId,
        resultadoPago.motivoRechazo ?? 'Pago rechazado',
      );
      return {
        compraId,
        estado: 'rechazado' as const,
        motivo: resultadoPago.motivoRechazo ?? 'El pago fue rechazado.',
      };
    }

    const { boletos } = await this.compras.confirmarPago(
      compraId,
      resultadoPago.referenciaExterna,
      mapeo,
    );

    const cargoPlataformaTotal = desglose.reduce((acc, d) => acc + d.cargoPlataforma, 0);
    await this.generarFacturaPlataforma(compraId, cargoPlataformaTotal);

    // El crédito se marca usado DESPUÉS de que el pago se aprueba y el
    // boleto ya existe -- si el pago hubiera fallado, el crédito sigue
    // disponible para intentarlo de nuevo.
    if (creditoIdAUsar && boletos[0]) {
      await this.compras.marcarCreditoUsado(creditoIdAUsar, boletos[0].id);
    }

    // Wallet/cashback Fase 2 (13-ago-2026) -- mismo criterio exacto que
    // el crédito arriba: el débito se registra DESPUÉS de que el pago
    // se aprobó. Si el pago se hubiera rechazado, este bloque nunca se
    // ejecuta (el código ya salió con `return` en el bloque de rechazo,
    // más arriba) -- el saldo del wallet queda intacto.
    if (saldoWalletAplicado > 0 && usuarioId) {
      await this.wallet.debitarPorCompra({
        usuarioId,
        monto: saldoWalletAplicado,
        compraId,
      });
    }

    // Programa de referidos -- mismo criterio exacto que el crédito y
    // el débito de wallet: se marca consumido DESPUÉS de que el pago
    // se aprobó. Si el pago se hubiera rechazado, este bloque nunca se
    // ejecuta -- la relación sigue disponible para un intento futuro.
    if (relacionReferidoAAplicar) {
      await this.referidos.marcarDescuentoConsumido(relacionReferidoAAplicar);
    }

    const montoTotalNotif = mapeo.reduce(
      (acc, m) => acc + m.precioPagado + m.tasaTerminal + m.cargoPlataforma,
      0,
    );
    await this.enviarBoletosPorCorreo(compraId);

    // Modelo B (02-ago-2026) -- un webhook por cada cooperativa
    // involucrada en esta compra (una compra puede mezclar boletos de
    // varias). Nunca bloquea ni revierte la venta si falla -- mismo
    // criterio que generarFacturaPlataforma, arriba.
    const cooperativasEnVenta = new Set(desglose.map((d) => d.cooperativaId));
    for (const coopId of cooperativasEnVenta) {
      const boletosDeCoop = boletos.filter((_, i) => desglose[i]?.cooperativaId === coopId);
      await this.webhooks.dispararEventoVenta(coopId, compraId, {
        evento: 'venta_creada',
        compraId,
        boletos: boletosDeCoop,
      });
    }

    const ivaTotal = desglose.reduce((acc, d) => acc + d.ivaMonto, 0);
    // Si la compra mezcla boletos de cooperativas con distinta
    // configuracion de visibilidad, se prefiere mostrarlo (mas
    // transparente) en vez de ocultarlo por defecto.
    let ivaVisible = desglose.some((d) => d.ivaVisible);

    // 27-jul-2026 -- el valor REAL ya quedo calculado y persistido en
    // boletos.ivaMonto (dentro de confirmarPago, arriba). Esto solo
    // transforma lo que se le devuelve al pasajero en la respuesta,
    // segun el modo configurado desde el Panel Admin -- Colombus no
    // debe afirmar un IVA sobre la tarifa que no le corresponde
    // declarar legalmente (cada cooperativa maneja su propia relacion
    // con el SRI, de forma independiente).
    const modoIva = await this.compras.obtenerModoIvaBoleto();
    let ivaTotalRespuesta = Number(ivaTotal.toFixed(2));
    let boletosRespuesta = boletos;

    if (modoIva === 'cero') {
      ivaTotalRespuesta = 0;
      boletosRespuesta = boletos.map((b) => ({ ...b, ivaMonto: 0 }));
    } else if (modoIva === 'oculto') {
      ivaVisible = false;
    }

    return {
      compraId,
      estado: 'aprobado' as const,
      boletos: boletosRespuesta,
      montoTotal,
      montoPagado: montoAPagar,
      creditoAplicado,
      saldoWalletAplicado,
      descuentoReferidoAplicado,
      ivaTotal: ivaTotalRespuesta,
      ivaVisible,
    };
  }

  async cancelarBoleto(boletoId: string, usuarioId: string) {
    return this.compras.cancelarBoleto(boletoId, usuarioId);
  }

  /**
   * Ítem 13, Fase 2 (05-ago-2026) -- descarga de boleto en PDF.
   * Reubicado 13-ago-2026 (auditoría, hallazgo de organización): vivía
   * en CalificacionesService, sin relación real con calificaciones --
   * ahora vive en CheckoutService, junto a cancelarBoleto y el resto
   * del ciclo de vida real del boleto. Mismo comportamiento exacto,
   * mismo query, mismo documento generado -- solo cambió dónde vive el
   * código, no cómo funciona.
   *
   * Requisitos del director (sin cambios): encabezado con marca, datos
   * organizados en secciones claras, QR grande y legible. QR generado
   * del lado del servidor con la misma librería `qrcode` que ya usa el
   * frontend (CodigoQr.tsx) -- aquí no hay DOM disponible, así que se
   * usa QRCode.toBuffer() en vez de QRCode.toCanvas(). Mismo valor
   * codificado (codigo_qr) en ambos casos.
   */
  /**
   * Ítem 13, Fase 2 (05-ago-2026) -- descarga de boleto en PDF.
   * Rediseño premium (13-ago-2026, orden explícita del director, regla
   * "mejor que una plataforma de boletos de avión") -- formato pase de
   * abordar de 2 secciones: información completa arriba, talón
   * recortable abajo con lo esencial para abordar. Investigado contra
   * redBus/FlixBus antes de diseñar (ver DOCUMENTO_MAESTRO.md).
   */
  /**
   * Envia por correo la confirmacion + los boletos en PDF (con QR) al
   * correo de contacto de la compra. Se usa en toda venta confirmada:
   * en linea, ventanilla y pago manual. Nunca lanza: una falla de correo
   * no debe revertir ni romper una venta ya confirmada.
   */
  async enviarBoletosPorCorreo(compraId: string): Promise<void> {
    try {
      const resumen = await this.compras.obtenerResumenNotificacionCompra(compraId);
      if (!resumen) return;
      const adjuntos: { nombreArchivo: string; contenido: Buffer }[] = [];
      for (const boletoId of resumen.boletoIds) {
        try {
          const contenido = await this.generarPdfBoleto(boletoId, null);
          adjuntos.push({
            nombreArchivo: `boleto-${boletoId.slice(0, 8)}.pdf`,
            contenido,
          });
        } catch {
          // Si un PDF falla, el correo sale igual con los demas.
        }
      }
      await this.compras.notificarCompraConfirmada(
        compraId,
        resumen.montoTotal,
        resumen.boletoIds.length,
        adjuntos,
      );
    } catch {
      // Silencioso a proposito -- ver el comentario del metodo.
    }
  }

  async generarPdfBoleto(boletoId: string, usuarioId: string | null): Promise<Buffer> {
    const datos = await this.compras.obtenerDatosBoletoParaPdf(
      boletoId,
      usuarioId,
    );
    if (!datos) {
      throw new ForbiddenException(
        'Este boleto no existe o no te pertenece.',
      );
    }

    // Mismo criterio real que ya usa procesarCompra para decidir si el
    // IVA se muestra desglosado -- no se inventa un criterio nuevo
    // solo para el PDF.
    const modoIva = await this.compras.obtenerModoIvaBoleto();
    const ivaVisible = modoIva === 'calculado';
    const ivaMonto = modoIva === 'cero' ? 0 : datos.ivaMonto;

    // Contacto de soporte global (13-ago-2026) -- hallazgo real
    // reportado en el rediseño anterior: no existía este campo en
    // ningún lado del sistema. Ya construido, ahora sí se usa aquí. Si
    // no está configurado (ambos null), simplemente no se muestra la
    // línea -- nunca un placeholder ni un texto vacío.
    const contactoSoporte = await this.compras.obtenerContactoSoporte();

    // Número de boleto corto y legible (13-ago-2026) -- decisión de
    // diseño reportada: NO reutiliza el código QR completo (larguísimo,
    // pensado para escanear, no para leer) ni el código de pasajero
    // (COL-XXXXXX, es un identificador de CUENTA, no de boleto -- son
    // cosas distintas, confundirlas sería un bug real). Se deriva
    // determinísticamente del id real del boleto (primeros 8
    // caracteres del UUID, en mayúsculas) -- mismo prefijo visual
    // "COL-" por consistencia de marca, sin necesitar ninguna columna
    // ni migración nueva: siempre reconstruible desde el id.
    const numeroBoleto = `KLB-${boletoId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    const ETIQUETAS_TARIFA: Record<string, string> = {
      adulto: 'Adulto',
      nino: 'Niño',
      tercera_edad: 'Tercera edad',
      discapacidad: 'Discapacidad',
    };
    const etiquetaTarifa = ETIQUETAS_TARIFA[datos.tipoTarifa] ?? datos.tipoTarifa;
    // Privacidad real (pedido explícito del director): nunca se
    // muestra el número de carné/cédula de discapacidad en el PDF --
    // ese dato ya se declaró en el checkout y se verifica físicamente
    // en el andén (ver validarBoletoPorQr), el PDF no necesita
    // repetirlo, mucho menos en un documento que el pasajero imprime o
    // reenvía por WhatsApp.
    const textoTarifa =
      datos.tipoTarifa === 'discapacidad'
        ? 'Discapacidad -- verificado al abordar'
        : etiquetaTarifa;

    const etiquetaDocumento = datos.tipoDocumento === 'pasaporte' ? 'Pasaporte' : 'Cédula';

    const qrBuffer = await QRCode.toBuffer(datos.codigoQr, {
      width: 300,
      margin: 1,
    });

    return new Promise<Buffer>((resolve, reject) => {
      // Boleto compacto (24-sep-2026): tamaño A5 en vez de una hoja carta
      // casi vacía -- se ve bien en el celular, gasta la mitad de papel si
      // se imprime, y sigue siendo UNA sola página. Marca: logo de Klumbus.
      const doc = new PDFDocument({ size: 'A5', margin: 28 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const anchoPagina = doc.page.width;
      const altoPagina = doc.page.height;
      const margenIzq = doc.page.margins.left;
      const margenDer = doc.page.margins.right;
      const anchoUtil = anchoPagina - margenIzq - margenDer;
      const AMARILLO_MARCA = '#ffd425';
      const NEGRO_MARCA = '#000000';
      const GRIS_ETIQUETA = '#888888';
      const TEXTO = '#1a1a1a';

      /**
       * Posiciones fijas calculadas a mano (mismo criterio que la versión
       * anterior: nunca se deja que pdfkit decida si algo cabe). Todo el
       * boleto termina en yFin, dentro del margen real de la página A5.
       */
      const yHeader = 24;
      const alturaLogo = 26;
      const yFranja = 62;
      const yOperadoPor = 74;
      const yRuta = 112;
      const yGrid = 168;
      const alturaFilaGrid = 32;
      const ySeparador = yGrid + alturaFilaGrid * 3 + 6; // 264
      const yPrecio = ySeparador + 8; // 272
      const alturaInstruccion = 50;
      const yLineaPunteada = yPrecio + alturaInstruccion + 12; // 334
      const yTalon = yLineaPunteada + 8; // 342
      const alturaTalon = 148;
      const tamanoQr = 108;
      const yQr = yTalon + 12;
      const yCodigoQrTexto = yTalon + alturaTalon - 16;
      const yPie = yTalon + alturaTalon + 10; // 500
      const yFin = yPie + 48;
      if (yFin > altoPagina - doc.page.margins.bottom) {
        throw new Error(
          'El diseño del PDF del boleto no cabe en una sola página con los datos reales de este boleto -- revisar aritmética de posiciones.',
        );
      }

      // Encabezado: logo de Klumbus a la izquierda, número de boleto a la derecha.
      const anchoLogo = alturaLogo * LOGO_BOLETO_PROPORCION;
      doc.image(
        Buffer.from(LOGO_BOLETO_PNG_BASE64, 'base64'),
        margenIzq,
        yHeader,
        {
          width: anchoLogo,
          height: alturaLogo,
        },
      );
      doc
        .fontSize(7)
        .fillColor(GRIS_ETIQUETA)
        .font('Helvetica')
        .text('BOLETO ELECTRÓNICO · N.º', margenIzq, yHeader, {
          width: anchoUtil,
          align: 'right',
        });
      doc
        .fontSize(15)
        .fillColor(NEGRO_MARCA)
        .font('Helvetica-Bold')
        .text(numeroBoleto, margenIzq, yHeader + 10, {
          width: anchoUtil,
          align: 'right',
        });
      doc
        .rect(margenIzq, yFranja, anchoUtil, 3)
        .fillColor(AMARILLO_MARCA)
        .fill();

      // Cooperativa y unidad.
      doc
        .fontSize(8)
        .fillColor(GRIS_ETIQUETA)
        .font('Helvetica')
        .text('OPERADO POR', margenIzq, yOperadoPor);
      doc
        .fontSize(13)
        .fillColor(TEXTO)
        .font('Helvetica-Bold')
        .text(datos.cooperativaNombre, margenIzq, yOperadoPor + 11, {
          width: anchoUtil * 0.68,
          height: 16,
          ellipsis: true,
        });
      if (datos.unidadIdentificador) {
        doc
          .fontSize(8)
          .fillColor(GRIS_ETIQUETA)
          .font('Helvetica')
          .text('UNIDAD', margenIzq, yOperadoPor, {
            width: anchoUtil,
            align: 'right',
          });
        doc
          .fontSize(13)
          .fillColor(TEXTO)
          .font('Helvetica-Bold')
          .text(datos.unidadIdentificador, margenIzq, yOperadoPor + 11, {
            width: anchoUtil,
            align: 'right',
          });
      }

      // Ruta: terminal y ciudad de origen y destino.
      const anchoRutaCol = anchoUtil / 2 - 14;
      const colDestinoX = margenIzq + anchoUtil / 2 + 14;
      doc
        .fontSize(8)
        .fillColor(GRIS_ETIQUETA)
        .font('Helvetica')
        .text('ORIGEN', margenIzq, yRuta, { width: anchoRutaCol });
      doc
        .fontSize(11)
        .fillColor(TEXTO)
        .font('Helvetica-Bold')
        .text(datos.origenNombre, margenIzq, yRuta + 10, {
          width: anchoRutaCol,
          height: 26,
          ellipsis: true,
        });
      doc
        .fontSize(9)
        .fillColor('#666666')
        .font('Helvetica')
        .text(datos.origenCiudad, margenIzq, yRuta + 38, {
          width: anchoRutaCol,
        });
      doc
        .fontSize(8)
        .fillColor(GRIS_ETIQUETA)
        .font('Helvetica')
        .text('DESTINO', colDestinoX, yRuta, { width: anchoRutaCol });
      doc
        .fontSize(11)
        .fillColor(TEXTO)
        .font('Helvetica-Bold')
        .text(datos.destinoNombre, colDestinoX, yRuta + 10, {
          width: anchoRutaCol,
          height: 26,
          ellipsis: true,
        });
      doc
        .fontSize(9)
        .fillColor('#666666')
        .font('Helvetica')
        .text(datos.destinoCiudad, colDestinoX, yRuta + 38, {
          width: anchoRutaCol,
        });
      // Flecha ASCII -- Helvetica estándar no tiene el glifo Unicode (→).
      doc
        .fontSize(13)
        .fillColor('#cccccc')
        .font('Helvetica-Bold')
        .text('->', margenIzq + anchoUtil / 2 - 8, yRuta + 12);

      // Grilla de 3 filas x 2 columnas.
      const col1X = margenIzq;
      const col2X = margenIzq + anchoUtil / 2 + 14;
      const anchoCol = anchoUtil / 2 - 14;
      // "mar, 22 sept 2026": la fecha larga ("martes, 22 de septiembre de 2026") no cabe en media columna.
      const fechaCortaBoleto = (fecha: string) =>
        new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-EC', {
          timeZone: 'UTC',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
      function celda(etiqueta: string, valor: string, x: number, y: number) {
        doc
          .fontSize(8)
          .fillColor(GRIS_ETIQUETA)
          .font('Helvetica')
          .text(etiqueta, x, y);
        doc
          .fontSize(11.5)
          .fillColor(TEXTO)
          .font('Helvetica-Bold')
          .text(valor, x, y + 11, {
            width: anchoCol,
            height: 16,
            ellipsis: true,
          });
      }
      celda('FECHA', fechaCortaBoleto(datos.fechaSalida), col1X, yGrid);
      celda(
        'HORA DE SALIDA',
        formatearHoraBoleto(datos.horaSalidaProgramada),
        col2X,
        yGrid,
      );
      celda(
        'ASIENTO',
        datos.esVip ? `${datos.numeroAsiento} · VIP` : datos.numeroAsiento,
        col1X,
        yGrid + alturaFilaGrid,
      );
      celda('PASAJERO', datos.pasajeroNombre, col2X, yGrid + alturaFilaGrid);
      celda(
        'DOCUMENTO',
        `${etiquetaDocumento} · ${datos.documento}`,
        col1X,
        yGrid + alturaFilaGrid * 2,
      );
      celda('TARIFA', textoTarifa, col2X, yGrid + alturaFilaGrid * 2);

      doc
        .strokeColor('#dddddd')
        .lineWidth(1)
        .moveTo(margenIzq, ySeparador)
        .lineTo(anchoPagina - margenDer, ySeparador)
        .stroke();

      // Precio (con IVA desglosado si la configuración lo permite) a la
      // izquierda, e instrucción de embarque a la derecha, en la misma fila.
      doc
        .fontSize(8)
        .fillColor(GRIS_ETIQUETA)
        .font('Helvetica')
        .text('PRECIO PAGADO', margenIzq, yPrecio);
      doc
        .fontSize(20)
        .fillColor(NEGRO_MARCA)
        .font('Helvetica-Bold')
        .text(`$${datos.precioPagado.toFixed(2)}`, margenIzq, yPrecio + 11);
      if (ivaVisible && ivaMonto > 0) {
        doc
          .fontSize(8.5)
          .fillColor('#666666')
          .font('Helvetica')
          .text(
            `Incluye IVA: $${ivaMonto.toFixed(2)}`,
            margenIzq,
            yPrecio + 35,
          );
      }
      const xInstruccion = margenIzq + anchoUtil * 0.42;
      const anchoInstruccion = anchoUtil - (xInstruccion - margenIzq);
      doc
        .rect(xInstruccion, yPrecio, anchoInstruccion, alturaInstruccion)
        .fillColor('#fff8dc')
        .fill();
      doc
        .fontSize(9)
        .fillColor('#5a4a00')
        .font('Helvetica-Bold')
        .text(
          'Preséntate en el punto de embarque al menos 15 minutos antes de la salida, con tu documento de identidad.',
          xInstruccion + 10,
          yPrecio + 8,
          { width: anchoInstruccion - 20, height: alturaInstruccion - 12 },
        );

      // Línea de corte y talón con el QR.
      doc
        .strokeColor('#999999')
        .lineWidth(1)
        .dash(4, { space: 4 })
        .moveTo(margenIzq, yLineaPunteada)
        .lineTo(anchoPagina - margenDer, yLineaPunteada)
        .stroke()
        .undash();
      doc
        .rect(margenIzq, yTalon, anchoUtil, alturaTalon)
        .fillColor('#fffbea')
        .fill();
      doc
        .rect(margenIzq, yTalon, anchoUtil, 4)
        .fillColor(AMARILLO_MARCA)
        .fill();

      const xQr = margenIzq + 14;
      doc.image(qrBuffer, xQr, yQr, { width: tamanoQr, height: tamanoQr });

      // Datos clave repetidos junto al QR (lo que el personal mira al abordar).
      const xDatos = xQr + tamanoQr + 22;
      const anchoDatos = anchoPagina - margenDer - xDatos - 8;
      const datoTalon = (etiqueta: string, valor: string, y: number) => {
        doc
          .fontSize(8)
          .fillColor(GRIS_ETIQUETA)
          .font('Helvetica')
          .text(etiqueta, xDatos, y, { width: anchoDatos });
        doc
          .fontSize(15)
          .fillColor(NEGRO_MARCA)
          .font('Helvetica-Bold')
          .text(valor, xDatos, y + 10, {
            width: anchoDatos,
            height: 20,
            ellipsis: true,
          });
      };
      datoTalon('BOLETO', numeroBoleto, yQr);
      datoTalon(
        'ASIENTO',
        datos.esVip ? `${datos.numeroAsiento} · VIP` : datos.numeroAsiento,
        yQr + 38,
      );
      datoTalon(
        'SALIDA',
        formatearHoraBoleto(datos.horaSalidaProgramada),
        yQr + 76,
      );

      doc
        .fontSize(6.5)
        .fillColor(GRIS_ETIQUETA)
        .font('Helvetica')
        .text(datos.codigoQr, margenIzq, yCodigoQrTexto, {
          width: anchoUtil,
          align: 'center',
        });

      // Pie: política de la cooperativa, soporte de Klumbus y cierre.
      doc
        .strokeColor('#eeeeee')
        .lineWidth(1)
        .moveTo(margenIzq, yPie)
        .lineTo(anchoPagina - margenDer, yPie)
        .stroke();

      const textoCancelacion = datos.permiteCancelacion
        ? `cancelación${datos.horasLimiteCancelacion ? ` hasta ${datos.horasLimiteCancelacion}h antes de la salida` : ' disponible'}`
        : 'sin cancelación';
      const textoReprogramacion = datos.permiteReprogramacion
        ? `reprogramación${datos.horasLimiteReprogramacion ? ` hasta ${datos.horasLimiteReprogramacion}h antes de la salida` : ' disponible'}`
        : 'sin reprogramación';

      doc
        .fontSize(7)
        .fillColor('#999999')
        .font('Helvetica')
        .text(
          `Política de esta cooperativa: ${textoCancelacion} · ${textoReprogramacion}.`,
          margenIzq,
          yPie + 6,
          {
            width: anchoUtil,
            align: 'center',
          },
        );

      // Soporte centralizado en la marca (decisión del 13-ago-2026); solo
      // se muestra si está configurado -- nunca un placeholder.
      if (contactoSoporte.correo || contactoSoporte.telefono) {
        const partesContacto = [
          contactoSoporte.correo,
          contactoSoporte.telefono,
        ].filter((v): v is string => Boolean(v));
        doc
          .fontSize(7)
          .fillColor('#999999')
          .font('Helvetica')
          .text(
            `Soporte Klumbus: ${partesContacto.join(' · ')}`,
            margenIzq,
            yPie + 25,
            {
              width: anchoUtil,
              align: 'center',
            },
          );
      }

      doc
        .fontSize(8.5)
        .fillColor(NEGRO_MARCA)
        .font('Helvetica-Bold')
        .text('Gracias por preferirnos', margenIzq, yPie + 37, {
          width: anchoUtil,
          align: 'center',
        });

      doc.end();
    });
  }

  /**
   * Reprogramación con crédito (Fase C, 29-jul-2026). Reutiliza la
   * validación/reserva de asientos y el pago simulado del checkout
   * normal — no reinventa esa lógica.
   *
   * Reglas (confirmadas con el usuario, validadas contra el estándar
   * de la industria — Flixbus, Peter Pan, OurBus):
   *  - Solo dentro de la misma cooperativa.
   *  - Respeta el límite de horas antes de la salida que cada
   *    cooperativa configura (RN, 28-jul-2026).
   *  - La plataforma NO vuelve a cobrar su cargo fijo.
   *  - Si el nuevo pasaje es más barato: el excedente queda como
   *    crédito interno (no efectivo — no hay pasarela real todavía).
   *  - Si es más caro: el pasajero paga la diferencia con el mismo
   *    flujo de pago simulado del checkout.
   *
   * El asiento nuevo debe estar bloqueado a nombre de este usuario
   * ANTES de llamar esto (mismo flujo que un checkout normal:
   * bloquear-asiento primero).
   */
  async reprogramarBoleto(
    boletoIdViejo: string,
    nuevoViajeId: string,
    nuevoNumeroAsiento: string,
    usuarioId: string,
  ) {
    const viejo = await this.compras.obtenerDetalleBoletoParaReprogramar(
      boletoIdViejo,
      usuarioId,
    );
    if (!viejo) {
      throw new BadRequestException('Este boleto no existe o no te pertenece.');
    }
    if (viejo.estado !== 'vigente') {
      throw new BadRequestException(
        viejo.estado === 'usado'
          ? 'Este boleto ya fue usado, no se puede reprogramar.'
          : 'Este boleto ya estaba cancelado.',
      );
    }

    const politicaReprogramacion = await this.compras.obtenerHorasLimiteReprogramacion(
      viejo.cooperativaId,
    );
    if (!politicaReprogramacion.permitido) {
      throw new BadRequestException(
        'Esta cooperativa no permite reprogramaciones.',
      );
    }
    const horasLimite = politicaReprogramacion.horas;
    const limite = new Date(viejo.horaSalidaProgramada);
    limite.setHours(limite.getHours() - horasLimite);
    if (new Date() > limite) {
      throw new BadRequestException(
        `Ya no se puede reprogramar — faltan menos de ${horasLimite} horas para la salida original.`,
      );
    }

    // Validar y calcular el asiento NUEVO — reutiliza exactamente la
    // misma verificación de checkout (el asiento debe estar bloqueado
    // a nombre de este usuario).
    const [desgloseNuevo] = await this.compras.validarYCalcularAsientos(
      [
        {
          viajeId: nuevoViajeId,
          numeroAsiento: nuevoNumeroAsiento,
          nombres: viejo.nombres,
          apellidos: viejo.apellidos,
          tipoDocumento: viejo.tipoDocumento,
          documento: viejo.documento,
          tipoTarifa: viejo.tipoTarifa,
          fechaNacimiento: viejo.fechaNacimiento ?? undefined,
        },
      ],
      usuarioId,
      null,
    );

    if (desgloseNuevo.cooperativaId !== viejo.cooperativaId) {
      throw new BadRequestException(
        'Solo puedes reprogramar dentro de la misma cooperativa.',
      );
    }

    // La plataforma no vuelve a cobrar su cargo fijo en una
    // reprogramación — es el mismo pasajero, no una venta nueva.
    desgloseNuevo.cargoPlataforma = 0;

    const totalNuevo = desgloseNuevo.precioPagado + desgloseNuevo.tasaTerminal;
    const totalViejo = viejo.precioPagado + viejo.tasaTerminal;
    const diferencia = Number((totalNuevo - totalViejo).toFixed(2));

    // Si el pasaje nuevo es más caro, se cobra la diferencia ANTES de
    // tocar el boleto viejo — si el pago falla, el pasajero no pierde
    // su boleto original.
    if (diferencia > 0) {
      const idempotencyKey = randomUUID();
      const resultadoPago = await this.pasarela.procesar(
        diferencia,
        idempotencyKey,
      );
      if (!resultadoPago.aprobado) {
        throw new BadRequestException(
          resultadoPago.motivoRechazo ??
            'No se pudo cobrar la diferencia — inténtalo de nuevo.',
        );
      }
    }

    const { compraId, mapeo } = await this.compras.crearCompraPendiente(
      usuarioId,
      [
        {
          viajeId: nuevoViajeId,
          numeroAsiento: nuevoNumeroAsiento,
          nombres: viejo.nombres,
          apellidos: viejo.apellidos,
          tipoDocumento: viejo.tipoDocumento,
          documento: viejo.documento,
          tipoTarifa: viejo.tipoTarifa,
          fechaNacimiento: viejo.fechaNacimiento ?? undefined,
        },
      ],
      [desgloseNuevo],
      randomUUID(),
    );
    const { boletos } = await this.compras.confirmarPago(
      compraId,
      `reprogramacion-${boletoIdViejo}`,
      mapeo,
    );

    await this.compras.cancelarBoletoPorReprogramacion(
      boletoIdViejo,
      viejo.viajeAsientoId,
    );

    let credito: number | null = null;
    if (diferencia < 0) {
      credito = Number((-diferencia).toFixed(2));
      await this.compras.crearCreditoPasajero(
        usuarioId,
        viejo.cooperativaId,
        credito,
        boletoIdViejo,
      );
    }

    return {
      boletoNuevo: boletos[0],
      diferenciaPagada: diferencia > 0 ? diferencia : 0,
      creditoGenerado: credito,
    };
  }

  async obtenerReciboCompra(compraId: string, usuarioId: string) {
    return this.compras.obtenerReciboCompra(compraId, usuarioId);
  }

  /** Vacío real de diseño encontrado el 29-jul-2026: sin esto, el pasajero no tenía dónde ver su saldo de crédito. */
  async listarMisCreditos(usuarioId: string) {
    return this.compras.listarCreditosUsuario(usuarioId);
  }

  async listarMetodosPagoActivosPorViaje(viajeId: string) {
    return this.compras.listarMetodosPagoActivosPorViaje(viajeId);
  }

  /**
   * Iniciar un pago manual (29-jul-2026) — mientras no hay pasarela
   * real conectada, el pasajero paga por fuera (transferencia,
   * efectivo, DeUna, PayPhone) y sube su comprobante. El asiento queda
   * reservado (no expira solo, a diferencia del bloqueo de tarjeta)
   * hasta que la cooperativa confirme o rechace.
   */
  async iniciarPagoManual(
    pasajeros: PasajeroCheckout[],
    usuarioId: string,
    tipoMetodoPago: string,
    idempotencyKeyCliente?: string,
  ) {
    const desglose = await this.compras.validarYCalcularAsientos(pasajeros, usuarioId, null);

    const cooperativasEnCompra = new Set(desglose.map((d) => d.cooperativaId));
    if (cooperativasEnCompra.size !== 1) {
      throw new BadRequestException(
        'No se puede pagar de forma manual una compra que mezcla boletos de varias cooperativas.',
      );
    }
    const [cooperativaId] = cooperativasEnCompra;

    const metodoActivo = await this.compras.verificarMetodoPagoActivo(
      cooperativaId,
      tipoMetodoPago,
    );
    if (!metodoActivo) {
      throw new BadRequestException(
        'Esta cooperativa no tiene configurado ese método de pago.',
      );
    }

    const idempotencyKey = idempotencyKeyCliente ?? randomUUID();
    const { compraId, mapeo } = await this.compras.crearCompraPendiente(
      usuarioId,
      pasajeros,
      desglose,
      idempotencyKey,
      tipoMetodoPago,
    );

    // El bloqueo temporal corto (minutos) no alcanza para revisar un
    // comprobante -- se convierte en una reserva de largo plazo que no
    // expira sola.
    await this.compras.marcarAsientosPendientesConfirmacionPago(mapeo);

    return { compraId, estado: 'pendiente_confirmacion' as const };
  }

  /**
   * Venta presencial en ventanilla (17-sep-2026) -- hallazgo real: el
   * único flujo de pago manual que existía (iniciarPagoManual, arriba)
   * exige el JWT del propio pasajero, así que no servía para el caso
   * real del terminal -- alguien que llega sin celular y sin cuenta, y
   * el vendedor le vende directo en el mostrador. Este método asume
   * que el vendedor YA bloqueó el asiento con su propia cuenta (mismo
   * endpoint POST /viajes/:id/asientos/:numero/bloquear que usa
   * cualquier pasajero) -- por eso `validarYCalcularAsientos` recibe
   * el id del VENDEDOR como dueño del hold, no el del comprador (que
   * no existe). La compra en sí queda sin cuenta (usuarioId null,
   * canal='ventanilla'), con `vendedorUsuarioId` para trazabilidad.
   *
   * Se confirma al instante (mismo criterio real de una ventanilla
   * física: el vendedor ya tiene el dinero en mano, efectivo o
   * datáfono, antes de entregar el boleto) -- a diferencia de
   * iniciarPagoManual, no hay paso de "sube tu comprobante" ni espera
   * de confirmación posterior.
   */
  async venderEnVentanilla(
    pasajeros: PasajeroCheckout[],
    vendedorUsuarioId: string,
    cooperativaId: string,
    tipoMetodoPago: 'efectivo' | 'tarjeta_fisica' | 'transferencia_bancaria',
    telefonoContacto?: string,
    correoContacto?: string,
    /**
     * Respaldo opcional para transferencia (22-sep-2026) -- el vendedor
     * sigue pudiendo confirmar al instante sin nada de esto (mismo
     * criterio de siempre: "ya tengo el dinero en mano"), pero si
     * anota el número de referencia y/o deja el comprobante, queda
     * guardado en el pago para poder auditarlo después -- visible en
     * el historial de Ventas, no en Pagos pendientes (nunca bloquea la
     * venta ni pasa por revisión de un admin).
     */
    referenciaTransferencia?: string,
    comprobanteUrl?: string,
  ) {
    const desglose = await this.compras.validarYCalcularAsientos(
      pasajeros,
      vendedorUsuarioId,
      null,
    );

    if (desglose.some((d) => d.cooperativaId !== cooperativaId)) {
      throw new ForbiddenException(
        'No puedes vender asientos de una cooperativa distinta a la tuya.',
      );
    }

    const idempotencyKey = randomUUID();
    const { compraId, mapeo } = await this.compras.crearCompraPendiente(
      null,
      pasajeros,
      desglose,
      idempotencyKey,
      tipoMetodoPago,
      telefonoContacto,
      correoContacto,
      vendedorUsuarioId,
      'ventanilla',
    );

    const { boletos } = await this.compras.confirmarPago(
      compraId,
      referenciaTransferencia?.trim() ||
        `venta-ventanilla-${vendedorUsuarioId}`,
      mapeo,
      comprobanteUrl,
    );

    const cargoPlataformaTotal = desglose.reduce((acc, d) => acc + d.cargoPlataforma, 0);
    await this.generarFacturaPlataforma(compraId, cargoPlataformaTotal);

    await this.enviarBoletosPorCorreo(compraId);

    return { compraId, boletos };
  }

  async subirComprobantePago(
    compraId: string,
    usuarioId: string,
    buffer: Buffer,
    nombreOriginal: string,
  ) {
    const { url } = await this.almacenamiento.guardarImagen(
      buffer,
      nombreOriginal,
      'comprobantes-pago',
    );
    const resultado = await this.compras.adjuntarComprobante(compraId, usuarioId, url);
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return { ok: true, comprobanteUrl: url };
  }

  /**
   * Sube el comprobante de una venta de ventanilla ANTES de confirmarla
   * (22-sep-2026) -- a diferencia de subirComprobantePago, no hay
   * compraId todavía porque venderEnVentanilla crea y confirma la
   * compra en un solo paso. Solo guarda el archivo y devuelve su URL;
   * el vendedor la manda junto con el resto de la venta.
   */
  async subirComprobanteVentanilla(buffer: Buffer, nombreOriginal: string) {
    const { url } = await this.almacenamiento.guardarImagen(
      buffer,
      nombreOriginal,
      'comprobantes-pago',
    );
    return { comprobanteUrl: url };
  }

  /**
   * Lado cooperativa del pago manual (29-jul-2026): ve los pagos con
   * comprobante subido, esperando confirmación.
   */
  async listarPagosPendientesConfirmacion(cooperativaId: string) {
    return this.compras.listarPagosPendientesConfirmacion(cooperativaId);
  }

  /** Historial de pagos manuales ya confirmados/rechazados (22-sep-2026) -- ver PagoManualHistorialItem. */
  async listarHistorialPagosManuales(
    cooperativaId: string,
    filtros: FiltrosHistorialPagos,
  ) {
    return this.compras.listarHistorialPagosManuales(cooperativaId, filtros);
  }

  async confirmarPagoManual(
    pagoId: string,
    cooperativaId: string,
    confirmadoPorUsuarioId: string,
  ) {
    const resultado = await this.compras.confirmarPagoManual(
      pagoId,
      cooperativaId,
      confirmadoPorUsuarioId,
    );
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    await this.auditoria.registrar({
      accion: 'confirmacion_pago_manual',
      usuarioId: confirmadoPorUsuarioId,
      entidadTipo: 'pago',
      entidadId: pagoId,
      detalle: { cooperativaId, compraId: resultado.compraId },
    });
    // Factura del servicio de Colombus (29-jul-2026) -- no falla la
    // confirmación del pago si esto tiene algún problema, el boleto ya
    // es real y válido de todas formas; se registra el error para
    // revisión (ver comprobante_electronico.estado='rechazado').
    await this.generarFacturaPlataforma(resultado.compraId, resultado.montoCargoPlataforma);

    // Modelo B (02-ago-2026) -- mismo disparo que en procesarCompra,
    // pero acá ya sabemos que es una sola cooperativa (el parámetro).
    await this.webhooks.dispararEventoVenta(cooperativaId, resultado.compraId, {
      evento: 'venta_creada',
      compraId: resultado.compraId,
    });

    await this.enviarBoletosPorCorreo(resultado.compraId);

    return { ok: true };
  }

  /** Factura del servicio de Colombus (29-jul-2026) -- ver dominio/facturacion/facturacion.ports.ts. */
  private async generarFacturaPlataforma(compraId: string, montoCargoPlataforma: number) {
    if (montoCargoPlataforma <= 0) return;
    try {
      const { ruc } = await this.compras.obtenerDatosFiscalesPlataforma();
      const resultadoFactura = await this.facturacion.emitirComprobante({
        montoTotal: montoCargoPlataforma,
        descripcion: 'Cargo por servicio de plataforma Columbus',
      });
      await this.compras.crearComprobantePlataforma(
        compraId,
        montoCargoPlataforma,
        ruc,
        resultadoFactura,
      );
    } catch {
      // Silencioso a propósito: la factura del servicio de Colombus no
      // debe bloquear ni revertir una venta ya confirmada.
    }
  }

  async rechazarPagoManual(
    pagoId: string,
    cooperativaId: string,
    motivo: string | undefined,
    confirmadoPorUsuarioId: string,
  ) {
    const resultado = await this.compras.rechazarPagoManual(
      pagoId,
      cooperativaId,
      motivo,
      confirmadoPorUsuarioId,
    );
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    await this.auditoria.registrar({
      accion: 'rechazo_pago_manual',
      usuarioId: confirmadoPorUsuarioId,
      entidadTipo: 'pago',
      entidadId: pagoId,
      detalle: { cooperativaId, motivo: motivo ?? null },
    });
    return { ok: true };
  }

  /**
   * Solicitud de factura del pasaje (29-jul-2026) -- confirmado con el
   * usuario: la cooperativa emite en su propio sistema, Colombus solo
   * avisa.
   */
  async solicitarFacturaCooperativa(
    boletoId: string,
    usuarioId: string,
    datosTributarios: Record<string, string>,
  ) {
    const resultado = await this.compras.solicitarFacturaCooperativa(
      boletoId,
      usuarioId,
      datosTributarios,
    );
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return { ok: true, id: resultado.id };
  }

  async listarSolicitudesFactura(
    cooperativaId: string,
    filtros: FiltrosSolicitudesFactura,
  ) {
    return this.compras.listarSolicitudesFactura(cooperativaId, filtros);
  }

  async marcarFacturaEmitida(solicitudId: string, cooperativaId: string, urlFactura?: string) {
    const resultado = await this.compras.marcarFacturaEmitida(
      solicitudId,
      cooperativaId,
      urlFactura,
    );
    if (!resultado.ok) {
      throw new BadRequestException(resultado.motivo);
    }
    return { ok: true };
  }
}
