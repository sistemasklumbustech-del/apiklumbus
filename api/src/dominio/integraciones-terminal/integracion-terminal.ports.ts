/**
 * Puerto de dominio para la integración con el sistema de tasas del
 * Terminal (RF-016 del Requerimiento Funcional TTM, CONTEXT.md sección
 * 5). Deliberadamente no acopla el backend a SIAT3000/Derpacif -- no
 * todos los terminales de Ecuador usan el mismo proveedor (decisión de
 * puerto + adaptador, CONTEXT.md 5.2). Mismo patrón que
 * ProveedorFacturacionElectronica: mientras la Fase 0 (carta a Derpacif,
 * CONTEXT.md 5.4) sigue bloqueada, un simulador prueba el flujo completo
 * de punta a punta sin depender de la respuesta real.
 *
 * Los nombres de campo y longitudes citados en los comentarios vienen
 * del diccionario de datos real de Derpacif (ws_ApiSiat?wsdl, diseño
 * 01/10/2015, actualización 14/05/2018) -- se documentan acá como
 * referencia para el futuro adaptador real, que sí deberá respetarlos al
 * pie de la letra; el dominio en sí no depende de ellos.
 */

export interface BusTerminal {
  codigoTerminal: string; // "id" del manual
  disco: string;
  placa: string;
  capacidad: number;
}

export interface UsuarioTerminal {
  nick: string;
  nombre: string;
}

export interface RutaTerminal {
  codigoTerminal: string; // "id" del manual
  destino: string;
  via: string;
}

/** getDestinoRuta -- pc1..pc5 del manual son NORMAL/ADULTO/NIÑO/ESTUDIANTE/ESPECIAL, en ese orden. */
export interface TarifaDestinoRuta {
  codigoTerminal: string; // "id"
  descripcion: string;
  precioNormal: number;
  precioAdulto: number;
  precioNino: number;
  precioEstudiante: number;
  precioEspecial: number;
}

export interface FrecuenciaRuta {
  codigoTerminal: string; // "id"
  hora: string;
}

export interface DatosCrearViaje {
  cooperativaId: string;
  fecha: string; // yyyy-MM-dd
  rutaCodigoTerminal: string;
  busDisco: string;
  horaFrecuencia: string;
  // "tipo" del manual: 'N' (normal) | 'E' (extra), longitud 1.
  tipo: 'normal' | 'extra';
}

export interface ResultadoCrearViaje {
  exitoso: boolean;
  codigoViaje?: string;
  error?: string;
}

export interface DatosAnularVenta {
  cooperativaId: string;
  facturaNumero: string; // longitud 9 en el manual
  codigoViaje: string;
}

/**
 * RF-014 del Requerimiento Funcional TTM / nota exacta del manual: "se
 * anulará solo la venta del boleto, pero la tasa no se anula". No
 * prometer devolución de tasa en ningún flujo que use este resultado.
 */
export interface ResultadoAnularVenta {
  exitoso: boolean;
  error?: string;
}

export interface DatosCambiarBus {
  cooperativaId: string;
  codigoViaje: string;
  busDisco: string;
}

export interface ResultadoCambiarBus {
  exitoso: boolean;
  error?: string;
}

export interface PasajeroParaTasa {
  asiento: number;
  tipo: 'normal' | 'infante' | 'adulto' | 'estudiante' | 'especial';
  valor: number;
}

export interface DatosVentaParaTasa {
  cooperativaId: string;
  compraId: string;
  facturaNumero: string; // longitud 9 en el manual
  codigoViaje: string;
  // "tipcli" del manual (valores 04-07) -- significado exacto de cada
  // código sin confirmar todavía (CONTEXT.md 7.1, pregunta pendiente a
  // Derpacif).
  tipoCliente: string;
  // "identi" del manual -- descrito como RUC del cliente pero con
  // longitud declarada de 1 en el diccionario de datos (inconsistencia
  // real del manual, CONTEXT.md 7.1). No asumir ningún límite de
  // longitud real hasta que Derpacif confirme.
  identificacionCliente: string;
  razonSocialCliente: string;
  direccionCliente?: string;
  correoCliente?: string;
  destinoCodigoTerminal: string;
  totalFacturado: number;
  pasajeros: PasajeroParaTasa[];
}

export interface ResultadoRegistroTasa {
  exitoso: boolean;
  // 20 dígitos, para imprimir en formato QR (RF-010).
  codigoTasa?: string;
  mensaje?: string;
  saldoRestante?: number;
  error?: string;
}

export interface ProveedorIntegracionTerminal {
  obtenerBuses(cooperativaId: string): Promise<BusTerminal[]>;
  obtenerUsuarios(cooperativaId: string): Promise<UsuarioTerminal[]>;
  obtenerRutas(cooperativaId: string): Promise<RutaTerminal[]>;
  obtenerTarifasDestinoRuta(
    cooperativaId: string,
    rutaCodigoTerminal: string,
  ): Promise<TarifaDestinoRuta[]>;
  obtenerFrecuenciasRuta(
    cooperativaId: string,
    rutaCodigoTerminal: string,
  ): Promise<FrecuenciaRuta[]>;
  crearViaje(datos: DatosCrearViaje): Promise<ResultadoCrearViaje>;
  anularVenta(datos: DatosAnularVenta): Promise<ResultadoAnularVenta>;
  cambiarBus(datos: DatosCambiarBus): Promise<ResultadoCambiarBus>;
  // "claveIdempotencia" corresponde a registros_tasa_terminal.clave_idempotencia
  // (RN-005/RN-007 del Requerimiento Funcional TTM) -- el adaptador real
  // debe reconciliar contra esa fila antes de reintentar, nunca repetir
  // la venta a ciegas ante un timeout.
  registrarVentaYObtenerTasa(
    datos: DatosVentaParaTasa,
    claveIdempotencia: string,
  ): Promise<ResultadoRegistroTasa>;
}

export const PROVEEDOR_INTEGRACION_TERMINAL = 'PROVEEDOR_INTEGRACION_TERMINAL';
