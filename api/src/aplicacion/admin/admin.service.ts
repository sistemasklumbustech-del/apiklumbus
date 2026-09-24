import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminRepositorio,
  DatosNuevaCooperativa,
  DatosPrimerUsuarioCooperativa,
  DatosNuevoPuntoOperacion,
  FilaConteoUsuariosPorRol,
  ModoIvaBoleto,
  DatosNuevoAdministrador,
  FiltrosConciliacion,
  ResultadoConciliacion,
  FiltrosCooperativas,
  FiltrosPuntosOperacion,
  FiltrosAdministradores,
  FiltrosBanners,
} from '../../dominio/admin/admin.ports';
import { calcularDiscrepancias } from '../../dominio/admin/conciliacion.util';

import type { AlmacenamientoArchivos } from '../../dominio/auth/auth.ports';
import { ALMACENAMIENTO_ARCHIVOS } from '../auth/auth.service';

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
    @Inject(ALMACENAMIENTO_ARCHIVOS)
    private readonly almacenamiento: AlmacenamientoArchivos,
  ) {}

  /** Sube la imagen de un banner (se optimiza al guardarla) y devuelve su URL para usarla al crear el banner. */
  async subirImagenBanner(buffer: Buffer, nombreOriginal: string) {
    const { url } = await this.almacenamiento.guardarImagen(
      buffer,
      nombreOriginal,
      'banners',
    );
    return { url };
  }

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

  async buscarCooperativas(filtros: FiltrosCooperativas) {
    return this.admin.buscarCooperativas(filtros);
  }

  async listarPuntosOperacion(filtros: FiltrosPuntosOperacion) {
    return this.admin.listarPuntosOperacion(filtros);
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

  async listarBannersPropios(filtros: FiltrosBanners) {
    return this.admin.listarBannersPropios(filtros);
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

  async listarAdministradores(filtros: FiltrosAdministradores) {
    return this.admin.listarAdministradores(filtros);
  }

  async eliminarAdministrador(id: string, eliminadoPorUsuarioId: string) {
    return this.admin.eliminarAdministrador(id, eliminadoPorUsuarioId);
  }

  async eliminarCooperativa(id: string, eliminadoPorUsuarioId: string) {
    return this.admin.eliminarCooperativa(id, eliminadoPorUsuarioId);
  }

  cambiarEstadoCooperativa(
    id: string,
    nuevoEstado: 'aprobada' | 'suspendida',
    usuarioId: string,
    motivo?: string,
  ) {
    return this.admin.cambiarEstadoCooperativa(id, nuevoEstado, usuarioId, motivo);
  }

  /**
   * RF-017, paginación real (22-sep-2026) -- ver el comentario de
   * ConciliacionQueryDto. soloDiscrepancias/pagina/limite se resuelven
   * acá (después de calcularDiscrepancias, lógica de negocio pura),
   * no en el repositorio.
   */
  async conciliacion(
    filtros: FiltrosConciliacion,
  ): Promise<ResultadoConciliacion> {
    const filasCrudas = await this.admin.conciliacion({
      desde: filtros.desde,
      hasta: filtros.hasta,
      cooperativaId: filtros.cooperativaId,
      busqueda: filtros.busqueda,
    });
    const todas = filasCrudas.map((fila) => ({
      ...fila,
      discrepancias: calcularDiscrepancias(fila),
    }));
    const totalConDiscrepancias = todas.filter(
      (f) => f.discrepancias.length > 0,
    ).length;
    const filtradas = filtros.soloDiscrepancias
      ? todas.filter((f) => f.discrepancias.length > 0)
      : todas;

    const offset = (filtros.pagina - 1) * filtros.limite;
    return {
      filas: filtradas.slice(offset, offset + filtros.limite),
      total: filtradas.length,
      totalConDiscrepancias,
      pagina: filtros.pagina,
      limite: filtros.limite,
    };
  }
}
