import type { FilaConciliacionCruda } from './admin.ports';

/**
 * RF-017 -- reglas de conciliación pago↔boleto↔tasa↔comprobante.
 *
 * Deliberadamente NO marca como discrepancia el caso de un boleto
 * cancelado con una tasa ya cobrada: el manual de SIAT3000 y RF-014 del
 * Requerimiento Funcional TTM son explícitos en que anular una venta
 * NUNCA anula la tasa -- eso es el comportamiento esperado del sistema,
 * no un error que este reporte deba señalar.
 */
export function calcularDiscrepancias(fila: FilaConciliacionCruda): string[] {
  const discrepancias: string[] = [];

  const boletoActivo =
    fila.estadoBoleto === 'vigente' || fila.estadoBoleto === 'usado';
  const pagoAprobado = fila.estadoPago === 'aprobado';

  if (boletoActivo && !pagoAprobado) {
    discrepancias.push(
      `Boleto en estado '${fila.estadoBoleto}' sin un pago aprobado (pago: ${fila.estadoPago ?? 'inexistente'}).`,
    );
  }

  if (boletoActivo && pagoAprobado) {
    if (!fila.estadoRegistroTasa) {
      discrepancias.push(
        'Pago aprobado sin ningún registro de tasa de terminal (SIAT3000).',
      );
    } else if (fila.estadoRegistroTasa !== 'exitosa') {
      discrepancias.push(
        `Registro de tasa de terminal en estado '${fila.estadoRegistroTasa}', no 'exitosa'.`,
      );
    }
  }

  if (boletoActivo && pagoAprobado && fila.estadoRegistroTasa === 'exitosa') {
    const estados = fila.estadosComprobanteElectronico ?? [];
    if (estados.length === 0) {
      discrepancias.push('Sin comprobante electrónico emitido todavía.');
    } else if (estados.some((e) => e === 'rechazado')) {
      discrepancias.push('Comprobante electrónico rechazado por el SRI.');
    } else if (estados.some((e) => e !== 'autorizado')) {
      discrepancias.push('Comprobante electrónico pendiente de autorización.');
    }
  }

  return discrepancias;
}
