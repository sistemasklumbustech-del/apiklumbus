import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type {
  AuditoriaConsultaRepositorio,
  FiltrosAuditoria,
  RegistroAuditoria,
} from '../../dominio/auditoria/auditoria.ports';

export const AUDITORIA_CONSULTA_REPOSITORIO = 'AUDITORIA_CONSULTA_REPOSITORIO';

/** Marca de orden de bytes UTF-8: sin ella Excel abre el CSV con los acentos rotos. */
const BOM_UTF8 = String.fromCharCode(0xfeff);

/** Tope de filas de una exportación: suficiente para revisar un período, sin armar archivos gigantes. */
const MAXIMO_FILAS_EXPORTACION = 10000;

const ENCABEZADOS_CSV = [
  'Fecha (Ecuador)',
  'Acción',
  'Origen',
  'Resultado',
  'Usuario',
  'Correo',
  'Rol',
  'Entidad',
  'ID de la entidad',
  'Dirección IP',
  'Detalle',
];

/**
 * Una celda de CSV: comillas escapadas, y una comilla simple delante si
 * empieza con = + - @ (Excel la trataría como fórmula -- el contenido
 * viene de datos que escribe un usuario, como el correo de un intento de
 * inicio de sesión).
 */
function celdaCsv(valor: string | null): string {
  const texto = valor ?? '';
  const seguro = /^[=+\-@]/.test(texto) ? `'${texto}` : texto;
  return `"${seguro.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

function fechaEcuador(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', {
    timeZone: 'America/Guayaquil',
  });
}

@Injectable()
export class AuditoriaService {
  constructor(
    @Inject(AUDITORIA_CONSULTA_REPOSITORIO)
    private readonly consulta: AuditoriaConsultaRepositorio,
  ) {}

  private validarRango(desde?: string, hasta?: string) {
    if (desde && hasta && desde > hasta) {
      throw new BadRequestException(
        'La fecha "desde" no puede ser posterior a "hasta".',
      );
    }
  }

  listar(filtros: FiltrosAuditoria) {
    this.validarRango(filtros.desde, filtros.hasta);
    return this.consulta.listar(filtros);
  }

  listarAcciones() {
    return this.consulta.listarAcciones();
  }

  /** CSV (con BOM para que Excel respete los acentos) de los registros que cumplen los filtros. */
  async exportarCsv(
    filtros: Omit<FiltrosAuditoria, 'pagina' | 'limite'>,
  ): Promise<string> {
    this.validarRango(filtros.desde, filtros.hasta);
    const registros: RegistroAuditoria[] =
      await this.consulta.listarParaExportar(filtros, MAXIMO_FILAS_EXPORTACION);
    const lineas = [ENCABEZADOS_CSV.map(celdaCsv).join(',')];
    for (const r of registros) {
      lineas.push(
        [
          fechaEcuador(r.creadoEn),
          r.accion,
          r.origen === 'sistema' ? 'Sistema' : 'Usuario',
          r.resultado === 'fallo' ? 'Fallo' : 'Éxito',
          r.usuarioNombre,
          r.usuarioCorreo,
          r.usuarioRol,
          r.entidadTipo,
          r.entidadId,
          r.direccionIp,
          r.detalle === null || r.detalle === undefined
            ? ''
            : JSON.stringify(r.detalle),
        ]
          .map(celdaCsv)
          .join(','),
      );
    }
    return `${BOM_UTF8}${lineas.join('\r\n')}\r\n`;
  }
}
