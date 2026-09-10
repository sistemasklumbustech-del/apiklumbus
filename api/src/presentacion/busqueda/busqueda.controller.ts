import { Controller, Get, Query, Param, BadRequestException } from '@nestjs/common';
import { BusquedaService } from '../../aplicacion/busqueda/busqueda.service';
import { BuscarViajesDto } from './dto/buscar-viajes.dto';
import { BuscarPuntosOperacionDto } from './dto/buscar-puntos-operacion.dto';

/** Item 11 (04-ago-2026) -- catalogo cerrado, mismo que enums.ts amenidadEnum. */
const AMENIDADES_VALIDAS = [
  'wifi',
  'aire_acondicionado',
  'bano_a_bordo',
  'cargadores',
  'asientos_reclinables',
  'tv',
];

@Controller()
export class BusquedaController {
  constructor(private readonly busqueda: BusquedaService) {}

  /** RF-BUS-002 */
  @Get('puntos-operacion/buscar')
  async buscarPuntosOperacion(@Query() query: BuscarPuntosOperacionDto) {
    return this.busqueda.buscarPuntosOperacion(query.texto, query.soloConRutas);
  }

  /**
   * Fase 2-portada (16-ago-2026) -- terminales aliadas reales, para
   * la sección de la portada. Mismo criterio público que el resto de
   * este controlador -- sin autenticación. A diferencia de
   * `/puntos-operacion/buscar`, esta lista TODAS las terminales
   * aprobadas sin necesitar texto de búsqueda -- una terminal recién
   * aliada (ej. Machala) debe verse aquí aunque todavía no tenga
   * ninguna ruta real asociada.
   */
  @Get('puntos-operacion/aliadas')
  async listarTerminalesAliadas() {
    return this.busqueda.listarTerminalesAliadas();
  }

  /** RF-BUS-001, RF-BUS-003, RF-BUS-006 -- item 11 agrega filtros de hora, tipo de vehiculo y amenidades. */
  @Get('viajes/buscar')
  async buscarViajes(@Query() query: BuscarViajesDto) {
    const amenidades = query.amenidades
      ? query.amenidades.split(',').map((a) => a.trim())
      : undefined;
    if (amenidades) {
      const invalida = amenidades.find((a) => !AMENIDADES_VALIDAS.includes(a));
      if (invalida) {
        throw new BadRequestException(
          `"${invalida}" no es una amenidad valida. Valores permitidos: ${AMENIDADES_VALIDAS.join(', ')}.`,
        );
      }
    }
    return this.busqueda.buscarViajes({
      origenId: query.origenId,
      destinoId: query.destinoId,
      fecha: query.fecha,
      pasajerosMinimos: query.pasajeros ?? 1,
      horaDesde: query.horaDesde,
      horaHasta: query.horaHasta,
      tipoVehiculoId: query.tipoVehiculoId,
      amenidades,
    });
  }

  /** Banners propios activos, para la portada -- sin autenticacion (22-jul-2026). */
  @Get('banners-propios')
  async listarBannersActivos() {
    return this.busqueda.listarBannersActivos();
  }

  /**
   * Item 16, Fase 2 (05-ago-2026) -- seguimiento GPS en vivo, consulta
   * publica sin autenticacion. null si el viaje no tiene GPS conectado
   * todavia (bloqueo externo de hardware, no de codigo).
   */
  @Get('viajes/:id/ubicacion')
  async obtenerUbicacionViaje(@Param('id') viajeId: string) {
    return this.busqueda.obtenerUbicacionViaje(viajeId);
  }

  /** Paradas intermedias del trayecto -- RF-COOP-002, Fase 1 (20-ago-2026). */
  @Get('viajes/:id/paradas')
  async listarParadasDeViaje(@Param('id') viajeId: string) {
    return this.busqueda.listarParadasDeViaje(viajeId);
  }

  /** Contacto de soporte para el footer publico (20-ago-2026). */
  @Get('contacto-soporte')
  async obtenerContactoSoporte() {
    return this.busqueda.obtenerContactoSoporte();
  }

  /**
   * Fase 7-portada (07-ago-2026) -- rutas reales disponibles con precio
   * de referencia, para la portada. Sin autenticacion, mismo criterio
   * publico que el resto de este controlador.
   */
  @Get('rutas-disponibles')
  async listarRutasDisponibles() {
    return this.busqueda.listarRutasDisponibles();
  }

  /**
   * Fase 7-portada (07-ago-2026) -- contador real de cooperativas
   * activas y rutas disponibles, para la prueba social de la portada.
   * Sin autenticacion.
   */
  @Get('estadisticas-publicas')
  async obtenerEstadisticasPublicas() {
    return this.busqueda.obtenerEstadisticasPublicas();
  }
}