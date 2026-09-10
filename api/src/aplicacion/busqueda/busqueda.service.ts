import { Inject, Injectable } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { and, eq, ilike, ne, or, sql } from 'drizzle-orm';
import {
  viajes,
  rutas,
  rutaParadas,
  cooperativas,
  unidades,
  tiposVehiculo,
  puntosOperacion,
  viajeAsientos,
  bannersPropios,
  configuracionPlataforma,
} from '@columbus/db';
import { DRIZZLE_DB_PUBLICO } from '../../infraestructura/database/database.module';
import type { DrizzleDb } from '../../infraestructura/database/database.provider';

/**
 * Ítem 12, Fase 2 (05-ago-2026) -- decisión del director, confirmada
 * con datos reales de la base de desarrollo (ninguna cooperativa tenía
 * más de 1 calificación al momento de decidir esto). Mismo criterio
 * que usan Google/Amazon: un mínimo antes de mostrar el promedio como
 * señal pública de confianza.
 */
const UMBRAL_MINIMO_CALIFICACIONES = 5;

/**
 * RF-BUS — búsqueda y disponibilidad. Usa DRIZZLE_DB_PUBLICO (rol con
 * BYPASSRLS) a propósito: un pasajero buscando pasajes debe ver
 * resultados de TODAS las cooperativas a la vez (RF-BUS-003,
 * "resultados multi-cooperativa"), no solo de una — este es exactamente
 * el caso de uso para el que se diseñó esa conexión (ver el comentario
 * largo en database.module.ts).
 */
@Injectable()
export class BusquedaService {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  /** RF-BUS-002 — autocompletado de ciudades/terminales. */
  async buscarPuntosOperacion(texto: string, soloConRutas = true) {
    const textoNormalizado = texto.trim();
    // Prioridad de relevancia (hallazgo documentado, cerrado
    // 22-jul-2026): antes no había ORDER BY, así que Postgres devolvía
    // los resultados en el orden que le resultara más cómodo
    // internamente, no por qué tan bien coincidían con lo escrito.
    // Ahora: coincidencia exacta de ciudad primero, luego "la ciudad
    // empieza con...", luego "el nombre del punto empieza con...",
    // luego cualquier coincidencia parcial — y alfabético como
    // desempate dentro de cada grupo.
    const relevancia = sql<number>`
      CASE
        WHEN ${puntosOperacion.ciudad} ILIKE ${textoNormalizado} THEN 0
        WHEN ${puntosOperacion.ciudad} ILIKE ${textoNormalizado + '%'} THEN 1
        WHEN ${puntosOperacion.nombre} ILIKE ${textoNormalizado + '%'} THEN 2
        ELSE 3
      END
    `;
    const tieneRutaReal = sql`EXISTS (
      SELECT 1 FROM ${rutas}
      WHERE ${rutas.origenPuntoOperacionId} = ${puntosOperacion.id}
         OR ${rutas.destinoPuntoOperacionId} = ${puntosOperacion.id}
    )`;
    return this.db
      .select({
        id: puntosOperacion.id,
        nombre: puntosOperacion.nombre,
        ciudad: puntosOperacion.ciudad,
        provincia: puntosOperacion.provincia,
        tipo: puntosOperacion.tipo,
        latitud: puntosOperacion.latitud,
        longitud: puntosOperacion.longitud,
      })
      .from(puntosOperacion)
      .where(
        and(
          eq(puntosOperacion.estado, 'aprobado'),
          or(
            ilike(puntosOperacion.ciudad, `%${textoNormalizado}%`),
            ilike(puntosOperacion.nombre, `%${textoNormalizado}%`),
          ),
          // Bug real encontrado (26-ago-2026, auditoría real del
          // director): este filtro tiene sentido para el buscador
          // público del pasajero (no mostrar ciudades sin viajes),
          // pero bloqueaba por completo a una cooperativa nueva
          // creando su primera ruta -- ni siquiera un punto recién
          // aprobado por el admin podía encontrarse, porque recién
          // aprobado todavía tiene 0 rutas reales. `soloConRutas` deja
          // que el panel de cooperativa lo desactive explícitamente.
          soloConRutas ? tieneRutaReal : undefined,
          // Hallazgo real del director (21-ago-2026): una oficina
          // propia de una cooperativa (ej. "Panamericana -- Oficina
          // La Colon") no debe aparecer en la busqueda general -- se
          // presta a confusion antes de que la persona haya elegido
          // ninguna cooperativa. Solo las terminales publicas
          // compartidas aparecen aqui; el punto exacto de cada
          // cooperativa se muestra despues, dentro de su propia
          // tarjeta de resultado.
          ne(puntosOperacion.tipo, 'oficina_agencia'),
        ),
      )
      .orderBy(relevancia, puntosOperacion.ciudad)
      .limit(10);
  }

