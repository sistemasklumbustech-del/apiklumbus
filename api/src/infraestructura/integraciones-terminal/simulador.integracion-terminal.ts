import { Injectable } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
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
} from '../../dominio/integraciones-terminal/integracion-terminal.ports';

/**
 * ⚠️ ESTO NO ES LA INTEGRACIÓN REAL CON SIAT3000. ⚠️
 *
 * Conectar de verdad contra Derpacif exige respuestas que todavía no
 * existen: mecanismo de autenticación real, vigencia del WSDL (diseño
 * 2015, última actualización 2018) y ambiente de certificación (Fase 0,
 * bloqueada -- CONTEXT.md sección 5.4, carta con 11 preguntas pendiente
 * de confirmación). Sin eso, cualquier llamada real fallaría o, peor,
 * generaría una tasa/QR inválido ante el Terminal físico.
 *
 * Este simulador existe solo para probar el flujo completo (crear viaje
 * → vender → obtener QR) de punta a punta mientras esas respuestas no
 * llegan. Cuando Derpacif confirme el mecanismo real, se crea una clase
 * nueva en infraestructura/integraciones-terminal/derpacif-siat3000/ que
 * implemente ProveedorIntegracionTerminal y se cambia el `useClass` del
 * módulo correspondiente -- nada más en el resto del sistema debería
 * tener que cambiar, esa es la razón de tener la interfaz (mismo patrón
 * que SimuladorFacturacionElectronica / SimuladorPasarelaPago).
 */
@Injectable()
export class SimuladorIntegracionTerminal implements ProveedorIntegracionTerminal {
  obtenerBuses(cooperativaId: string): Promise<BusTerminal[]> {
    void cooperativaId;
    return Promise.resolve([
      { codigoTerminal: '1', disco: '101', placa: 'ABC-1234', capacidad: 40 },
    ]);
  }

  obtenerUsuarios(cooperativaId: string): Promise<UsuarioTerminal[]> {
    void cooperativaId;
    return Promise.resolve([{ nick: 'usuario_simulado', nombre: 'Usuario Simulado' }]);
  }

  obtenerRutas(cooperativaId: string): Promise<RutaTerminal[]> {
    void cooperativaId;
    return Promise.resolve([{ codigoTerminal: '1', destino: 'Guayaquil', via: 'Via Panamericana' }]);
  }

  obtenerTarifasDestinoRuta(
    cooperativaId: string,
    rutaCodigoTerminal: string,
  ): Promise<TarifaDestinoRuta[]> {
    void cooperativaId;
    return Promise.resolve([
      {
        codigoTerminal: rutaCodigoTerminal,
        descripcion: 'Guayaquil',
        precioNormal: 8,
        precioAdulto: 8,
        precioNino: 4,
        precioEstudiante: 6,
        precioEspecial: 4,
      },
    ]);
  }

  obtenerFrecuenciasRuta(
    cooperativaId: string,
    rutaCodigoTerminal: string,
  ): Promise<FrecuenciaRuta[]> {
    void cooperativaId;
    void rutaCodigoTerminal;
    return Promise.resolve([{ codigoTerminal: '1', hora: '08:00' }]);
  }

  crearViaje(datos: DatosCrearViaje): Promise<ResultadoCrearViaje> {
    void datos;
    // "código de viaje" real es un entero devuelto por el Terminal
    // (longitud 8 en setAnulaVenta/setCambioBus) -- se simula con el
    // mismo formato para que cualquier validación de largo funcione
    // igual el día del reemplazo real.
    const codigoSimulado = String(randomInt(10_000_000, 99_999_999));
    return Promise.resolve({ exitoso: true, codigoViaje: codigoSimulado });
  }

  anularVenta(datos: DatosAnularVenta): Promise<ResultadoAnularVenta> {
    void datos;
    return Promise.resolve({ exitoso: true });
  }

  cambiarBus(datos: DatosCambiarBus): Promise<ResultadoCambiarBus> {
    void datos;
    return Promise.resolve({ exitoso: true });
  }

  registrarVentaYObtenerTasa(
    datos: DatosVentaParaTasa,
    claveIdempotencia: string,
  ): Promise<ResultadoRegistroTasa> {
    void datos;
    void claveIdempotencia;
    // Código de tasa real tiene 20 dígitos (RF-010) -- se simula con el
    // mismo largo exacto para que la generación de QR y cualquier
    // validación de formato funcionen igual el día del reemplazo real.
    const codigoTasaSimulado = randomBytes(10).toString('hex').slice(0, 20);
    return Promise.resolve({
      exitoso: true,
      codigoTasa: codigoTasaSimulado,
      mensaje: 'Simulado -- sin integración real con SIAT3000 todavía.',
      saldoRestante: 999,
    });
  }
}
