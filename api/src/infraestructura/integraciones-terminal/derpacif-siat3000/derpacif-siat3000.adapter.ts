import { Injectable } from '@nestjs/common';
import type {
  ProveedorIntegracionTerminal,
  BusTerminal,
  UsuarioTerminal,
  RutaTerminal,
  TarifaDestinoRuta,
  FrecuenciaRuta,
  DatosCrearViaje,
  ResultadoCrearViaje,
  DatosAnularVenta,
  ResultadoAnularVenta,
  DatosCambiarBus,
  ResultadoCambiarBus,
  DatosVentaParaTasa,
  ResultadoRegistroTasa,
  PasajeroParaTasa,
} from '../../../dominio/integraciones-terminal/integracion-terminal.ports';
import * as siat from './derpacif-siat3000.client';
import type {
  ContextoSiat3000,
  DetalleVentaPasaje,
} from './derpacif-siat3000.client';

/**
 * Resuelve el contexto de conexión (proveedor/ruc/sucursal/punto/nick)
 * para una cooperativa específica. Deliberadamente NO es responsabilidad
 * de este adaptador leerlo de la base de datos -- eso depende del modo
 * (único/por_cooperativa, credenciales_integracion_terminal /
 * credenciales_terminal_por_cooperativa, RF-016) y todavía no hay un
 * caso de uso real que lo consuma. Se inyecta como función para poder
 * probar este adaptador con un contexto fijo mientras tanto, y para que
 * conectar la resolución real desde Postgres sea un cambio de una sola
 * línea en el módulo que arme este adaptador, no un cambio aquí.
 */
export type ResolvedorContextoSiat3000 = (
  cooperativaId: string,
) => Promise<ContextoSiat3000>;

const TIPO_PASAJERO_SIAT: Record<
  PasajeroParaTasa['tipo'],
  DetalleVentaPasaje['tipo']
> = {
  normal: 'Normal',
  infante: 'Infante',
  adulto: 'Adulto',
  estudiante: 'Estudiante',
  especial: 'Especial',
};

const TIPCLI_VALIDOS = new Set(['04', '05', '06', '07']);

/**
 * ⚠️ Sin ambiente de certificación (confirmado por Derpacif, CONTEXT.md
 * 5.4 pregunta 10) -- cualquier prueba real de este adaptador pega
 * directo contra producción. Probar primero los métodos de solo
 * lectura (obtenerBuses/obtenerRutas/...) antes de arriesgar un
 * registrarVentaYObtenerTasa real, que consume saldo prepagado de
 * verdad.
 *
 * El campo `usuario` (nick) que entrega `resolverContexto` ES la
 * credencial completa -- no hay password/token/certificado (confirmado,
 * pregunta 2). Debe tratarse con el mismo cuidado que un secreto real:
 * nunca debe llegar a un log, respuesta HTTP, ni al frontend.
 */
@Injectable()
export class DerpacifSiat3000Adapter implements ProveedorIntegracionTerminal {
  constructor(private readonly resolverContexto: ResolvedorContextoSiat3000) {}

  async obtenerBuses(cooperativaId: string): Promise<BusTerminal[]> {
    const ctx = await this.resolverContexto(cooperativaId);
    const filas = await siat.getBus(ctx);
    return filas.map((f) => ({
      codigoTerminal: f.id,
      disco: f.disco,
      placa: f.placa,
      capacidad: Number(f.capacidad),
    }));
  }

  async obtenerUsuarios(cooperativaId: string): Promise<UsuarioTerminal[]> {
    const ctx = await this.resolverContexto(cooperativaId);
    const filas = await siat.getUsuario(ctx);
    return filas.map((f) => ({ nick: f.nick, nombre: f.nombre }));
  }

  async obtenerRutas(cooperativaId: string): Promise<RutaTerminal[]> {
    const ctx = await this.resolverContexto(cooperativaId);
    const filas = await siat.getRuta(ctx);
    return filas.map((f) => ({
      codigoTerminal: f.id,
      destino: f.destino,
      via: f.via,
    }));
  }

  async obtenerTarifasDestinoRuta(
    cooperativaId: string,
    rutaCodigoTerminal: string,
  ): Promise<TarifaDestinoRuta[]> {
    const ctx = await this.resolverContexto(cooperativaId);
    const filas = await siat.getDestinoRuta(ctx, rutaCodigoTerminal);
    return filas.map((f) => ({
      codigoTerminal: f.id,
      descripcion: f.descripcion,
      precioNormal: Number(f.pc1),
      precioAdulto: Number(f.pc2),
      precioNino: Number(f.pc3),
      precioEstudiante: Number(f.pc4),
      precioEspecial: Number(f.pc5),
    }));
  }

