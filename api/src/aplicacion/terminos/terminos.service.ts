import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { TerminosRepositorio, VersionTerminos } from '../../dominio/terminos/terminos.ports';

export const TERMINOS_REPOSITORIO = 'TERMINOS_REPOSITORIO';

/**
 * RF-024 — versionado de Términos y Condiciones. Ver comentario de
 * diseño completo en db/schema/terminos.ts.
 */
@Injectable()
export class TerminosService {
  constructor(
    @Inject(TERMINOS_REPOSITORIO) private readonly repo: TerminosRepositorio,
  ) {}

  async obtenerVigente(): Promise<VersionTerminos> {
    const vigente = await this.repo.obtenerVigente();
    if (!vigente) {
      throw new BadRequestException(
        'No hay una versión de los Términos y Condiciones publicada todavía.',
      );
    }
    return vigente;
  }

  /** Fail-fast, antes de crear cuenta o compra -- no vale la pena bloquear asientos o cobrar nada si el checkbox no vino marcado. */
  validarAceptada(aceptoTerminos: boolean): void {
    if (!aceptoTerminos) {
      throw new BadRequestException(
        'Debes aceptar los Términos y Condiciones para continuar.',
      );
    }
  }

  /**
   * Registra la aceptación contra la versión vigente EN ESTE MOMENTO --
   * nunca contra un id que mande el cliente, para que no se pueda
   * "aceptar" una versión vieja a mano.
   */
  async registrarAceptacion(datos: {
    usuarioId?: string;
    compraId?: string;
    direccionIp?: string;
  }): Promise<void> {
    const vigente = await this.obtenerVigente();
    await this.repo.registrarAceptacion({
      terminosVersionId: vigente.id,
      usuarioId: datos.usuarioId,
      compraId: datos.compraId,
      direccionIp: datos.direccionIp,
    });
  }
}
