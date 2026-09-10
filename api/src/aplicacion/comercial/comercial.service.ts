import { Inject, Injectable } from '@nestjs/common';
import type {
  ComercialRepositorio,
  DatosNuevoEspacioPublicitario,
  DatosNuevoPlanComercial,
  DatosNuevoLead,
  DatosNuevaCampana,
  EstadoLead,
} from '../../dominio/comercial/comercial.ports';

export const COMERCIAL_REPOSITORIO = 'COMERCIAL_REPOSITORIO';

@Injectable()
export class ComercialService {
  constructor(
    @Inject(COMERCIAL_REPOSITORIO)
    private readonly comercial: ComercialRepositorio,
  ) {}

  crearEspacioPublicitario(datos: DatosNuevoEspacioPublicitario) {
    return this.comercial.crearEspacioPublicitario(datos);
  }

  listarEspaciosPublicitarios() {
    return this.comercial.listarEspaciosPublicitarios();
  }

  crearPlanComercial(datos: DatosNuevoPlanComercial) {
    return this.comercial.crearPlanComercial(datos);
  }

  listarPlanesComerciales() {
    return this.comercial.listarPlanesComerciales();
  }

  crearLead(datos: DatosNuevoLead) {
    return this.comercial.crearLead(datos);
  }

  listarLeads() {
    return this.comercial.listarLeads();
  }

  actualizarEstadoLead(
    id: string,
    datos: { estado?: EstadoLead; notasSeguimiento?: string },
  ) {
    return this.comercial.actualizarEstadoLead(id, datos);
  }

  crearCampana(datos: DatosNuevaCampana) {
    return this.comercial.crearCampana(datos);
  }

  listarCampanas() {
    return this.comercial.listarCampanas();
  }

  aprobarCampana(campanaId: string, usuarioId: string) {
    return this.comercial.aprobarCampana(campanaId, usuarioId);
  }

  rechazarCampana(campanaId: string) {
    return this.comercial.rechazarCampana(campanaId);
  }

  listarCampanasActivas(ubicacion: string) {
    return this.comercial.listarCampanasActivas(ubicacion);
  }

  registrarImpresion(campanaId: string) {
    return this.comercial.registrarImpresion(campanaId);
  }

  registrarClic(campanaId: string) {
    return this.comercial.registrarClic(campanaId);
  }

  obtenerMetricasCampana(campanaId: string) {
    return this.comercial.obtenerMetricasCampana(campanaId);
  }
}