  async obtenerFrecuenciasRuta(
    cooperativaId: string,
    rutaCodigoTerminal: string,
  ): Promise<FrecuenciaRuta[]> {
    const ctx = await this.resolverContexto(cooperativaId);
    const filas = await siat.getFrecuenciaRuta(ctx, rutaCodigoTerminal);
    return filas.map((f) => ({ codigoTerminal: f.id, hora: f.hora }));
  }

  /**
   * El manual no da un campo de éxito/error separado para setCrearViaje
   * -- "retorna un string, si está bien la respuesta será un código de
   * viaje, caso contrario un mensaje indicando el error". Sin catálogo
   * de errores (confirmado, pregunta 11) la única señal disponible es
   * la forma del texto: un código de viaje es siempre numérico.
   */
  async crearViaje(datos: DatosCrearViaje): Promise<ResultadoCrearViaje> {
    const ctx = await this.resolverContexto(datos.cooperativaId);
    const resultado = await siat.setCrearViaje(ctx, {
      fecha: datos.fecha,
      ruta: datos.rutaCodigoTerminal,
      bus: datos.busDisco,
      frecuencia: datos.horaFrecuencia,
      tipo: datos.tipo === 'normal' ? 'N' : 'E',
    });
    if (/^\d+$/.test(resultado)) {
      return { exitoso: true, codigoViaje: resultado };
    }
    return { exitoso: false, error: resultado };
  }

  async anularVenta(datos: DatosAnularVenta): Promise<ResultadoAnularVenta> {
    const ctx = await this.resolverContexto(datos.cooperativaId);
    const resultado = await siat.setAnulaVenta(ctx, {
      factura: datos.facturaNumero,
      codViaje: datos.codigoViaje,
    });
    if (resultado === '1') return { exitoso: true };
    return { exitoso: false, error: resultado };
  }

  async cambiarBus(datos: DatosCambiarBus): Promise<ResultadoCambiarBus> {
    const ctx = await this.resolverContexto(datos.cooperativaId);
    const resultado = await siat.setCambioBus(ctx, {
      codViaje: datos.codigoViaje,
      bus: datos.busDisco,
    });
    if (resultado === '1') return { exitoso: true };
    return { exitoso: false, error: resultado };
  }

  /**
   * `claveIdempotencia` NO se envía a SIAT3000 -- el manual no tiene
   * concepto de clave idempotente. Es responsabilidad de quien llame a
   * este método (el futuro caso de uso de checkout) consultar
   * `registros_tasa_terminal` por esa clave ANTES de invocar esto, y
   * persistir el resultado después -- así RN-005/RN-007 (no duplicar
   * una venta de tasa ante un timeout) se cumple sin que este adaptador
   * necesite conocer la base de datos.
   */
  async registrarVentaYObtenerTasa(
    datos: DatosVentaParaTasa,
    claveIdempotencia: string,
  ): Promise<ResultadoRegistroTasa> {
    void claveIdempotencia;
    if (!TIPCLI_VALIDOS.has(datos.tipoCliente)) {
      return {
        exitoso: false,
        error: `tipoCliente '${datos.tipoCliente}' inválido -- debe ser 04 (RUC), 05 (persona natural), 06 (pasaporte) o 07 (consumidor final).`,
      };
    }
    const ctx = await this.resolverContexto(datos.cooperativaId);
    const respuesta = await siat.setVentaPasaje(ctx, {
      factura: datos.facturaNumero,
      codViaje: datos.codigoViaje,
      tipcli: datos.tipoCliente as '04' | '05' | '06' | '07',
      identi: datos.identificacionCliente,
      razon: datos.razonSocialCliente,
      direc: datos.direccionCliente,
      mail: datos.correoCliente,
      destino: datos.destinoCodigoTerminal,
      total: datos.totalFacturado,
      detalle: datos.pasajeros.map((p) => ({
        asiento: p.asiento,
        tipo: TIPO_PASAJERO_SIAT[p.tipo],
        valor: p.valor,
      })),
    });
    if (respuesta.estado === '1') {
      return {
        exitoso: true,
        codigoTasa: respuesta.tasa,
        mensaje: respuesta.mensaje,
        saldoRestante: Number(respuesta.saldo),
      };
    }
    return {
      exitoso: false,
      error: respuesta.mensaje || 'SIAT3000 rechazó la venta (estado 0).',
    };
  }
}
