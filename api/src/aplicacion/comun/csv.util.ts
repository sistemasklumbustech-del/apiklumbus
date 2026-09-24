/** Marca de orden de bytes UTF-8: sin ella Excel abre el CSV con los acentos rotos. */
const BOM_UTF8 = String.fromCharCode(0xfeff);

/**
 * Una celda de CSV: comillas escapadas, sin saltos de línea, y una
 * comilla simple delante si empieza con = + - @ (Excel la trataría como
 * fórmula -- el contenido puede venir de datos que escribe un usuario).
 */
export function celdaCsv(valor: string | number | null | undefined): string {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  const seguro = /^[=+\-@]/.test(texto) ? `'${texto}` : texto;
  return `"${seguro.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

/** Arma el CSV completo (con BOM y saltos de línea de Windows) a partir de encabezados y filas. */
export function armarCsv(
  encabezados: string[],
  filas: (string | number | null | undefined)[][],
): string {
  const lineas = [encabezados.map(celdaCsv).join(',')];
  for (const fila of filas) {
    lineas.push(fila.map(celdaCsv).join(','));
  }
  return `${BOM_UTF8}${lineas.join('\r\n')}\r\n`;
}
