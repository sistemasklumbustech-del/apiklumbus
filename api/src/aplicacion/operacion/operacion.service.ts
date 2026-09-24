import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type {
  FiltrosOperacion,
  FiltrosViajesOperacion,
  OperacionRepositorio,
} from '../../dominio/operacion/operacion.ports';
import { armarCsv } from '../comun/csv.util';

export const OPERACION_REPOSITORIO = 'OPERACION_REPOSITORIO';

/** Rango máximo consultable, para no armar consultas enormes sobre toda la historia. */
const MAXIMO_DIAS_RANGO = 366;
/** Tope de filas de una exportación. */
const MAXIMO_FILAS_EXPORTACION = 10000;
const MAXIMO_RUTAS_DESTACADAS = 15;

const ETIQUETA_ESTADO: Record<string, string> = {
  programado: 'Programado',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
};

@Injectable()
export class OperacionService {
  constructor(
    @Inject(OPERACION_REPOSITORIO)
    private readonly repo: OperacionRepositorio,
  ) {}

  private validarRango(filtros: FiltrosOperacion) {
    if (!filtros.desde && !filtros.hasta) return;
    // Con solo una de las dos fechas, la otra es la misma (un día).
    const desde = filtros.desde ?? filtros.hasta!;
    const hasta = filtros.hasta ?? filtros.desde!;
    const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
    if (Number.isNaN(ms(desde)) || Number.isNaN(ms(hasta))) {
      throw new BadRequestException('Las fechas no son válidas.');
    }
    if (ms(desde) > ms(hasta)) {
      throw new BadRequestException(
        'La fecha "desde" no puede ser posterior a "hasta".',
      );
    }
    if ((ms(hasta) - ms(desde)) / 86400000 > MAXIMO_DIAS_RANGO) {
      throw new BadRequestException(
        `El rango máximo es de ${MAXIMO_DIAS_RANGO} días.`,
      );
    }
    filtros.desde = desde;
    filtros.hasta = hasta;
  }

  resumen(filtros: FiltrosOperacion) {
    this.validarRango(filtros);
    return this.repo.resumen(filtros);
  }

  listarViajes(filtros: FiltrosViajesOperacion) {
    this.validarRango(filtros);
    return this.repo.listarViajes(filtros);
  }

  rutasDestacadas(filtros: FiltrosOperacion) {
    this.validarRango(filtros);
    return this.repo.rutasDestacadas(filtros, MAXIMO_RUTAS_DESTACADAS);
  }

  alertas() {
    return this.repo.alertas();
  }

  opcionesRutas(cooperativaId?: string) {
    return this.repo.opcionesRutas(cooperativaId);
  }

  async exportarCsv(filtros: FiltrosOperacion): Promise<string> {
    this.validarRango(filtros);
    const viajes = await this.repo.viajesParaExportar(
      filtros,
      MAXIMO_FILAS_EXPORTACION,
    );
    return armarCsv(
      [
        'Fecha',
        'Hora',
        'Cooperativa',
        'Ruta',
        'Placa',
        'Estado',
        'Capacidad',
        'Boletos vendidos',
        'Ocupación (%)',
        'Ingresos (USD)',
      ],
      viajes.map((v) => [
        v.fechaSalida,
        v.horaSalida,
        v.cooperativa,
        v.ruta,
        v.placa,
        ETIQUETA_ESTADO[v.estado] ?? v.estado,
        v.capacidad,
        v.vendidos,
        v.ocupacion,
        v.ingresos.toFixed(2),
      ]),
    );
  }
}
