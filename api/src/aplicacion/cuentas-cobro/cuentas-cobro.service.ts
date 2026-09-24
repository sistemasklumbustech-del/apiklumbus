import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditoriaRegistrador } from '../../infraestructura/auditoria/auditoria.registrador';
import type {
  CuentasCobroRepositorio,
  DatosCuentaCobro,
  EstadoCuentaCobro,
} from '../../dominio/cuentas-cobro/cuentas-cobro.ports';

export const CUENTAS_COBRO_REPOSITORIO = 'CUENTAS_COBRO_REPOSITORIO';

/** Cuenta bancaria de la cooperativa para recibir las liquidaciones -- ver db/schema/cuentas-cobro.ts. */
@Injectable()
export class CuentasCobroService {
  constructor(
    @Inject(CUENTAS_COBRO_REPOSITORIO)
    private readonly cuentas: CuentasCobroRepositorio,
    private readonly auditoria: AuditoriaRegistrador,
  ) {}

  listarDeCooperativa(cooperativaId: string) {
    return this.cuentas.listarDeCooperativa(cooperativaId);
  }

  async registrar(
    cooperativaId: string,
    usuarioId: string,
    datos: DatosCuentaCobro,
  ) {
    const limpio: DatosCuentaCobro = {
      ...datos,
      numeroCuenta: datos.numeroCuenta.replace(/\s|-/g, ''),
      titularNombre: datos.titularNombre.trim(),
      titularIdentificacion: datos.titularIdentificacion.trim(),
      correoNotificacion: datos.correoNotificacion.trim().toLowerCase(),
    };
    const largoId = limpio.titularTipoIdentificacion === 'ruc' ? 13 : 10;
    if (!new RegExp(`^\\d{${largoId}}$`).test(limpio.titularIdentificacion)) {
      throw new BadRequestException(
        limpio.titularTipoIdentificacion === 'ruc'
          ? 'El RUC del titular debe tener 13 dígitos.'
          : 'La cédula del titular debe tener 10 dígitos.',
      );
    }
    const creada = await this.cuentas.registrar(
      cooperativaId,
      usuarioId,
      limpio,
    );
    await this.auditoria.registrar({
      accion: 'registro_cuenta_cobro',
      usuarioId,
      entidadTipo: 'cuenta_cobro',
      entidadId: creada.id,
      detalle: {
        cooperativaId,
        entidadFinanciera: limpio.entidadFinanciera,
        // Nunca el número completo en el log: solo los últimos 4 dígitos.
        cuentaTerminada: limpio.numeroCuenta.slice(-4),
      },
    });
    return creada;
  }

  listarParaAdmin(estado?: EstadoCuentaCobro) {
    return this.cuentas.listarParaAdmin(estado);
  }

  private async pendienteOFalla(id: string) {
    const cuenta = await this.cuentas.obtener(id);
    if (!cuenta) throw new NotFoundException('Cuenta no encontrada.');
    if (cuenta.estado !== 'pendiente_verificacion') {
      throw new ConflictException('Esta cuenta ya fue revisada.');
    }
    return cuenta;
  }

  async verificar(id: string, adminId: string) {
    const cuenta = await this.pendienteOFalla(id);
    await this.cuentas.verificar(id, adminId);
    await this.auditoria.registrar({
      accion: 'verificacion_cuenta_cobro',
      usuarioId: adminId,
      entidadTipo: 'cuenta_cobro',
      entidadId: id,
      detalle: {
        cooperativaId: cuenta.cooperativaId,
        cuentaTerminada: cuenta.numeroCuenta.slice(-4),
      },
    });
    return { ok: true };
  }

  async rechazar(id: string, adminId: string, motivo: string) {
    const cuenta = await this.pendienteOFalla(id);
    const texto = motivo.trim();
    if (texto.length < 5) {
      throw new BadRequestException('Indica el motivo del rechazo.');
    }
    await this.cuentas.rechazar(id, adminId, texto);
    await this.auditoria.registrar({
      accion: 'rechazo_cuenta_cobro',
      usuarioId: adminId,
      entidadTipo: 'cuenta_cobro',
      entidadId: id,
      detalle: { cooperativaId: cuenta.cooperativaId, motivo: texto },
    });
    return { ok: true };
  }
}
