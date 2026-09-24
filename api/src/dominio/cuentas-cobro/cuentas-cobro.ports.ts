export type EstadoCuentaCobro =
  'pendiente_verificacion' | 'verificada' | 'rechazada' | 'reemplazada';

export interface DatosCuentaCobro {
  entidadFinanciera: string;
  tipoCuenta: 'ahorros' | 'corriente';
  numeroCuenta: string;
  titularNombre: string;
  titularTipoIdentificacion: 'cedula' | 'ruc';
  titularIdentificacion: string;
  correoNotificacion: string;
}

export interface CuentaCobro extends DatosCuentaCobro {
  id: string;
  cooperativaId: string;
  cooperativaNombre: string;
  estado: EstadoCuentaCobro;
  motivoRechazo: string | null;
  verificadaEn: string | null;
  creadoEn: string;
}

export interface CuentasCobroRepositorio {
  /** Cuentas de una cooperativa, más recientes primero (vigente, pendiente y rechazada; sin las reemplazadas). */
  listarDeCooperativa(cooperativaId: string): Promise<CuentaCobro[]>;
  /** Reemplaza la solicitud pendiente de la cooperativa (si la hay) por esta nueva. */
  registrar(
    cooperativaId: string,
    usuarioId: string,
    datos: DatosCuentaCobro,
  ): Promise<{ id: string }>;
  listarParaAdmin(estado?: EstadoCuentaCobro): Promise<CuentaCobro[]>;
  obtener(id: string): Promise<CuentaCobro | null>;
  /** Marca verificada y pasa a "reemplazada" la vigente anterior, todo en una transacción. */
  verificar(id: string, adminId: string): Promise<void>;
  rechazar(id: string, adminId: string, motivo: string): Promise<void>;
}
