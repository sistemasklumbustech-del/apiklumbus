import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminRepositorio,
  DatosNuevaCooperativa,
  DatosPrimerUsuarioCooperativa,
  DatosNuevoPuntoOperacion,
  FilaConteoUsuariosPorRol,
  ModoIvaBoleto,
  DatosNuevoAdministrador,
} from '../../dominio/admin/admin.ports';

export const ADMIN_REPOSITORIO = 'ADMIN_REPOSITORIO';

/**
 * 02-ago-2026 -- roles válidos del sistema (RF-AUTH-004), usados solo
 * para completar el desglose del contador con cantidad=0 en los roles
 * que no tengan ningún usuario activo todavía. No es la fuente de
 * verdad del enum (esa vive en packages/db/schema/enums.ts) -- es una
 * lista de presentación, para que el panel admin siempre muestre las 4
 * categorías aunque alguna esté vacía.
 */
const ROLES_VALIDOS = [
  'pasajero',
  'vendedor',
  'admin_cooperativa',
  'admin_plataforma',
] as const;

@Injectable()
export class AdminService {
  constructor(
    @Inject(ADMIN_REPOSITORIO) private readonly admin: AdminRepositorio,
  ) {}

  async crearCooperativaConPrimerUsuario(
    datosCooperativa: DatosNuevaCooperativa,
    datosUsuario: DatosPrimerUsuarioCooperativa,
  ) {
    return this.admin.crearCooperativaConPrimerUsuarioAtomico(
      datosCooperativa,
      datosUsuario,
    );
  }

  async listarCooperativas() {
    return this.admin.listarCooperativas();
  }

  async listarPuntosOperacion() {
    return this.admin.listarPuntosOperacion();
  }

  async crearPuntoOperacion(datos: DatosNuevoPuntoOperacion) {
    return this.admin.crearPuntoOperacion(datos);
  }

  async actualizarPuntoOperacion(
    id: string,
    datos: Partial<DatosNuevoPuntoOperacion>,
  ) {
    return this.admin.actualizarPuntoOperacion(id, datos);
  }

  async listarPuntosOperacionPendientes() {
    return this.admin.listarPuntosOperacionPendientes();
  }

  async aprobarPuntoOperacion(id: string, usuarioId: string) {
    return this.admin.aprobarPuntoOperacion(id, usuarioId);
  }

  async rechazarPuntoOperacion(id: string) {
    return this.admin.rechazarPuntoOperacion(id);
  }

  async dashboardNacional() {
    return this.admin.dashboardNacional();
  }

  async obtenerIvaNacional() {
    return this.admin.obtenerIvaNacional();
  }

  async actualizarYPropagarIvaNacional(
    nuevoPorcentaje: number,
    usuarioId: string,
  ) {
    return this.admin.actualizarYPropagarIvaNacional(
      nuevoPorcentaje,
      usuarioId,
    );
  }

  async obtenerCargoPlataforma() {
    return this.admin.obtenerCargoPlataforma();
  }

  async actualizarCargoPlataforma(nuevoMonto: number, usuarioId: string) {
    return this.admin.actualizarCargoPlataforma(nuevoMonto, usuarioId);
  }

  async obtenerContactoSoporte() {
    return this.admin.obtenerContactoSoporte();
  }

  async actualizarContactoSoporte(
    datos: { correo: string | null; telefono: string | null },
    usuarioId: string,
  ) {
    return this.admin.actualizarContactoSoporte(datos, usuarioId);
  }

  async listarBannersPropios() {
    return this.admin.listarBannersPropios();
  }

  async crearBannerPropio(datos: {
    titulo: string;
    imagenUrl: string;
    enlaceUrl: string;
    orden?: number;
  }) {
    return this.admin.crearBannerPropio(datos);
  }

  async actualizarBannerPropio(
    id: string,
    datos: { activo?: boolean; orden?: number },
  ) {
    return this.admin.actualizarBannerPropio(id, datos);
  }

  async eliminarBannerPropio(id: string) {
    return this.admin.eliminarBannerPropio(id);
  }

  async obtenerModoIvaBoleto() {
    return this.admin.obtenerModoIvaBoleto();
  }

  async actualizarModoIvaBoleto(modo: ModoIvaBoleto, usuarioId: string) {
    return this.admin.actualizarModoIvaBoleto(modo, usuarioId);
  }

  /**
   * 02-ago-2026 -- RF-ADMIN sección 3.13. Completa el desglose del
   * repositorio con cantidad=0 para cualquier rol válido que todavía
   * no tenga ningún usuario activo, y calcula el total. Esta regla de
   * presentación vive aquí (capa de aplicación), no en el repositorio,
   * siguiendo el mismo criterio del resto del proyecto: la infraestructura
   * solo devuelve datos crudos.
   */
  async contarUsuariosPorRol(): Promise<{
    total: number;
    porRol: FilaConteoUsuariosPorRol[];
  }> {
    const filas = await this.admin.contarUsuariosPorRol();
    const mapa = new Map(filas.map((f) => [f.rol, f.cantidad]));

    const porRol = ROLES_VALIDOS.map((rol) => ({
      rol,
      cantidad: mapa.get(rol) ?? 0,
    }));

    const total = porRol.reduce((acc, f) => acc + f.cantidad, 0);

    return { total, porRol };
  }

  /**
   * Ítem 9, Fase 2 (04-ago-2026) -- exclusivo de super_admin (ver
   * matriz de permisos, sección 3.8 del documento maestro).
   */
  async crearAdministrador(
    datos: DatosNuevoAdministrador,
    creadoPorUsuarioId: string,
  ) {
    return this.admin.crearAdministrador(datos, creadoPorUsuarioId);
  }

  async listarAdministradores() {
    return this.admin.listarAdministradores();
  }

  async eliminarAdministrador(id: string, eliminadoPorUsuarioId: string) {
    return this.admin.eliminarAdministrador(id, eliminadoPorUsuarioId);
  }

  async eliminarCooperativa(id: string, eliminadoPorUsuarioId: string) {
    return this.admin.eliminarCooperativa(id, eliminadoPorUsuarioId);
  }
}
