import * as soap from 'soap';

/**
 * Cliente SOAP tipado para el Web Service ws_ApiSiat de Derpacif
 * (diccionario de datos, diseño 01/10/2015, actualización 14/05/2018 --
 * confirmado vigente por Derpacif el 15-sep-2026, ver CONTEXT.md 5.4).
 *
 * ⚠️ El WSDL real (el XML del contrato) nunca se vio -- solo el
 * diccionario de datos en PDF que describe cada método. Los nombres de
 * los mensajes de entrada/salida que usa `soap` para parsear la
 * respuesta se infieren de ese documento; si al probar contra el
 * endpoint real la forma de la respuesta no calza (ver `normalizarFila`
 * abajo), es la forma real del WSDL la que manda, no este archivo --
 * ajustar aquí, nunca "forzar" los datos para que calcen.
 *
 * No existe ambiente de certificación (confirmado por Derpacif,
 * pregunta 10) -- cualquier prueba real de este cliente pega contra
 * producción. Probar primero con getBus/getRuta (solo lectura) antes de
 * arriesgar un setVentaPasaje real.
 */

/**
 * `soap.Client` resuelve cualquier nombre de método del WSDL en tiempo
 * de ejecución (no puede tiparlos de antemano -- no conoce el contrato
 * hasta cargarlo). Esta interfaz declara solo los 9 métodos que este
 * archivo realmente usa, con sus args como `Record<string, unknown>`
 * (los campos exactos ya están validados por los tipos públicos de cada
 * función exportada más abajo) -- así el resto del archivo trabaja con
 * tipos reales en vez de `any` esparcido por todos lados.
 */
interface ClienteSiat3000 {
  getBusAsync(args: Record<string, unknown>): Promise<[unknown]>;
  getUsuarioAsync(args: Record<string, unknown>): Promise<[unknown]>;
  getRutaAsync(args: Record<string, unknown>): Promise<[unknown]>;
  getDestinoRutaAsync(args: Record<string, unknown>): Promise<[unknown]>;
  getFrecuenciaRutaAsync(args: Record<string, unknown>): Promise<[unknown]>;
  setCrearViajeAsync(args: Record<string, unknown>): Promise<[unknown]>;
  setAnulaVentaAsync(args: Record<string, unknown>): Promise<[unknown]>;
  setCambioBusAsync(args: Record<string, unknown>): Promise<[unknown]>;
  setVentaPasajeAsync(args: Record<string, unknown>): Promise<[unknown]>;
}

let clientePromesa: Promise<ClienteSiat3000> | undefined;
let wsdlUrlCacheada: string | undefined;

async function obtenerCliente(wsdlUrl: string): Promise<ClienteSiat3000> {
  if (!clientePromesa || wsdlUrlCacheada !== wsdlUrl) {
    wsdlUrlCacheada = wsdlUrl;
    clientePromesa = soap
      .createClientAsync(wsdlUrl)
      .then((cliente) => cliente as unknown as ClienteSiat3000);
  }
  return clientePromesa;
}

/**
 * El manual no describe explícitamente la forma en que `soap` envuelve
 * las columnas devueltas -- solo describe "retorna un array con las
 * columnas X, Y, Z". Node-soap normalmente devuelve un objeto con una
 * propiedad que envuelve el array de filas (ej. `{ item: [...] }` o
 * `{ Table: [...] }` según cómo el WSDL nombre el tipo de retorno).
 * Esta función normaliza ambas formas conocidas más comunes en vez de
 * asumir una sola, para no romper apenas se pruebe contra el endpoint
 * real por un detalle de envoltorio.
 */
function normalizarFilas<T>(resultado: unknown): T[] {
  if (Array.isArray(resultado)) return resultado as T[];
  if (resultado && typeof resultado === 'object') {
    const valores = Object.values(resultado as Record<string, unknown>);
    for (const valor of valores) {
      if (Array.isArray(valor)) return valor as T[];
      if (valor && typeof valor === 'object') return [valor as T];
    }
  }
  return [];
}

/** Extrae el string de retorno "plano" de setCrearViaje/setAnulaVenta/setCambioBus. */
function normalizarTexto(resultado: unknown): string {
  if (typeof resultado === 'string') return resultado.trim();
  if (resultado && typeof resultado === 'object') {
    const valores = Object.values(resultado as Record<string, unknown>);
    const primero = valores.find((v) => typeof v === 'string');
    if (typeof primero === 'string') return primero.trim();
  }
  return '';
}

