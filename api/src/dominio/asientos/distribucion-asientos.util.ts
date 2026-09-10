/**
 * Ítem 14, Fase 2 (05-ago-2026) — un solo sistema de etiquetas por
 * asiento individual (VIP, mujeres, cualquier combinación), sección 3.3
 * del documento maestro. Unifica el "VIP por piso completo" que existía
 * antes (nunca usado con datos reales, confirmado contra la base de
 * desarrollo el 05-ago-2026) dentro de este mismo mecanismo -- un
 * asiento puede llevar su propia etiqueta, heredar la del piso
 * completo, o ambas cosas a la vez.
 *
 * Compatibilidad hacia atrás PERMANENTE, no una migración de una sola
 * vez (decisión del director, 05-ago-2026): si algún día aparece una
 * distribución en el formato viejo (celda = solo el número, sin
 * etiquetas propias), sigue funcionando exactamente igual que hoy --
 * la etiqueta de piso.categoria se sigue heredando. Nunca se pierde
 * información por no migrar.
 *
 * ⚠ Debe mantenerse en sync con la copia idéntica de este archivo en
 * apps/web/lib/api.ts -- no hay un paquete de tipos compartido activo
 * en este monorepo todavía (ver nota histórica en flota.ts).
 */

export type Etiqueta = 'vip' | 'mujeres';

export const ETIQUETAS_VALIDAS: Etiqueta[] = ['vip', 'mujeres'];

/**
 * Una celda es: un asiento real (string = formato viejo, sin etiquetas
 * propias; objeto = formato nuevo, con etiquetas propias opcionales),
 * o null (pasillo, no es un asiento).
 */
export type Celda = string | null | { numero: string; etiquetas?: Etiqueta[] };

export interface PisoDistribucionAsientos {
  nombre: string;
  /** Formato viejo -- ya no se escribe desde el sistema nuevo, pero se sigue leyendo para heredar VIP (compatibilidad permanente). */
  categoria?: string;
  filas: Array<{ celdas: Celda[] }>;
}

export interface DistribucionAsientos {
  pisos?: PisoDistribucionAsientos[];
}

/**
 * Interpreta una celda contra su piso: null si es pasillo, o
 * { numero, etiquetas } con las etiquetas EFECTIVAS -- las propias de
 * la celda más la heredada del piso si piso.categoria === 'vip'
 * (sin distinguir mayúsculas/minúsculas, mismo criterio permisivo que
 * ya usaba el código viejo).
 */
export function interpretarCelda(
  celda: Celda,
  piso: PisoDistribucionAsientos,
): { numero: string; etiquetas: Etiqueta[] } | null {
  if (celda === null) return null;

  const esFormatoNuevo = typeof celda === 'object';
  const numero = esFormatoNuevo ? celda.numero : celda;
  const etiquetasPropias = esFormatoNuevo ? (celda.etiquetas ?? []) : [];
  const heredaVipDePiso = piso.categoria?.toLowerCase() === 'vip';

  const etiquetas = Array.from(
    new Set<Etiqueta>([
      ...etiquetasPropias,
      ...(heredaVipDePiso ? (['vip'] as Etiqueta[]) : []),
    ]),
  );

  return { numero, etiquetas };
}

/**
 * Generador de respaldo 2+2 -- sin cambios respecto al que ya existía,
 * solo movido aquí para que backend y frontend compartan exactamente
 * la misma lógica (antes vivían duplicados y podían desincronizarse).
 */
export function generarPisosDeRespaldo(capacidadTotal: number): PisoDistribucionAsientos[] {
  const letras = ['A', 'B', 'C', 'D'];
  const filas: Array<{ celdas: Celda[] }> = [];
  let restante = capacidadTotal;
  let numeroFila = 1;
  while (restante > 0) {
    const enEstaFila = Math.min(4, restante);
    const celdas: Celda[] = letras.slice(0, enEstaFila).map((l) => `${numeroFila}${l}`);
    celdas.splice(2, 0, null); // pasillo entre la 2da y 3ra columna
    filas.push({ celdas });
    restante -= enEstaFila;
    numeroFila++;
  }
  return [{ nombre: 'Piso único', filas }];
}

/** Pisos reales si existen, o el generador de respaldo -- mismo criterio de siempre, nadie se queda sin mapa de asientos. */
export function obtenerPisos(
  distribucion: unknown,
  capacidadTotal: number,
): PisoDistribucionAsientos[] {
  const d = distribucion as DistribucionAsientos | null | undefined;
  if (d && Array.isArray(d.pisos) && d.pisos.length > 0) return d.pisos;
  return generarPisosDeRespaldo(capacidadTotal);
}

/**
 * Ítem 14 (05-ago-2026) -- bug real encontrado antes de construir: el
 * bloqueo de asientos ignoraba por completo distribucionAsientos y
 * usaba su propia cuadrícula 2+2 hardcodeada, desincronizada de lo que
 * ve el pasajero. Si una cooperativa configura una distribución real
 * (necesario para poder poner etiquetas por asiento), el bloqueo debe
 * validar contra los números REALES, no contra una suposición genérica.
 */
export function extraerNumerosValidos(
  distribucion: unknown,
  capacidadTotal: number,
): Set<string> {
  const pisos = obtenerPisos(distribucion, capacidadTotal);
  const validos = new Set<string>();
  for (const piso of pisos) {
    for (const fila of piso.filas) {
      for (const celda of fila.celdas) {
        const interpretada = interpretarCelda(celda, piso);
        if (interpretada) validos.add(interpretada.numero);
      }
    }
  }
  return validos;
}
