import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  ProveedorFacturacionElectronica,
  DatosParaFacturar,
  ResultadoFacturacion,
} from '../../dominio/facturacion/facturacion.ports';

/**
 * ⚠️ ESTO NO ES LA INTEGRACIÓN REAL CON EL SRI. ⚠️
 *
 * Facturar de verdad ante el SRI exige un certificado de firma
 * electrónica (archivo .p12) emitido por una entidad autorizada
 * (Banco Central del Ecuador, Security Data, ANF Ecuador, etc.) --
 * requisito legal real, no técnico, y decisión pendiente del usuario
 * (qué proveedor certificado de facturación electrónica usar: Ecuafact,
 * Factuplan, FacturaIA, u otro). Sin eso, cualquier comprobante que se
 * "emita" no tendría validez legal -- el SRI lo rechazaría.
 *
 * Este simulador existe solo para probar el flujo completo (compra →
 * comprobante de plataforma) de punta a punta mientras esas
 * credenciales no existen. Cuando el usuario elija proveedor y consiga
 * credenciales reales, se crea una clase nueva que implemente
 * ProveedorFacturacionElectronica y se cambia el `useClass` en el
 * módulo correspondiente -- nada más en el resto del sistema debería
 * tener que cambiar, esa es la razón de tener la interfaz (mismo
 * patrón que SimuladorPasarelaPago).
 */
@Injectable()
export class SimuladorFacturacionElectronica implements ProveedorFacturacionElectronica {
  emitirComprobante(datos: DatosParaFacturar): Promise<ResultadoFacturacion> {
    void datos;
    // Clave de acceso real del SRI tiene 49 dígitos -- se simula con el
    // mismo largo para que cualquier validación de formato (ej. UI que
    // muestre "49 dígitos") funcione igual el día del reemplazo real.
    const claveSimulada = randomBytes(25).toString('hex').slice(0, 49);
    return Promise.resolve({
      exitoso: true,
      claveAcceso: claveSimulada,
      numeroAutorizacion: claveSimulada,
    });
  }
}
