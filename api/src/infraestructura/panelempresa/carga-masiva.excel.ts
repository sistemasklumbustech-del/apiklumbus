import ExcelJS from 'exceljs';
import { esCedulaEcuatorianaValida } from '../../dominio/ventas/validadores-documento';
import type {
  DatosImportacion,
  ItemImportConductor,
  ItemImportHorario,
  ItemImportRuta,
  ItemImportTipoVehiculo,
  ItemImportUnidad,
} from '../../dominio/panelempresa/panel-empresa.ports';

/**
 * Carga masiva por plantilla Excel (24-sep-2026). Reemplaza el JSON pegado
 * a mano: la cooperativa descarga la plantilla, la llena con nombres (de
 * ciudades, de tipos de vehículo, de rutas -- nunca IDs) y la sube. Aquí se
 * genera la plantilla y se traduce lo que llenó al mismo formato
 * (`DatosImportacion`) que ya acepta la importación, avisando cada error
 * con su hoja y su fila.
 */

export interface PuntoCatalogo {
  id: string;
  nombre: string;
  ciudad: string;
  provincia: string;
  tipo: string;
}
export interface RutaCatalogo {
  id: string;
  nombre: string | null;
  origenCiudad: string;
  destinoCiudad: string;
}
export interface CatalogoCooperativa {
  puntos: PuntoCatalogo[];
  tiposVehiculo: { id: string; nombre: string }[];
  rutas: RutaCatalogo[];
  cedulas: Set<string>;
  placas: Set<string>;
}

export interface ErrorCarga {
  hoja: string;
  /** Fila del Excel (la 1 es el encabezado); 0 si el error es de toda la hoja. */
  fila: number;
  mensaje: string;
}

export interface ResumenCarga {
  tiposVehiculo: number;
  conductores: number;
  unidades: number;
  rutas: number;
  horarios: number;
  generarViajes: { desde: string; hasta: string } | null;
}

export interface AnalisisCarga {
  datos: DatosImportacion;
  errores: ErrorCarga[];
  resumen: ResumenCarga;
}

const HOJA = {
  instrucciones: 'Instrucciones',
  tipos: 'Tipos de vehículo',
  conductores: 'Conductores',
  unidades: 'Unidades',
  rutas: 'Rutas',
  horarios: 'Horarios',
  viajes: 'Generar viajes',
  referencia: 'Terminales y ciudades',
} as const;

const ENCABEZADOS = {
  tipos: ['Nombre', 'Capacidad (asientos)'],
  conductores: [
    'Nombre completo',
    'Cédula',
    'Licencia número (opcional)',
    'Licencia categoría (opcional)',
    'Teléfono (opcional)',
  ],
  unidades: ['Tipo de vehículo', 'Placa', 'Identificador operativo'],
  rutas: ['Origen', 'Destino', 'Precio base (USD)', 'Nombre (opcional)'],
  horarios: ['Ruta', 'Tipo de vehículo', 'Hora de salida (HH:MM)', 'Días'],
  viajes: ['Generar viajes desde', 'Generar viajes hasta'],
  referencia: ['Ciudad', 'Provincia', 'Nombre del terminal o punto', 'Tipo'],
};

const MAX_FILAS_POR_HOJA = 500;
const MAX_DIAS_GENERAR = 120;