export interface FilaBus {
  id: string;
  disco: string;
  placa: string;
  capacidad: string;
  mensaje?: string;
}

export interface FilaUsuario {
  nick: string;
  nombre: string;
  mensaje?: string;
}

export interface FilaRuta {
  id: string;
  destino: string;
  via: string;
  mensaje?: string;
}

export interface FilaDestinoRuta {
  id: string;
  descripcion: string;
  pc1: string;
  pc2: string;
  pc3: string;
  pc4: string;
  pc5: string;
  mensaje?: string;
}

export interface FilaFrecuenciaRuta {
  id: string;
  hora: string;
  mensaje?: string;
}

export interface DetalleVentaPasaje {
  asiento: number;
  tipo: 'Normal' | 'Infante' | 'Adulto' | 'Estudiante' | 'Especial';
  valor: number;
}

export interface RespuestaVentaPasaje {
  estado: string; // "1" = devuelve tasa, "0" = ocurrió un error (manual, sección setVentaPasaje)
  tasa: string; // código de 20 dígitos para QR
  mensaje: string;
  saldo: string;
}

/**
 * Params comunes a casi todos los métodos -- `proveedor`, `ruc`,
 * `sucursal`, `usuario` (el nick, que ES la credencial completa: no hay
 * password/token/certificado, confirmado por Derpacif pregunta 2). Se
 * agrupan acá porque se repiten en 8 de los 9 métodos del manual.
 */
export interface ContextoSiat3000 {
  wsdlUrl: string;
  proveedor: string; // 3 caracteres
  ruc: string; // 13 caracteres, RUC de la cooperativa
  sucursal: string; // 3 dígitos, sucursal SRI del terminal
  // 3 dígitos reales (confirmado por Derpacif -- el manual dice 10,
  // ver CONTEXT.md 5.4 pregunta 5). Solo lo usan setAnulaVenta y
  // setVentaPasaje, pero vive acá para no repetir el contexto dos veces.
  puntoVenta: string;
  usuario: string; // nick -- tratar como secreto
}

export async function getBus(ctx: ContextoSiat3000): Promise<FilaBus[]> {
  const cliente = await obtenerCliente(ctx.wsdlUrl);
  const [resultado] = await cliente.getBusAsync({
    proveedor: ctx.proveedor,
    ruc: ctx.ruc,
    usuario: ctx.usuario,
  });
  return normalizarFilas<FilaBus>(resultado);
}

export async function getUsuario(
  ctx: ContextoSiat3000,
): Promise<FilaUsuario[]> {
  const cliente = await obtenerCliente(ctx.wsdlUrl);
  const [resultado] = await cliente.getUsuarioAsync({
    proveedor: ctx.proveedor,
    ruc: ctx.ruc,
  });
  return normalizarFilas<FilaUsuario>(resultado);
}

export async function getRuta(ctx: ContextoSiat3000): Promise<FilaRuta[]> {
  const cliente = await obtenerCliente(ctx.wsdlUrl);
  const [resultado] = await cliente.getRutaAsync({
    proveedor: ctx.proveedor,
    ruc: ctx.ruc,
    sucursal: ctx.sucursal,
    usuario: ctx.usuario,
  });
  return normalizarFilas<FilaRuta>(resultado);
}

export async function getDestinoRuta(
  ctx: ContextoSiat3000,
  rutaCodigoTerminal: string,
): Promise<FilaDestinoRuta[]> {
  const cliente = await obtenerCliente(ctx.wsdlUrl);
  const [resultado] = await cliente.getDestinoRutaAsync({
    proveedor: ctx.proveedor,
    ruc: ctx.ruc,
    sucursal: ctx.sucursal,
    ruta: rutaCodigoTerminal,
    usuario: ctx.usuario,
  });
  return normalizarFilas<FilaDestinoRuta>(resultado);
}

export async function getFrecuenciaRuta(
  ctx: ContextoSiat3000,
  rutaCodigoTerminal: string,
): Promise<FilaFrecuenciaRuta[]> {
  const cliente = await obtenerCliente(ctx.wsdlUrl);
  const [resultado] = await cliente.getFrecuenciaRutaAsync({
    proveedor: ctx.proveedor,
    ruc: ctx.ruc,
    sucursal: ctx.sucursal,
    ruta: rutaCodigoTerminal,
    usuario: ctx.usuario,
  });
  return normalizarFilas<FilaFrecuenciaRuta>(resultado);
}

