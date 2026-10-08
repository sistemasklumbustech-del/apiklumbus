import { Inject, Injectable } from '@nestjs/common';
import type { ApiExternaRepositorio, DatosViajeExterno } from '../../dominio/api-externa/api-externa.ports';

export const API_EXTERNA_REPOSITORIO = 'API_EXTERNA_REPOSITORIO';

@Injectable()
export class ApiExternaService {
  constructor(
    @Inject(API_EXTERNA_REPOSITORIO) private readonly repo: ApiExternaRepositorio,
  ) {}

  validarCredencial(apiKeyPrefix: string, secreto: string) {
    return this.repo.validarCredencial(apiKeyPrefix, secreto);
  }

  actualizarPrecioViaje(cooperativaId: string, viajeId: string, precioBase: number) {
    return this.repo.actualizarPrecioViaje(cooperativaId, viajeId, precioBase);
  }

  actualizarUbicacionViaje(
    cooperativaId: string,
    viajeId: string,
    latitud: number,
    longitud: number,
  ) {
    return this.repo.actualizarUbicacionViaje(cooperativaId, viajeId, latitud, longitud);
  }

  listarEventosWebhook(cooperativaId: string, desde?: string, hasta?: string) {
    return this.repo.listarEventosWebhook(cooperativaId, desde, hasta);
  }

  catalogo(cooperativaId: string) {
    return this.repo.catalogo(cooperativaId);
  }

  /** La fecha de salida se deriva de la hora, en hora de Ecuador: la cooperativa envía un solo dato, no dos que puedan contradecirse. */
  guardarViaje(
    cooperativaId: string,
    referenciaExterna: string,
    datos: Omit<DatosViajeExterno, 'fechaSalida'>,
  ) {
    const fechaSalida = new Date(datos.horaSalidaProgramada).toLocaleDateString('en-CA', {
      timeZone: 'America/Guayaquil',
    });
    return this.repo.guardarViaje(cooperativaId, referenciaExterna, { ...datos, fechaSalida });
  }

  asientosDeViaje(cooperativaId: string, viajeId: string) {
    return this.repo.asientosDeViaje(cooperativaId, viajeId);
  }

  ocuparAsientos(cooperativaId: string, viajeId: string, asientos: { numero: string; referencia?: string }[]) {
    return this.repo.ocuparAsientos(cooperativaId, viajeId, asientos);
  }

  liberarAsientos(cooperativaId: string, viajeId: string, numeros: string[]) {
    return this.repo.liberarAsientos(cooperativaId, viajeId, numeros);
  }
}