  /**
   * RF-BUS-001 — búsqueda por origen/destino/fecha.
   * RF-BUS-003 — multi-cooperativa (implícito: no se filtra por
   * cooperativa en ningún momento de esta consulta).
   * RF-BUS-006 — disponibilidad en tiempo real, considerando asientos
   * bloqueados temporalmente por otras compras en curso (no solo los ya
   * vendidos).
   *
   * Ítem 11, Fase 2 (04-ago-2026) -- filtros nuevos de hora, tipo de
   * vehículo y amenidades. Se pasa un objeto de parámetros en vez de
   * seguir agregando argumentos posicionales (ya eran 4, con estos 4
   * nuevos hubiera sido ilegible).
   */
  async buscarViajes(params: {
    origenId: string;
    destinoId: string;
    fecha: string;
    pasajerosMinimos: number;
    horaDesde?: string;
    horaHasta?: string;
    tipoVehiculoId?: string;
    amenidades?: string[];
  }) {
    const { origenId, destinoId, fecha, pasajerosMinimos, horaDesde, horaHasta, tipoVehiculoId, amenidades } = params;

    // Hallazgo real del director (21-ago-2026, con un ejemplo real:
    // Tulcan -> Quito, donde una cooperativa llega a Carcelen a $9 y
    // otra a Quitumbe a $10 -- ambos son viajes reales y validos, pero
    // antes la busqueda exigia coincidencia EXACTA del punto elegido,
    // asi que elegir "Quitumbe" escondia la opcion real de Carcelen.
    // Ahora se resuelve la CIUDAD real de los puntos elegidos, y se
    // busca por ciudad completa -- cada cooperativa sigue mostrando su
    // propio punto exacto de llegada dentro de su propia tarjeta,
    // nada de eso cambia.
    const [puntoOrigenReal] = await this.db
      .select({ ciudad: puntosOperacion.ciudad })
      .from(puntosOperacion)
      .where(eq(puntosOperacion.id, origenId));
    const [puntoDestinoReal] = await this.db
      .select({ ciudad: puntosOperacion.ciudad })
      .from(puntosOperacion)
      .where(eq(puntosOperacion.id, destinoId));
    if (!puntoOrigenReal || !puntoDestinoReal) {
      return [];
    }
    const origenCiudad = puntoOrigenReal.ciudad;
    const destinoCiudad = puntoDestinoReal.ciudad;

    // Union doble de puntos_operacion: una vez como origen, otra como destino.
    const origen = alias(puntosOperacion, 'origen');
    const destino = alias(puntosOperacion, 'destino');

    // Subconsulta escalar: asientos NO disponibles (ocupados o en hold)
    // para este viaje específico. Si el viaje todavía no tiene filas en
    // viaje_asientos (nunca se inicializó su mapa), el count da 0 y toda
    // la capacidad del vehículo se reporta como disponible — fallback
    // correcto, no un error.
    const asientosNoDisponibles = sql<number>`(
      SELECT count(*)::int FROM ${viajeAsientos}
      WHERE ${viajeAsientos.viajeId} = ${viajes.id}
        AND ${viajeAsientos.estado} != 'disponible'
    )`;

    const asientosDisponibles = sql<number>`(${tiposVehiculo.capacidadTotal} - ${asientosNoDisponibles})`;

    // Igual patrón que asientosDisponibles: subconsulta escalar, para no
    // necesitar un GROUP BY que complicaría el resto del SELECT.
    const calificacionPromedio = sql<string | null>`(
      SELECT AVG(puntuacion) FROM calificaciones WHERE cooperativa_id = ${cooperativas.id}
    )`;
    const calificacionCantidad = sql<number>`(
      SELECT COUNT(*)::int FROM calificaciones WHERE cooperativa_id = ${cooperativas.id}
    )`;

    // Ítem 11 -- condiciones opcionales, agregadas solo si el pasajero
    // las pidió. horaDesde/horaHasta convierte a hora local Ecuador
    // antes de comparar (la columna es timestamptz en UTC).
    const condiciones = [
      eq(origen.ciudad, origenCiudad),
      eq(destino.ciudad, destinoCiudad),
      eq(viajes.fechaSalida, fecha),
      eq(viajes.estado, 'programado'),
      // Cooperativas proponen sus propios puntos de operación
      // (13-ago-2026) -- un punto todavía pendiente de revisión (o ya
      // rechazado) nunca debe aparecer en un resultado de búsqueda real.
      eq(origen.estado, 'aprobado'),
      eq(destino.estado, 'aprobado'),
    ];

    if (horaDesde && horaHasta) {
      condiciones.push(
        sql`(${viajes.horaSalidaProgramada} AT TIME ZONE 'America/Guayaquil')::time BETWEEN ${horaDesde}::time AND ${horaHasta}::time`,
      );
    }

    if (tipoVehiculoId) {
      condiciones.push(eq(tiposVehiculo.id, tipoVehiculoId));
    }

    // AND, no OR -- mismo criterio que sql.join ya probado y corregido
    // en el ítem 7 (bug real ANY() vs IN()): el array de JS nunca se
    // interpola directo en el template, cada valor va como su propio
    // parámetro ligado dentro de un ARRAY[...] construido a mano.
    if (amenidades && amenidades.length > 0) {
      condiciones.push(
        sql`${tiposVehiculo.amenidades} @> ARRAY[${sql.join(
          amenidades.map((a) => sql`${a}::amenidad`),
          sql`, `,
        )}]::amenidad[]`,
      );
    }

    const resultados = await this.db
      .select({
        viajeId: viajes.id,
        // Reseñas de texto reales (13-ago-2026) -- faltaba para poder
        // pedir las reseñas de esta cooperativa desde el frontend; solo
        // se mostraba el nombre/logo, nunca el id real.
        cooperativaId: cooperativas.id,
        cooperativaNombre: cooperativas.nombreComercial,
        cooperativaLogoUrl: cooperativas.logoUrl,
        cooperativaCalificacionPromedio: calificacionPromedio.as(
          'calificacion_promedio',
        ),
        cooperativaCalificacionCantidad: calificacionCantidad.as(
          'calificacion_cantidad',
        ),
        rutaId: rutas.id,
        horaSalidaProgramada: viajes.horaSalidaProgramada,
        horaLlegadaEstimada: viajes.horaLlegadaEstimada,
        precioBase: viajes.precioBase,
        // Zona VIP de asientos (17-ago-2026) -- monto fijo adicional
        // real, configurado por la cooperativa en este viaje.
        recargoVip: viajes.recargoVip,
        tipoVehiculoId: tiposVehiculo.id,
        tipoVehiculoNombre: tiposVehiculo.nombre,
        tipoVehiculoCategoria: tiposVehiculo.categoria,
        // Ítem 11 -- visibles en resultados, no solo guardadas en la BD.
        tipoVehiculoAmenidades: tiposVehiculo.amenidades,
        asientosDisponibles: asientosDisponibles.as('asientos_disponibles'),
        origenLatitud: origen.latitud,
        origenLongitud: origen.longitud,
        destinoLatitud: destino.latitud,
        destinoLongitud: destino.longitud,
        // Orden real de la directora (16-ago-2026, protocolo de
        // medición precisa de referencias): la referencia real
        // mostraba el nombre de la terminal debajo de cada hora, no
        // solo la ciudad -- el JOIN con origen/destino ya existía
        // (se usaba para lat/long), solo faltaba seleccionar el
        // nombre real.
        origenNombre: origen.nombre,
        destinoNombre: destino.nombre,
        // Hallazgo real del director (21-ago-2026) -- dato informativo
        // real para el pasajero, junto a la duracion estimada.
        distanciaKm: rutas.distanciaKm,
      })
      .from(viajes)
      .innerJoin(rutas, eq(viajes.rutaId, rutas.id))
      .innerJoin(cooperativas, eq(viajes.cooperativaId, cooperativas.id))
      .innerJoin(unidades, eq(viajes.unidadId, unidades.id))
      .innerJoin(tiposVehiculo, eq(unidades.tipoVehiculoId, tiposVehiculo.id))
      .innerJoin(origen, eq(rutas.origenPuntoOperacionId, origen.id))
      .innerJoin(destino, eq(rutas.destinoPuntoOperacionId, destino.id))
      .where(and(...condiciones))
      // RF-BUS-001 — "ordenados por hora de salida".
      .orderBy(viajes.horaSalidaProgramada);

    // El filtro de "al menos N asientos disponibles" se aplica en
    // memoria, no en SQL, porque asientosDisponibles es una columna
    // calculada (subconsulta) y no todos los motores permiten filtrar
    // por un alias calculado en el mismo nivel del SELECT sin repetir la
    // expresión completa en el WHERE — más simple y igual de correcto
    // filtrarlo aquí dado que el volumen de resultados por ruta/fecha es
    // pequeño (decenas, no miles).
    //
    // Ítem 12, Fase 2 (05-ago-2026) -- umbral mínimo de calificaciones
    // antes de mostrar el promedio, decisión del director: una
    // cooperativa con 1 sola calificación de 5 estrellas no debería
    // verse igual de confiable que una con 200 reseñas y 4.8 promedio.
    // Ni promedio ni conteo se muestran por debajo del umbral -- ni
    // siquiera un aviso de "pocas reseñas", simplemente ausente. El
    // frontend ya oculta toda la insignia cuando esto es null, así que
    // no hace falta ningún cambio ahí.
    return resultados
      .filter((r) => r.asientosDisponibles >= pasajerosMinimos)
      .map((r) => ({
        ...r,
        cooperativaCalificacionPromedio:
          r.cooperativaCalificacionPromedio &&
          r.cooperativaCalificacionCantidad >= UMBRAL_MINIMO_CALIFICACIONES
            ? Number(r.cooperativaCalificacionPromedio)
            : null,
      }));
  }