/**
 * setCrearViaje -- confirmado por Derpacif (pregunta 8): se crea a
 * diario, una vez por cada frecuencia/ruta de la cooperativa, y el
 * código resultante se reutiliza en todas las ventas de ese día. Nunca
 * llamar por cada venta individual -- ver mapeo_entidades_terminal
 * (tipo 'viaje') para el cacheo por fila de `viajes` local.
 */
export async function setCrearViaje(
  ctx: ContextoSiat3000,
  datos: {
    fecha: string; // yyyy-MM-dd
    ruta: string;
    bus: string; // disco
    frecuencia: string; // hora
    tipo: 'N' | 'E';
  },
): Promise<string> {
  const cliente = await obtenerCliente(ctx.wsdlUrl);
  const [resultado] = await cliente.setCrearViajeAsync({
    proveedor: ctx.proveedor,
    ruc: ctx.ruc,
    sucursal: ctx.sucursal,
    fecha: datos.fecha,
    ruta: datos.ruta,
    bus: datos.bus,
    frecuencia: datos.frecuencia,
    tipo: datos.tipo,
    usuario: ctx.usuario,
  });
  return normalizarTexto(resultado);
}

/**
 * setAnulaVenta -- nota exacta del manual: "se anulará solo la venta
 * del boleto, pero la tasa no se anula". Nunca prometer devolución de
 * tasa (RF-014 del Requerimiento Funcional TTM).
 */
export async function setAnulaVenta(
  ctx: ContextoSiat3000,
  datos: { factura: string; codViaje: string },
): Promise<string> {
  const cliente = await obtenerCliente(ctx.wsdlUrl);
  const [resultado] = await cliente.setAnulaVentaAsync({
    proveedor: ctx.proveedor,
    ruc: ctx.ruc,
    sucursal: ctx.sucursal,
    punto: ctx.puntoVenta,
    factura: datos.factura,
    cod_viaje: datos.codViaje,
    usuario: ctx.usuario,
  });
  return normalizarTexto(resultado);
}

export async function setCambioBus(
  ctx: ContextoSiat3000,
  datos: { codViaje: string; bus: string },
): Promise<string> {
  const cliente = await obtenerCliente(ctx.wsdlUrl);
  const [resultado] = await cliente.setCambioBusAsync({
    proveedor: ctx.proveedor,
    ruc: ctx.ruc,
    sucursal: ctx.sucursal,
    cod_viaje: datos.codViaje,
    bus: datos.bus,
    usuario: ctx.usuario,
  });
  return normalizarTexto(resultado);
}

/**
 * setVentaPasaje -- registra la venta y devuelve la tasa (QR). Longitudes
 * y significados confirmados por Derpacif el 15-sep-2026 (CONTEXT.md
 * 5.4), corrigiendo el diccionario de datos original:
 * - `identi`: 13 caracteres (RUC estándar), no 1 como decía el manual.
 * - `punto`: 3 dígitos (secuencial SRI), no 10 como decía el manual.
 * - `tipcli`: '04' RUC, '05' persona natural, '06' pasaporte,
 *   '07' consumidor final.
 * El código de tasa devuelto se usa directo como contenido del QR, sin
 * cifrado/checksum/caducidad adicional (confirmado, pregunta 7).
 */
export async function setVentaPasaje(
  ctx: ContextoSiat3000,
  datos: {
    factura: string;
    codViaje: string;
    tipcli: '04' | '05' | '06' | '07';
    identi: string;
    razon: string;
    direc?: string;
    mail?: string;
    destino: string;
    total: number;
    detalle: DetalleVentaPasaje[];
  },
): Promise<RespuestaVentaPasaje> {
  const cliente = await obtenerCliente(ctx.wsdlUrl);
  const [resultado] = await cliente.setVentaPasajeAsync({
    proveedor: ctx.proveedor,
    ruc: ctx.ruc,
    sucursal: ctx.sucursal,
    punto: ctx.puntoVenta,
    factura: datos.factura,
    cod_viaje: datos.codViaje,
    tipcli: datos.tipcli,
    identi: datos.identi,
    razon: datos.razon,
    direc: datos.direc ?? '',
    mail: datos.mail ?? '',
    destino: datos.destino,
    total: datos.total,
    usuario: ctx.usuario,
    detalle: datos.detalle,
  });
  const filas = normalizarFilas<RespuestaVentaPasaje>(resultado);
  const fila = filas[0];
  if (!fila) {
    throw new Error(
      'setVentaPasaje no devolvió ninguna fila -- revisar la forma real de la respuesta SOAP contra el WSDL vigente.',
    );
  }
  return fila;
}
