import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { NotificadorEmail } from '../../dominio/auth/auth.ports';
import { NOTIFICADOR_EMAIL } from '../auth/auth.service';
import { AuditoriaRegistrador } from '../../infraestructura/auditoria/auditoria.registrador';
import {
  ETIQUETA_TIPO_RECLAMO,
  type FiltrosReclamosCooperativa,
  type FiltrosReclamosPasajero,
  type ReclamosRepositorio,
  type TipoReclamo,
} from '../../dominio/reclamos/reclamos.ports';

export const RECLAMOS_REPOSITORIO = 'RECLAMOS_REPOSITORIO';

/**
 * RF-019 (23-sep-2026) -- reclamos del pasajero. Ver el comentario
 * completo del diseño en db/schema/reclamos.ts.
 */
@Injectable()
export class ReclamosService {
  private readonly logger = new Logger(ReclamosService.name);

  constructor(
    @Inject(RECLAMOS_REPOSITORIO)
    private readonly reclamos: ReclamosRepositorio,
    @Inject(NOTIFICADOR_EMAIL) private readonly email: NotificadorEmail,
    private readonly auditoria: AuditoriaRegistrador,
  ) {}

  async crear(
    usuarioId: string,
    datos: { boletoId: string; tipo: TipoReclamo; descripcion: string },
  ) {
    const boleto = await this.reclamos.obtenerBoletoDeUsuario(
      datos.boletoId,
      usuarioId,
    );
    if (!boleto) {
      throw new ForbiddenException(
        'Este boleto no existe o no te pertenece — solo puedes reclamar sobre un boleto que tú compraste.',
      );
    }

    const descripcion = datos.descripcion.trim();
    if (descripcion.length < 10) {
      throw new BadRequestException(
        'Cuéntanos con un poco más de detalle qué pasó (mínimo 10 caracteres).',
      );
    }

    if (await this.reclamos.existeReclamoActivo(datos.boletoId, datos.tipo)) {
      throw new ConflictException(
        'Ya tienes un reclamo de este tipo abierto para este boleto. Espera la respuesta de la cooperativa.',
      );
    }

    let creado: { id: string };
    try {
      creado = await this.reclamos.crear({
        boletoId: datos.boletoId,
        cooperativaId: boleto.cooperativaId,
        pasajeroUsuarioId: usuarioId,
        tipo: datos.tipo,
        descripcion,
      });
    } catch (error) {
      // Carrera entre dos envíos casi simultáneos: el índice único
      // parcial de la tabla lo atrapa aunque el chequeo de arriba no.
      const causa = error as { cause?: { constraint?: string } };
      if (causa?.cause?.constraint === 'uq_reclamos_activo_boleto_tipo') {
        throw new ConflictException(
          'Ya tienes un reclamo de este tipo abierto para este boleto.',
        );
      }
      throw error;
    }

    await this.avisarReclamoNuevo(
      creado.id,
      usuarioId,
      datos.tipo,
      descripcion,
      boleto,
    );
    return { id: creado.id };
  }

  listarDePasajero(usuarioId: string, filtros: FiltrosReclamosPasajero) {
    return this.reclamos.listarDePasajero(usuarioId, filtros);
  }

  listarDeCooperativa(
    cooperativaId: string,
    filtros: FiltrosReclamosCooperativa,
  ) {
    this.validarRangoFechas(filtros.desde, filtros.hasta);
    return this.reclamos.listarDeCooperativa(cooperativaId, filtros);
  }

  resumenDeCooperativa(cooperativaId: string) {
    return this.reclamos.resumenDeCooperativa(cooperativaId);
  }

  async tomar(cooperativaId: string, reclamoId: string, usuarioId: string) {
    const ok = await this.reclamos.marcarEnRevision(
      cooperativaId,
      reclamoId,
      usuarioId,
    );
    if (!ok) {
      await this.lanzarSiNoExisteOYaCerrado(cooperativaId, reclamoId);
      throw new ConflictException('Este reclamo ya está en revisión.');
    }
    return { ok: true };
  }

