/**
 * Facturación electrónica del servicio de Colombus (29-jul-2026).
 *
 * Confirmado con el usuario: la factura del PASAJE la emite la
 * cooperativa (su propia venta) -- ver solicitudes-factura.ts para ese
 * puente. Esto es distinto: la factura del cargo fijo que Colombus
 * cobra por su servicio de plataforma (ej. $0.50 por boleto).
 *
 * Arquitectura Técnica 5.2 (ya decidido antes de esta pieza, no una
 * decisión nueva): no se construye firma/envío al SRI propios -- se
 * integra un proveedor certificado externo (ej. Ecuafact, Factuplan,
 * FacturaIA) que ya tiene la firma electrónica y expone su propia API,
 * mismo patrón que la pasarela de pago.
 *
 * Requisito real pendiente del lado del usuario (no técnico): elegir
 * ese proveedor y conseguir sus credenciales -- sin eso, cualquier
 * "factura" sería inválida ante el SRI. Mientras tanto, un simulador
 * deja el flujo completo probado y listo para el reemplazo.
 */

export interface DatosParaFacturar {
  montoTotal: number;
  descripcion: string;
  rucOCedulaCliente?: string;
  nombreCliente?: string;
}

export interface ResultadoFacturacion {
  exitoso: boolean;
  claveAcceso?: string;
  numeroAutorizacion?: string;
  xmlUrl?: string;
  pdfUrl?: string;
  error?: string;
}

export interface ProveedorFacturacionElectronica {
  emitirComprobante(datos: DatosParaFacturar): Promise<ResultadoFacturacion>;
}