/** Minúsculas, sin tildes ni signos, espacios simples -- para comparar nombres escritos a mano. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- plantilla

export async function generarPlantilla(
  puntos: PuntoCatalogo[],
): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Klumbus';

  const instrucciones = libro.addWorksheet(HOJA.instrucciones);
  instrucciones.getColumn(1).width = 110;
  const lineas = [
    'CARGA MASIVA — cómo llenar esta plantilla',
    '',
    '1. Llena solo las hojas que necesites; las demás pueden quedar vacías. Empieza cada hoja en la fila 2 (la fila 1 es el encabezado, no la borres).',
    '2. Escribe NOMBRES, nunca códigos: las ciudades como aparecen en la hoja "Terminales y ciudades", los tipos de vehículo como los escribiste en la hoja "Tipos de vehículo" (o como ya los tienes creados).',
    '3. Tipos de vehículo: nombre y cantidad de asientos. Puedes armar los pisos, VIP y baño después en Unidades.',
    '4. Conductores: cédula ecuatoriana de 10 dígitos. Unidades: placa como ABC-1234.',
    '5. Rutas: origen y destino (ciudad o nombre del terminal) y el precio base. Si una ciudad tiene varios terminales, escribe el nombre exacto del terminal.',
    '6. Horarios: la ruta (su nombre o "Origen - Destino"), el tipo de vehículo, la hora de salida en formato 24 horas (08:00, 14:30) y los días. Días: "Lunes a viernes", "Todos", "L-V", "L,M,X,J,V,S,D" (X = miércoles).',
    '7. Generar viajes (opcional): si pones las dos fechas (AAAA-MM-DD), se crean los viajes de tus horarios en ese rango. Máximo 120 días.',
    '8. Súbela en Carga masiva: primero se revisa todo y ves qué se creará y qué filas tienen errores. No se guarda nada hasta que confirmes.',
    '',
    'Ejemplos (bórralos si los copias):',
    '  Tipos de vehículo → Bus 40 asientos | 40',
    '  Conductores → Juan Pérez | 0912345678',
    '  Unidades → Bus 40 asientos | ABC-1234 | Unidad 1',
    '  Rutas → Machala | Guayaquil | 8.50',
    '  Horarios → Machala - Guayaquil | Bus 40 asientos | 08:00 | Lunes a viernes',
  ];
  lineas.forEach((l, i) => {
    const fila = instrucciones.getRow(i + 1);
    fila.getCell(1).value = l;
    fila.getCell(1).alignment = { wrapText: true, vertical: 'top' };
  });
  instrucciones.getRow(1).font = { bold: true, size: 14 };

  const agregarHoja = (
    nombre: string,
    encabezados: string[],
    anchos: number[],
  ) => {
    const hoja = libro.addWorksheet(nombre);
    hoja.addRow(encabezados);
    const cab = hoja.getRow(1);
    cab.font = { bold: true, color: { argb: 'FF1F2937' } };
    cab.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF5A800' },
    };
    anchos.forEach((w, i) => (hoja.getColumn(i + 1).width = w));
    hoja.views = [{ state: 'frozen', ySplit: 1 }];
    return hoja;
  };

  agregarHoja(HOJA.tipos, ENCABEZADOS.tipos, [32, 22]);
  agregarHoja(HOJA.conductores, ENCABEZADOS.conductores, [34, 16, 26, 28, 20]);
  agregarHoja(HOJA.unidades, ENCABEZADOS.unidades, [30, 16, 28]);
  agregarHoja(HOJA.rutas, ENCABEZADOS.rutas, [28, 28, 20, 30]);
  agregarHoja(HOJA.horarios, ENCABEZADOS.horarios, [34, 30, 24, 28]);
  const viajes = agregarHoja(HOJA.viajes, ENCABEZADOS.viajes, [26, 26]);
  viajes.getColumn(1).numFmt = '@';
  viajes.getColumn(2).numFmt = '@';

  const referencia = agregarHoja(
    HOJA.referencia,
    ENCABEZADOS.referencia,
    [24, 24, 44, 22],
  );
  [...puntos]
    .sort(
      (a, b) =>
        a.ciudad.localeCompare(b.ciudad, 'es') ||
        a.nombre.localeCompare(b.nombre, 'es'),
    )
    .forEach((p) =>
      referencia.addRow([p.ciudad, p.provincia, p.nombre, p.tipo]),
    );

  return Buffer.from(await libro.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ lectura

function textoDeCelda(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number') return String(valor);
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'object') {
    const v = valor as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text: string }[])
        .map((t) => t.text)
        .join('')
        .trim();
    }
    if (typeof v.result === 'string' || typeof v.result === 'number') {
      return String(v.result).trim();
    }
    if (typeof v.text === 'string') return v.text.trim();
  }
  return '';
}

interface FilaLeida {
  numero: number;
  celdas: ExcelJS.CellValue[];
}

function leerHoja(libro: ExcelJS.Workbook, nombre: string): FilaLeida[] {
  const hoja = libro.getWorksheet(nombre);
  if (!hoja) return [];
  const filas: FilaLeida[] = [];
  hoja.eachRow({ includeEmpty: false }, (fila, numero) => {
    if (numero === 1) return; // encabezado
    const celdas: ExcelJS.CellValue[] = [];
    for (let c = 1; c <= 6; c++) celdas.push(fila.getCell(c).value);
    if (celdas.every((c) => textoDeCelda(c) === '')) return;
    filas.push({ numero, celdas });
  });
  return filas;
}

const DIAS_ORDEN = [1, 2, 3, 4, 5, 6, 0]; // lunes … domingo (0 = domingo, como el resto del sistema)
const DIAS_TOKEN: Record<string, number> = {
  l: 1,
  lun: 1,
  lunes: 1,
  m: 2,
  mar: 2,
  martes: 2,
  x: 3,
  mi: 3,
  mie: 3,
  miercoles: 3,
  j: 4,
  jue: 4,
  jueves: 4,
  v: 5,
  vie: 5,
  viernes: 5,
  s: 6,
  sab: 6,
  sabado: 6,
  d: 0,
  dom: 0,
  domingo: 0,
};

/** "Lunes a viernes", "L-V", "L,M,X", "Todos" → [1,2,3,4,5]; null si no se entiende. */
export function interpretarDias(texto: string): number[] | null {
  const t = normalizar(texto);
  if (!t) return null;
  if (/^(todos|todos los dias|diario|todos dias|cada dia)$/.test(t)) {
    return [0, 1, 2, 3, 4, 5, 6];
  }
  const conjunto = new Set<number>();
  // separa en partes por coma, punto y coma, "y"
  const partes = texto
    .split(/[,;]|\sy\s/i)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const parte of partes) {
    const rango = parte.split(/\s+a\s+|\s+al\s+|\s+hasta\s+|\s*[-–]\s*/i);
    const tokens = rango.map(
      (r) => DIAS_TOKEN[normalizar(r).replace(/\s/g, '')],
    );
    if (tokens.some((d) => d === undefined)) return null;
    if (tokens.length === 1) {
      conjunto.add(tokens[0]);
    } else if (tokens.length === 2) {
      const desde = DIAS_ORDEN.indexOf(tokens[0]);
      const hasta = DIAS_ORDEN.indexOf(tokens[1]);
      for (let i = desde; ; i = (i + 1) % 7) {
        conjunto.add(DIAS_ORDEN[i]);
        if (i === hasta) break;
      }
    } else {
      return null;
    }
  }
  return conjunto.size > 0 ? [...conjunto].sort((a, b) => a - b) : null;
}