  /** Banners propios activos, para la página pública — sin autenticación (22-jul-2026). */
  async listarBannersActivos() {
    return this.db
      .select({
        id: bannersPropios.id,
        titulo: bannersPropios.titulo,
        imagenUrl: bannersPropios.imagenUrl,
        enlaceUrl: bannersPropios.enlaceUrl,
      })
      .from(bannersPropios)
      .where(eq(bannersPropios.activo, true))
      .orderBy(bannersPropios.orden);
  }

  /**
   * Ítem 16, Fase 2 (05-ago-2026) -- seguimiento GPS en vivo, consulta
   * pública (sin autenticación, cualquiera con el id del viaje puede
   * ver su posición -- mismo criterio de "público" que el resto de este
   * service). null si el viaje no tiene GPS conectado todavía (la
   * enorme mayoría hoy, bloqueo externo de hardware, no de código).
   */
  async obtenerUbicacionViaje(viajeId: string): Promise<{
    latitud: number;
    longitud: number;
    actualizadaEn: Date;
  } | null> {
    const [fila] = await this.db
      .select({
        latitud: viajes.ubicacionLatitud,
        longitud: viajes.ubicacionLongitud,
        actualizadaEn: viajes.ubicacionActualizadaEn,
      })
      .from(viajes)
      .where(eq(viajes.id, viajeId));

    if (!fila || fila.latitud === null || fila.longitud === null || fila.actualizadaEn === null) {
      return null;
    }
    return {
      latitud: Number(fila.latitud),
      longitud: Number(fila.longitud),
      actualizadaEn: fila.actualizadaEn,
    };
  }

