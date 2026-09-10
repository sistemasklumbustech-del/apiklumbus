import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  PasarelaPago,
  ResultadoPago,
} from '../../dominio/ventas/ventas.ports';

/**
 * ⚠️ ESTO NO ES LA INTEGRACIÓN REAL DE PAGO. ⚠️
 *
 * Arquitectura Técnica, sección 5.1: la estrategia de pago decidida es
 * PayPhone (MVP) + Kushki (Fase 2). Ninguna de las dos está integrada
 * todavía porque no hay credenciales reales — es una decisión de negocio
 * explícitamente pendiente en el SRS (sección 9: "Proveedor de pasarela
 * de pago a integrar y sus condiciones").
 *
 * Este simulador existe solo para poder probar el flujo completo de
 * compra (checkout → boleto) de punta a punta mientras esas credenciales
 * no existen. Aprueba siempre, salvo un modo de prueba explícito para
 * forzar rechazo (útil para probar el camino de error). Cuando haya
 * credenciales reales de PayPhone, se crea una clase nueva que
 * implemente PasarelaPago (ej. PayPhoneGateway) y se cambia el
 * `useClass` en ventas.module.ts — nada más en el resto del sistema
 * debería tener que cambiar, esa es la razón de tener la interfaz.
 */
@Injectable()
export class SimuladorPasarelaPago implements PasarelaPago {
  procesar(montoTotal: number, idempotencyKey: string): Promise<ResultadoPago> {
    // Requerido por la interfaz PasarelaPago aunque este simulador no lo
    // use — una pasarela real (PayPhone/Kushki) sí lo necesita para
    // evitar cobros duplicados del lado del proveedor.
    void idempotencyKey;
    // Convención de prueba: un monto exacto de 999999 fuerza un rechazo
    // simulado, para poder probar el camino de error sin depender de
    // nada externo.
    if (montoTotal === 999999) {
      return Promise.resolve({
        aprobado: false,
        referenciaExterna: '',
        motivoRechazo: 'Rechazo simulado para pruebas.',
      });
    }
    return Promise.resolve({
      aprobado: true,
      referenciaExterna: `SIMULADO-${randomUUID()}`,
    });
  }
}