function interpretarHora(valor: ExcelJS.CellValue): string | null {
  if (valor instanceof Date) {
    const h = valor.getUTCHours();
    const m = valor.getUTCMinutes();
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  if (typeof valor === 'number' && valor >= 0 && valor < 1) {
    const minutos = Math.round(valor * 24 * 60);
    return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
  }
  const t = textoDeCelda(valor);
  const m = /^(\d{1,2})[:.h](\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function interpretarFecha(valor: ExcelJS.CellValue): string | null {
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  const t = textoDeCelda(valor);
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return t;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function interpretarNumero(valor: ExcelJS.CellValue): number | null {
  if (typeof valor === 'number') return valor;
  const t = textoDeCelda(valor).replace(/[$\s]/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

function normalizarPlaca(texto: string): string | null {
  const t = texto.toUpperCase().replace(/\s/g, '');
  const m = /^([A-Z]{3})-?(\d{3,4})$/.exec(t);
  return m ? `${m[1]}-${m[2]}` : null;
}

// ----------------------------------------------------------------- análisis

export async function analizarPlantilla(
  buffer: Buffer,
  cat: CatalogoCooperativa,
): Promise<AnalisisCarga> {
  const errores: ErrorCarga[] = [];
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return {
      datos: {},
      errores: [
        {
          hoja: '',
          fila: 0,
          mensaje:
            'No se pudo leer el archivo. Sube la plantilla en formato Excel (.xlsx).',
        },
      ],
      resumen: resumenVacio(),
    };
  }

  const err = (hoja: string, fila: number, mensaje: string) =>
    errores.push({ hoja, fila, mensaje });

  for (const nombre of [
    HOJA.tipos,
    HOJA.conductores,
    HOJA.unidades,
    HOJA.rutas,
    HOJA.horarios,
  ]) {
    if (leerHoja(libro, nombre).length > MAX_FILAS_POR_HOJA) {
      err(nombre, 0, `Máximo ${MAX_FILAS_POR_HOJA} filas por hoja.`);
    }
  }

  // --- tipos de vehículo
  const tiposNuevos = new Map<string, string>(); // nombre normalizado -> ref
  const tipos: ItemImportTipoVehiculo[] = [];
  const tiposExistentes = new Map(
    cat.tiposVehiculo.map((t) => [normalizar(t.nombre), t.id]),
  );
  for (const f of leerHoja(libro, HOJA.tipos)) {
    const nombre = textoDeCelda(f.celdas[0]);
    const capacidad = interpretarNumero(f.celdas[1]);
    if (!nombre) {
      err(HOJA.tipos, f.numero, 'Falta el nombre del tipo de vehículo.');
      continue;
    }
    if (
      capacidad === null ||
      !Number.isInteger(capacidad) ||
      capacidad < 1 ||
      capacidad > 100
    ) {
      err(
        HOJA.tipos,
        f.numero,
        'La capacidad debe ser un número entero de asientos entre 1 y 100.',
      );
      continue;
    }
    const clave = normalizar(nombre);
    if (tiposNuevos.has(clave)) {
      err(HOJA.tipos, f.numero, `"${nombre}" está repetido en el archivo.`);
      continue;
    }
    if (tiposExistentes.has(clave)) {
      err(
        HOJA.tipos,
        f.numero,
        `Ya tienes un tipo de vehículo llamado "${nombre}". Quítalo de esta hoja y úsalo por su nombre en Unidades y Horarios.`,
      );
      continue;
    }
    const ref = `t${tipos.length + 1}`;
    tiposNuevos.set(clave, ref);
    tipos.push({ ref, nombre, capacidadTotal: capacidad });
  }
  const resolverTipo = (
    texto: string,
    hoja: string,
    fila: number,
  ): string | null => {
    const clave = normalizar(texto);
    const ref = tiposNuevos.get(clave) ?? tiposExistentes.get(clave);
    if (!ref) {
      err(
        hoja,
        fila,
        `No existe el tipo de vehículo "${texto}". Agrégalo en la hoja "Tipos de vehículo" o revisa cómo está escrito.`,
      );
      return null;
    }
    return ref;
  };

  // --- conductores
  const conductores: ItemImportConductor[] = [];
  const cedulasArchivo = new Set<string>();
  for (const f of leerHoja(libro, HOJA.conductores)) {
    const nombre = textoDeCelda(f.celdas[0]);
    const cedula = textoDeCelda(f.celdas[1])
      .replace(/\D/g, '')
      .padStart(10, '0');
    if (!nombre) {
      err(HOJA.conductores, f.numero, 'Falta el nombre del conductor.');
      continue;
    }
    if (!esCedulaEcuatorianaValida(cedula)) {
      err(
        HOJA.conductores,
        f.numero,
        `La cédula de ${nombre} no es válida (10 dígitos).`,
      );
      continue;
    }
    if (cat.cedulas.has(cedula) || cedulasArchivo.has(cedula)) {
      err(
        HOJA.conductores,
        f.numero,
        `La cédula ${cedula} ya está registrada${cedulasArchivo.has(cedula) ? ' en otra fila de este archivo' : ''}.`,
      );
      continue;
    }
    cedulasArchivo.add(cedula);
    conductores.push({
      nombreCompleto: nombre,
      cedula,
      licenciaNumero: textoDeCelda(f.celdas[2]) || undefined,
      licenciaCategoria: textoDeCelda(f.celdas[3]) || undefined,
      telefono: textoDeCelda(f.celdas[4]) || undefined,
    });
  }

  // --- unidades
  const unidades: ItemImportUnidad[] = [];
  const placasArchivo = new Set<string>();
  for (const f of leerHoja(libro, HOJA.unidades)) {
    const tipoTexto = textoDeCelda(f.celdas[0]);
    const placa = normalizarPlaca(textoDeCelda(f.celdas[1]));
    const ident = textoDeCelda(f.celdas[2]);
    if (!tipoTexto) {
      err(HOJA.unidades, f.numero, 'Falta el tipo de vehículo.');
      continue;
    }
    if (!placa) {
      err(
        HOJA.unidades,
        f.numero,
        `La placa "${textoDeCelda(f.celdas[1])}" no tiene el formato ABC-1234.`,
      );
      continue;
    }
    if (!ident) {
      err(
        HOJA.unidades,
        f.numero,
        'Falta el identificador operativo (por ejemplo "Unidad 1").',
      );
      continue;
    }
    if (cat.placas.has(placa) || placasArchivo.has(placa)) {
      err(
        HOJA.unidades,
        f.numero,
        `La placa ${placa} ya está registrada${placasArchivo.has(placa) ? ' en otra fila de este archivo' : ''}.`,
      );
      continue;
    }
    const tipoRef = resolverTipo(tipoTexto, HOJA.unidades, f.numero);
    if (!tipoRef) continue;
    placasArchivo.add(placa);
    unidades.push({
      tipoVehiculoRef: tipoRef,
      placa,
      identificadorOperativo: ident,
    });
  }

  // --- rutas
  const puntosPorNombre = new Map<string, PuntoCatalogo[]>();
  const puntosPorCiudad = new Map<string, PuntoCatalogo[]>();
  for (const p of cat.puntos) {
    const n = normalizar(p.nombre);
    puntosPorNombre.set(n, [...(puntosPorNombre.get(n) ?? []), p]);
    const c = normalizar(p.ciudad);
    puntosPorCiudad.set(c, [...(puntosPorCiudad.get(c) ?? []), p]);
  }
  const resolverPunto = (
    texto: string,
    hoja: string,
    fila: number,
  ): PuntoCatalogo | null => {
    const clave = normalizar(texto);
    const porNombre = puntosPorNombre.get(clave);
    if (porNombre?.length === 1) return porNombre[0];
    const candidatos = porNombre?.length
      ? porNombre
      : puntosPorCiudad.get(clave);
    if (!candidatos?.length) {
      err(
        hoja,
        fila,
        `No encontramos "${texto}". Usa una ciudad o terminal de la hoja "Terminales y ciudades".`,
      );
      return null;
    }
    if (candidatos.length === 1) return candidatos[0];
    const terminales = candidatos.filter(
      (p) => p.tipo === 'terminal_terrestre',
    );
    if (terminales.length === 1) return terminales[0];
    err(
      hoja,
      fila,
      `"${texto}" tiene varios puntos (${candidatos.map((p) => p.nombre).join(', ')}). Escribe el nombre exacto del terminal.`,
    );
    return null;
  };

  interface RutaNueva {
    ref: string;
    claves: Set<string>;
  }
  const rutas: ItemImportRuta[] = [];
  const rutasNuevas: RutaNueva[] = [];
  const parRutasArchivo = new Set<string>();
  for (const f of leerHoja(libro, HOJA.rutas)) {
    const origenTexto = textoDeCelda(f.celdas[0]);
    const destinoTexto = textoDeCelda(f.celdas[1]);
    const precio = interpretarNumero(f.celdas[2]);
    if (!origenTexto || !destinoTexto) {
      err(HOJA.rutas, f.numero, 'Faltan el origen o el destino.');
      continue;
    }
    if (precio === null || precio <= 0 || precio > 500) {
      err(
        HOJA.rutas,
        f.numero,
        'El precio base debe ser un número mayor a 0 (por ejemplo 8.50).',
      );
      continue;
    }
    const origen = resolverPunto(origenTexto, HOJA.rutas, f.numero);
    const destino = resolverPunto(destinoTexto, HOJA.rutas, f.numero);
    if (!origen || !destino) continue;
    if (origen.id === destino.id) {
      err(
        HOJA.rutas,
        f.numero,
        'El origen y el destino no pueden ser el mismo.',
      );
      continue;
    }
    const nombre =
      textoDeCelda(f.celdas[3]) || `${origen.ciudad} - ${destino.ciudad}`;
    const par = `${origen.id}>${destino.id}>${normalizar(nombre)}`;
    if (parRutasArchivo.has(par)) {
      err(
        HOJA.rutas,
        f.numero,
        `La ruta "${nombre}" está repetida en el archivo.`,
      );
      continue;
    }
    parRutasArchivo.add(par);
    const ref = `r${rutas.length + 1}`;
    rutas.push({
      ref,
      origenPuntoOperacionId: origen.id,
      destinoPuntoOperacionId: destino.id,
      precioBaseReferencia: precio,
      nombre,
    });
    rutasNuevas.push({
      ref,
      claves: new Set([
        normalizar(nombre),
        normalizar(`${origen.ciudad} ${destino.ciudad}`),
        normalizar(`${origen.nombre} ${destino.nombre}`),
      ]),
    });
  }
  const resolverRuta = (texto: string, fila: number): string | null => {
    const clave = normalizar(texto);
    const nueva = rutasNuevas.find((r) => r.claves.has(clave));
    if (nueva) return nueva.ref;
    const existentes = cat.rutas.filter(
      (r) =>
        (r.nombre && normalizar(r.nombre) === clave) ||
        normalizar(`${r.origenCiudad} ${r.destinoCiudad}`) === clave,
    );
    if (existentes.length === 1) return existentes[0].id;
    if (existentes.length > 1) {
      err(
        HOJA.horarios,
        fila,
        `Tienes varias rutas llamadas "${texto}". Escribe el nombre exacto de la que quieres.`,
      );
      return null;
    }
    err(
      HOJA.horarios,
      fila,
      `No existe la ruta "${texto}". Agrégala en la hoja "Rutas" o escríbela como "Origen - Destino".`,
    );
    return null;
  };

  // --- horarios
  const horarios: ItemImportHorario[] = [];
  const clavesHorario = new Set<string>();
  for (const f of leerHoja(libro, HOJA.horarios)) {
    const rutaTexto = textoDeCelda(f.celdas[0]);
    const tipoTexto = textoDeCelda(f.celdas[1]);
    if (!rutaTexto || !tipoTexto) {
      err(HOJA.horarios, f.numero, 'Faltan la ruta o el tipo de vehículo.');
      continue;
    }
    const hora = interpretarHora(f.celdas[2]);
    if (!hora) {
      err(
        HOJA.horarios,
        f.numero,
        'La hora debe estar en formato 24 horas, por ejemplo 08:00 o 14:30.',
      );
      continue;
    }
    const dias = interpretarDias(textoDeCelda(f.celdas[3]));
    if (!dias) {
      err(
        HOJA.horarios,
        f.numero,
        'No se entendieron los días. Usa por ejemplo "Lunes a viernes", "Todos" o "L,M,X,J,V,S,D".',
      );
      continue;
    }
    const rutaRef = resolverRuta(rutaTexto, f.numero);
    const tipoRef = resolverTipo(tipoTexto, HOJA.horarios, f.numero);
    if (!rutaRef || !tipoRef) continue;
    const clave = `${rutaRef}|${tipoRef}|${hora}|${dias.join('')}`;
    if (clavesHorario.has(clave)) {
      err(HOJA.horarios, f.numero, 'Este horario está repetido en el archivo.');
      continue;
    }
    clavesHorario.add(clave);
    horarios.push({
      rutaRef,
      tipoVehiculoRef: tipoRef,
      horaSalida: hora,
      diasSemana: dias,
    });
  }

  // --- generar viajes (opcional)
  let generar: { desde: string; hasta: string } | null = null;
  const filaViajes = leerHoja(libro, HOJA.viajes)[0];
  if (filaViajes) {
    const desdeTxt = textoDeCelda(filaViajes.celdas[0]);
    const hastaTxt = textoDeCelda(filaViajes.celdas[1]);
    if (desdeTxt || hastaTxt) {
      const desde = interpretarFecha(filaViajes.celdas[0]);
      const hasta = interpretarFecha(filaViajes.celdas[1]);
      if (!desde || !hasta) {
        err(
          HOJA.viajes,
          filaViajes.numero,
          'Escribe las dos fechas en formato AAAA-MM-DD (por ejemplo 2026-10-01).',
        );
      } else if (hasta < desde) {
        err(
          HOJA.viajes,
          filaViajes.numero,
          'La fecha "hasta" no puede ser anterior a la fecha "desde".',
        );
      } else if (
        (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) /
          86_400_000 >
        MAX_DIAS_GENERAR
      ) {
        err(
          HOJA.viajes,
          filaViajes.numero,
          `El rango no puede pasar de ${MAX_DIAS_GENERAR} días.`,
        );
      } else if (horarios.length === 0) {
        err(
          HOJA.viajes,
          filaViajes.numero,
          'Para generar viajes necesitas al menos un horario en la hoja "Horarios".',
        );
      } else {
        generar = { desde, hasta };
      }
    }
  }

  const total =
    tipos.length +
    conductores.length +
    unidades.length +
    rutas.length +
    horarios.length;
  if (total === 0 && errores.length === 0) {
    err(
      '',
      0,
      'La plantilla está vacía: llena al menos una hoja (desde la fila 2).',
    );
  }

  const datos: DatosImportacion = {
    ...(tipos.length ? { tiposVehiculo: tipos } : {}),
    ...(conductores.length ? { conductores } : {}),
    ...(unidades.length ? { unidades } : {}),
    ...(rutas.length ? { rutas } : {}),
    ...(horarios.length ? { horarios } : {}),
    ...(generar
      ? { generarViajesDesde: generar.desde, generarViajesHasta: generar.hasta }
      : {}),
  };

  return {
    datos,
    errores,
    resumen: {
      tiposVehiculo: tipos.length,
      conductores: conductores.length,
      unidades: unidades.length,
      rutas: rutas.length,
      horarios: horarios.length,
      generarViajes: generar,
    },
  };
}

function resumenVacio(): ResumenCarga {
  return {
    tiposVehiculo: 0,
    conductores: 0,
    unidades: 0,
    rutas: 0,
    horarios: 0,
    generarViajes: null,
  };
}
