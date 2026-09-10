import { Inject, Injectable } from '@nestjs/common';
import type { ApiExternaRepositorio } from '../../dominio/api-externa/api-externa.ports';

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
}
