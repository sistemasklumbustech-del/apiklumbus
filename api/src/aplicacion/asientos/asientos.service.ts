import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import type { AsientoRepositorio } from '../../dominio/asientos/asientos.ports';
import { extraerNumerosValidos } from '../../dominio/asientos/distribucion-asientos.util';

export const ASIENTO_REPOSITORIO = 'ASIENTO_REPOSITORIO';

@Injectable()
export class AsientosService {
  constructor(
    @Inject(ASIENTO_REPOSITORIO) private readonly asientos: AsientoRepositorio,
  ) {}

  /** RF-SEAT-001 — mapa de asientos por tipo de unidad. */
  async obtenerMapa(viajeId: string) {
    const mapa = await this.asientos.obtenerMapa(viajeId);
    if (!mapa) {
      throw new NotFoundException('Viaje no encontrado.');
    }
    return mapa;
  }

  /**
   * RF-SEAT-003/004/005 — selección visual, bloqueo temporal, y
   * prevención de doble venta. La prevención de doble venta se garantiza
   * a nivel de base de datos (SELECT ... FOR UPDATE dentro de una
   * transacción, ver AsientoRepositorioDrizzle) — dos solicitudes
   * simultáneas sobre el mismo asiento quedan serializadas por el propio
   * motor de Postgres, no por lógica de aplicación que podría fallar bajo
   * concurrencia real.
   */

  // Item 31, Fase 7 (11-ago-2026) -- compra como invitado. Exactamente
  // uno de usuarioId/sesionInvitadoId trae valor, nunca los 2.
  async bloquearAsiento(
    viajeId: string,
    numeroAsiento: string,
    usuarioId: string | null,
    sesionInvitadoId: string | null,
  ) {
    if (!usuarioId && !sesionInvitadoId) {
      throw new BadRequestException(
        'Falta identificar quien bloquea este asiento -- token de sesion o de invitado.',
      );
    }
    const [cooperativaId, mapa] = await Promise.all([
      this.asientos.obtenerCooperativaDelViaje(viajeId),
      this.asientos.obtenerMapa(viajeId),
    ]);
    if (!cooperativaId || !mapa) {
      throw new NotFoundException('Viaje no encontrado.');
    }

    // Hallazgo real, cerrado 22-jul-2026: antes se podía bloquear un
    // número de asiento que no existe en el vehículo (ej. "ZZ99") sin
    // que el sistema lo rechazara — la tabla viaje_asientos se llena
    // "perezosamente" (solo al primer toque), así que un número
    // inventado simplemente se insertaba sin validar contra la
    // capacidad real del vehículo.
    //
    // Ítem 14 (05-ago-2026) -- bug real corregido: antes esta validación
    // usaba su propia cuadrícula 2+2 hardcodeada, ignorando por completo
    // distribucionAsientos -- si una cooperativa configuraba un mapa
    // real distinto (necesario para poder poner etiquetas por asiento),
    // el bloqueo rechazaba asientos válidos que no coincidían con la
    // suposición genérica. Ahora usa la distribución real, con el mismo
    // respaldo 2+2 solo cuando no hay ninguna configurada.
    if (!extraerNumerosValidos(mapa.distribucionAsientos, mapa.capacidadTotal).has(numeroAsiento)) {
      throw new NotFoundException(
        `El asiento ${numeroAsiento} no existe en este vehículo.`,
      );
    }

    const resultado = await this.asientos.bloquear(
      viajeId,
      numeroAsiento,
      usuarioId,
      sesionInvitadoId,
      cooperativaId,
    );

    if (!resultado.exito) {
      const mensaje =
        resultado.motivo === 'ocupado'
          ? 'Ese asiento ya fue vendido.'
          : 'Ese asiento está siendo reservado por otra persona en este momento. Intenta con otro.';
      throw new ConflictException(mensaje);
    }

    return { estado: 'bloqueado_temporal', expiraEn: resultado.expiraEn };
  }
}