  async resolver(
    cooperativaId: string,
    reclamoId: string,
    usuarioId: string,
    datos: {
      decision: 'procede' | 'no_procede';
      respuesta: string;
      montoReconocido?: number;
    },
  ) {
    const reclamo = await this.reclamos.obtenerDeCooperativa(
      cooperativaId,
      reclamoId,
    );
    if (!reclamo) {
      throw new NotFoundException('No existe este reclamo.');
    }
    if (reclamo.estado === 'resuelto' || reclamo.estado === 'rechazado') {
      throw new ConflictException('Este reclamo ya fue resuelto.');
    }

    const respuesta = datos.respuesta.trim();
    if (respuesta.length < 10) {
      throw new BadRequestException(
        'Escribe una respuesta para el pasajero (mínimo 10 caracteres).',
      );
    }

    const aFavor = datos.decision === 'procede';
    let monto: number | null = null;
    if (datos.montoReconocido !== undefined) {
      if (!aFavor || reclamo.tipo !== 'cobro_reembolso') {
        throw new BadRequestException(
          'El monto a devolver solo aplica cuando un reclamo de cobro o reembolso procede.',
        );
      }
      if (datos.montoReconocido > reclamo.montoBoleto) {
        throw new BadRequestException(
          `El monto a devolver no puede superar lo que pagó el boleto ($${reclamo.montoBoleto.toFixed(2)}).`,
        );
      }
      monto = Math.round(datos.montoReconocido * 100) / 100;
    }

    const ok = await this.reclamos.resolver(cooperativaId, reclamoId, {
      estadoFinal: aFavor ? 'resuelto' : 'rechazado',
      respuesta,
      montoReconocido: monto,
      gestionadoPorUsuarioId: usuarioId,
    });
    if (!ok) {
      // Otro usuario de la cooperativa lo resolvió en el mismo instante.
      throw new ConflictException('Este reclamo ya fue resuelto.');
    }

    await this.auditoria.registrar({
      accion: 'resolucion_reclamo',
      usuarioId,
      entidadTipo: 'reclamo',
      entidadId: reclamoId,
      detalle: {
        cooperativaId,
        decision: datos.decision,
        tipo: reclamo.tipo,
        montoReconocido: monto,
      },
    });

    await this.avisarResolucion(reclamoId, aFavor, respuesta, monto);
    return { ok: true };
  }

  private async lanzarSiNoExisteOYaCerrado(
    cooperativaId: string,
    reclamoId: string,
  ) {
    const reclamo = await this.reclamos.obtenerDeCooperativa(
      cooperativaId,
      reclamoId,
    );
    if (!reclamo) {
      throw new NotFoundException('No existe este reclamo.');
    }
    if (reclamo.estado === 'resuelto' || reclamo.estado === 'rechazado') {
      throw new ConflictException('Este reclamo ya fue resuelto.');
    }
  }

  private validarRangoFechas(desde?: string, hasta?: string) {
    if (desde && hasta && desde > hasta) {
      throw new BadRequestException(
        'La fecha "desde" no puede ser posterior a "hasta".',
      );
    }
  }

  /**
   * Los avisos por correo nunca hacen fallar la operación: el reclamo
   * ya quedó guardado y visible en el panel; un correo caído no debe
   * bloquear al pasajero ni a la cooperativa.
   */
  private async avisarReclamoNuevo(
    reclamoId: string,
    usuarioId: string,
    tipo: TipoReclamo,
    descripcion: string,
    boleto: {
      cooperativaId: string;
      origenCiudad: string;
      destinoCiudad: string;
      fechaSalida: string;
    },
  ) {
    try {
      const correos = await this.reclamos.correosDeCooperativa(
        boleto.cooperativaId,
      );
      const reclamo = await this.reclamos.obtenerDeCooperativa(
        boleto.cooperativaId,
        reclamoId,
      );
      const pasajeroNombre = reclamo?.pasajeroNombre ?? 'Un pasajero';
      for (const correo of correos) {
        await this.email.enviarReclamoNuevo(correo, {
          reclamoId,
          tipo: ETIQUETA_TIPO_RECLAMO[tipo],
          descripcion,
          pasajeroNombre,
          ruta: `${boleto.origenCiudad} → ${boleto.destinoCiudad}`,
          fechaSalida: boleto.fechaSalida,
        });
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar por correo del reclamo ${reclamoId} (usuario ${usuarioId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async avisarResolucion(
    reclamoId: string,
    aFavor: boolean,
    respuesta: string,
    monto: number | null,
  ) {
    try {
      const datos = await this.reclamos.datosParaAvisoResolucion(reclamoId);
      if (!datos) return;
      const correo = await this.reclamos.correoDePasajero(
        datos.pasajeroUsuarioId,
      );
      if (!correo) return;
      await this.email.enviarReclamoResuelto(correo, {
        reclamoId,
        estado: aFavor ? 'resuelto' : 'rechazado',
        respuesta,
        montoReconocido: monto,
        cooperativaNombre: datos.cooperativaNombre,
        ruta: `${datos.origenCiudad} → ${datos.destinoCiudad}`,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar por correo la resolución del reclamo ${reclamoId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
