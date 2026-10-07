/**
 * Item 31.1, Fase 7 (13-ago-2026) -- validacion real de datos del
 * pasajero en checkout. Investigado con evidencia real antes de
 * construir (ver DOCUMENTO_MAESTRO.md, seccion 31.1):
 *
 * - Algoritmo de la cedula ecuatoriana (Modulo 10), confirmado con
 *   multiples fuentes independientes coincidentes.
 * - FlixBus confirma explicitamente que acepta pasaporte, cedula/
 *   tarjeta de identidad, y licencia de conducir -- de ahi que el
 *   pasaporte tambien sea un tipo de documento valido, no solo cedula.
 */

/**
 * Valida una cedula ecuatoriana con el algoritmo oficial Modulo 10.
 *
 * Reglas:
 * 1. Exactamente 10 digitos numericos.
 * 2. Los primeros 2 digitos son el codigo de provincia (01-24).
 * 3. El tercer digito debe ser menor a 6 (persona natural).
 * 4. Los primeros 9 digitos se multiplican por coeficientes alternados
 *    2,1,2,1,2,1,2,1,2 -- si el resultado de una multiplicacion es
 *    >= 10, se le resta 9 (equivalente a sumar sus digitos).
 * 5. Se suman todos los resultados.
 * 6. El digito verificador esperado es 10 - (suma % 10), o 0 si la
 *    suma ya es multiplo exacto de 10.
 * 7. Ese verificador debe coincidir con el decimo digito real.
 */
export function esCedulaEcuatorianaValida(cedula: string): boolean {
  if (!/^\d{10}$/.test(cedula)) return false;

  const provincia = parseInt(cedula.substring(0, 2), 10);
  if (provincia < 1 || provincia > 24) return false;

  const tercerDigito = parseInt(cedula[2], 10);
  if (tercerDigito >= 6) return false;

  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let valor = parseInt(cedula[i], 10) * coeficientes[i];
    if (valor >= 10) valor -= 9;
    suma += valor;
  }

  const digitoVerificadorEsperado = suma % 10 === 0 ? 0 : 10 - (suma % 10);
  const digitoVerificadorReal = parseInt(cedula[9], 10);
  return digitoVerificadorEsperado === digitoVerificadorReal;
}

/**
 * Validacion de pasaporte -- deliberadamente mas ligera que la de
 * cedula. El formato de un pasaporte varia por pais de origen (letras
 * y numeros combinados, longitudes distintas), asi que no existe un
 * checksum universal como el Modulo 10 -- se valida solo que el
 * formato sea razonable (alfanumerico, longitud plausible).
 */
export function esPasaporteValido(pasaporte: string): boolean {
  return /^[A-Za-z0-9]{5,20}$/.test(pasaporte.trim());
}

/** Valida un numero de documento segun el tipo declarado por el pasajero. */
export function esDocumentoValido(documento: string, tipoDocumento: 'cedula' | 'pasaporte'): boolean {
  return tipoDocumento === 'cedula'
    ? esCedulaEcuatorianaValida(documento)
    : esPasaporteValido(documento);
}

/**
 * RUC ecuatoriano (13 digitos) para facturar. Deliberadamente mas ligero que
 * un validador completo: persona natural (tercer digito 0-5) se valida con su
 * cedula (los primeros 10 digitos); sociedades privadas (9) y publicas (6) solo
 * por formato, porque hay RUC reales antiguos que no cumplen el Modulo 11 y
 * rechazarlos dejaria sin factura a clientes legitimos. En todos los casos los
 * ultimos 3 digitos (establecimiento) no pueden ser 000.
 */
export function esRucEcuatorianoValido(ruc: string): boolean {
  if (!/^\d{13}$/.test(ruc)) return false;
  if (ruc.endsWith('000')) return false;
  const tercerDigito = parseInt(ruc[2], 10);
  if (tercerDigito < 6) return esCedulaEcuatorianaValida(ruc.substring(0, 10));
  return tercerDigito === 6 || tercerDigito === 9;
}

export type TipoIdentificacionFacturacion = 'cedula' | 'ruc' | 'pasaporte';

/** Valida la identificacion con la que se factura, segun el tipo declarado. */
export function esIdentificacionFacturacionValida(
  identificacion: string,
  tipo: TipoIdentificacionFacturacion,
): boolean {
  if (tipo === 'ruc') return esRucEcuatorianoValido(identificacion);
  return esDocumentoValido(identificacion, tipo);
}

/**
 * Telefono movil ecuatoriano -- 10 digitos, siempre empieza con 09
 * (el prefijo de telefonia movil en Ecuador). No se valida telefono
 * fijo aqui a proposito: este campo se usa especificamente para
 * contacto por WhatsApp (ver item 31, compra como invitado), que
 * requiere un numero movil real.
 */
export function esTelefonoEcuadorMovilValido(telefono: string): boolean {
  return /^09\d{8}$/.test(telefono.trim());
}
