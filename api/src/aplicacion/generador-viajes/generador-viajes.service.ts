import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
  GeneradorViajesRepositorio,
  HorarioActivoParaGenerar,
} from '../../dominio/generador-viajes/generador-viajes.ports';

export const GENERADOR_VIAJES_REPOSITORIO = 'GENERADOR_VIAJES_REPOSITORIO';

/** Genera viajes para los próximos N días -- suficiente margen para que la cooperativa vea y ajuste antes de que se vendan boletos. */
const DIAS_HACIA_ADELANTE = 21;

@Injectable()
export class GeneradorViajesService {
  private readonly logger = new Logger(GeneradorViajesService.name);

  constructor(
    @Inject(GENERADOR_VIAJES_REPOSITORIO)
    private readonly repo: GeneradorViajesRepositorio,
  ) {}

  /**
   * Corre una vez al día. Por cada plantilla activa, revisa los
   * próximos 21 días y crea el viaje SOLO si todavía no existe uno para
   * esa combinación (horario, fecha) -- nunca hace UPDATE, así que una
   * edición manual de un viaje ya generado queda intacta para siempre.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async generarViajesPendientes(): Promise<void> {
    const horarios = await this.repo.listarHorariosActivos();
    const hoy = new Date();
    const hasta = new Date();
    // -1 porque generarParaListaHorarios usa un rango INCLUSIVO del día
    // final (correcto para la carga masiva, donde el usuario espera que
    // "hasta el 15" incluya el 15) -- sin el -1 aquí, "21 días" se
    // convertía en 22 días reales. Bug real encontrado por la propia
    // prueba del ítem 7 al reutilizar este método para el ítem 8.
    hasta.setDate(hoy.getDate() + DIAS_HACIA_ADELANTE - 1);

    const { generados, saltadosSinUnidad } = await this.generarParaListaHorarios(
      horarios,
      hoy,
      hasta,
    );

    if (generados > 0 || saltadosSinUnidad > 0) {
      this.logger.log(
        `Generación de viajes: ${generados} creados, ${saltadosSinUnidad} plantilla(s) sin unidad disponible.`,
      );
    }
  }

  /**
   * Ítem 8 (04-ago-2026) -- reutilizado por la carga masiva
   * (importarDatos) para generar viajes de los horarios que acaba de
   * crear, en el rango de fechas que el usuario pidió. Mismo mecanismo
   * y mismo criterio de no-duplicados que el cron diario -- sin esto,
   * la carga masiva necesitaría su propio camino paralelo (el que
   * existía antes, más débil, ya eliminado).
   */
  async generarViajesParaHorarios(
    horarioIds: string[],
    fechaDesde: Date,
    fechaHasta: Date,
  ): Promise<{ generados: number }> {
    const horarios = await this.repo.listarHorariosPorId(horarioIds);
    const { generados } = await this.generarParaListaHorarios(
      horarios,
      fechaDesde,
      fechaHasta,
    );
    return { generados };
  }

  /**
   * Lógica compartida real -- antes de esto, generarViajesPendientes y
   * la carga masiva tenían cada uno su propia copia de este bucle
   * (parcialmente distinta e inconsistente). Nunca hace UPDATE, solo
   * INSERT si (horario, fecha) todavía no existe.
   */
  private async generarParaListaHorarios(
    horarios: HorarioActivoParaGenerar[],
    fechaDesde: Date,
    fechaHasta: Date,
  ): Promise<{ generados: number; saltadosSinUnidad: number }> {
    let generados = 0;
    let saltadosSinUnidad = 0;

    for (const horario of horarios) {
      const unidad = await this.repo.buscarUnidadDisponible(
        horario.cooperativaId,
        horario.tipoVehiculoPredeterminadoId,
      );
      if (!unidad) {
        saltadosSinUnidad++;
        this.logger.warn(
          `Horario ${horario.id}: no hay ninguna unidad activa del tipo ${horario.tipoVehiculoPredeterminadoId} -- se salta.`,
        );
        continue;
      }

      for (
        let fecha = new Date(fechaDesde);
        fecha <= fechaHasta;
        fecha.setDate(fecha.getDate() + 1)
      ) {
        const diaSemana = fecha.getDay(); // 0=domingo..6=sábado
        if (!horario.diasSemana.includes(diaSemana)) continue;

        const fechaStr = fecha.toISOString().slice(0, 10);
        const yaExiste = await this.repo.existeViajeParaHorarioYFecha(
          horario.id,
          fechaStr,
        );
        if (yaExiste) continue; // ya generado antes, o editado/creado a mano -- nunca se toca

        // Ecuador no tiene horario de verano -- desfase fijo -05:00.
        // slice(0,5) porque Postgres devuelve hora_salida ya con
        // segundos (HH:MM:SS), no HH:MM (bug real encontrado el
        // 03-ago-2026 por las pruebas del ítem 7).
        const horaSalidaCompleta = `${fechaStr}T${horario.horaSalida.slice(0, 5)}:00-05:00`;

        await this.repo.crearViajeDesdeHorario({
          cooperativaId: horario.cooperativaId,
          rutaId: horario.rutaId,
          unidadId: unidad.unidadId,
          horarioRutaOrigenId: horario.id,
          fechaSalida: fechaStr,
          horaSalidaProgramada: horaSalidaCompleta,
          precioBase: horario.precioBaseReferencia,
        });
        generados++;
      }
    }

    return { generados, saltadosSinUnidad };
  }
}