  /**
   * Paradas intermedias del trayecto de un viaje -- RF-COOP-002,
   * Fase 1 (20-ago-2026). El viaje no guarda sus propias paradas --
   * las hereda de su ruta, que es donde la cooperativa las carga.
   */
  async listarParadasDeViaje(viajeId: string): Promise<
    {
      orden: number;
      ciudad: string;
      nombre: string;
      tarifaDesdeOrigen: number;
      tiempoEstimadoDesdeOrigenMinutos: number | null;
    }[]
  > {
    const [filaViaje] = await this.db
      .select({ rutaId: viajes.rutaId })
      .from(viajes)
      .where(eq(viajes.id, viajeId));
    if (!filaViaje) return [];

    const filas = await this.db
      .select({
        orden: rutaParadas.orden,
        ciudad: puntosOperacion.ciudad,
        nombre: puntosOperacion.nombre,
        tarifaDesdeOrigen: rutaParadas.tarifaDesdeOrigen,
        tiempoEstimadoDesdeOrigenMinutos: rutaParadas.tiempoEstimadoDesdeOrigenMinutos,
      })
      .from(rutaParadas)
      .innerJoin(puntosOperacion, eq(puntosOperacion.id, rutaParadas.puntoOperacionId))
      .where(eq(rutaParadas.rutaId, filaViaje.rutaId))
      .orderBy(rutaParadas.orden);

    return filas.map((f) => ({
      orden: f.orden,
      ciudad: f.ciudad,
      nombre: f.nombre,
      tarifaDesdeOrigen: Number(f.tarifaDesdeOrigen),
      tiempoEstimadoDesdeOrigenMinutos: f.tiempoEstimadoDesdeOrigenMinutos,
    }));
  }

  /**
   * Contacto de soporte de la plataforma -- ya se usa en el PDF del
   * boleto (compra.repositorio.drizzle.ts), pero nunca en un
   * endpoint publico para el sitio web (20-ago-2026, footer real).
   */
  async obtenerContactoSoporte(): Promise<{ correo: string | null; telefono: string | null }> {
    const [fila] = await this.db
      .select({
        correo: configuracionPlataforma.soporteCorreo,
        telefono: configuracionPlataforma.soporteTelefono,
      })
      .from(configuracionPlataforma)
      .limit(1);
    return { correo: fila?.correo ?? null, telefono: fila?.telefono ?? null };
  }

  /**
   * Fase 7-portada (07-ago-2026) -- rutas reales disponibles con precio
   * de referencia, para la portada. Sin autenticacion, mismo criterio
   * publico que el resto de este service. Decision del director de
   * mostrar "rutas disponibles" (dato real) en vez de "populares"
   * (implicaria datos de demanda que hoy casi no existen en
   * produccion).
   */
  async listarRutasDisponibles(limite = 6) {
    const origen = alias(puntosOperacion, 'origen_ruta');
    const destino = alias(puntosOperacion, 'destino_ruta');
    return this.db
      .select({
        rutaId: rutas.id,
        origenCiudad: origen.ciudad,
        origenNombre: origen.nombre,
        destinoCiudad: destino.ciudad,
        destinoNombre: destino.nombre,
        precioReferencia: rutas.precioBaseReferencia,
      })
      .from(rutas)
      .innerJoin(origen, eq(rutas.origenPuntoOperacionId, origen.id))
      .innerJoin(destino, eq(rutas.destinoPuntoOperacionId, destino.id))
      .where(and(eq(origen.estado, 'aprobado'), eq(destino.estado, 'aprobado')))
      .orderBy(rutas.creadoEn)
      .limit(limite);
  }

  /**
   * Fase 2-portada (16-ago-2026) -- terminales aliadas reales para la
   * portada. Lista TODAS las terminales aprobadas, sin depender de
   * que ya tengan una ruta real asociada -- una terminal recién
   * aliada (ej. Machala) debe poder mostrarse desde el primer día,
   * antes de que cualquier cooperativa programe un viaje ahí.
   */
  async listarTerminalesAliadas() {
    return this.db
      .select({
        id: puntosOperacion.id,
        nombre: puntosOperacion.nombre,
        ciudad: puntosOperacion.ciudad,
      })
      .from(puntosOperacion)
      .where(and(eq(puntosOperacion.tipo, 'terminal_terrestre'), eq(puntosOperacion.estado, 'aprobado')))
      .orderBy(puntosOperacion.ciudad);
  }

  /**
   * Fase 7-portada (07-ago-2026) -- contador real de cooperativas
   * activas y rutas disponibles, para la prueba social de la portada.
   * Sin autenticacion. Solo cooperativas con estado 'aprobada' -- ningun
   * numero inventado.
   */
  async obtenerEstadisticasPublicas() {
    const resultadoCoop = await this.db.execute(
      sql`SELECT COUNT(*)::int AS total FROM ${cooperativas} WHERE estado = 'aprobada'`,
    );
    const resultadoRutas = await this.db.execute(sql`SELECT COUNT(*)::int AS total FROM ${rutas}`);
    return {
      cooperativasActivas: (resultadoCoop.rows[0] as { total: number }).total,
      rutasDisponibles: (resultadoRutas.rows[0] as { total: number }).total,
    };
  }
}
