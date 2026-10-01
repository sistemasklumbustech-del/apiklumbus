import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { configuracionPlataforma } from '@columbus/db';
import { DRIZZLE_DB_PUBLICO } from '../../infraestructura/database/database.module';
import type { DrizzleDb } from '../../infraestructura/database/database.provider';
import type { NotificadorEmail } from '../../dominio/auth/auth.ports';
import { NOTIFICADOR_EMAIL } from '../auth/auth.service';

export const TEMAS_AYUDA = {
  compra: 'Mi compra o pago',
  boleto: 'Mi boleto o código QR',
  cancelacion: 'Cancelar o reprogramar',
  factura: 'Factura',
  cuenta: 'Mi cuenta',
  cooperativa: 'Soy una cooperativa',
  sugerencia: 'Sugerencia',
  otro: 'Otro tema',
} as const;
export type TemaAyuda = keyof typeof TEMAS_AYUDA;

export interface ConsultaAyuda {
  nombre: string;
  correo: string;
  tema: TemaAyuda;
  mensaje: string;
  codigoReferencia?: string;
  /** Si el usuario quiere escribirle a una cooperativa en particular (26-sep-2026), en vez de a soporte de la plataforma. */
  cooperativaId?: string;
}

/**
 * Formulario "Ayuda" del sitio (26-sep-2026): la consulta se envía al correo de
 * soporte que el administrador configura en la plataforma. Quien escribe
 * recibe una referencia para dar seguimiento; el correo sale con su dirección
 * como "responder a".
 *
 * Fase cooperativa (01-oct-2026) -- un visitante sin cuenta y sin boleto
 * (así que no puede usar un reclamo, que exige un boletoId) puede pedir
 * orientación a una cooperativa concreta. Usa el mismo `contactoCorreo` al
 * que ya le llegan los reclamos y los avisos de llegada (ver
 * reclamos.repositorio.drizzle.ts) -- ningún canal nuevo, el mismo correo
 * que la cooperativa ya revisa. Si esa cooperativa no configuró un correo de
 * contacto, la consulta cae de respaldo a soporte de la plataforma, con el
 * nombre de la cooperativa incluido para que lo reenvíen a mano.
 */
@Injectable()
export class SoporteService {
  private readonly logger = new Logger(SoporteService.name);

  constructor(
    @Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb,
    @Inject(NOTIFICADOR_EMAIL) private readonly email: NotificadorEmail,
  ) {}

  async enviarConsulta(datos: ConsultaAyuda): Promise<{ referencia: string }> {
    let destino: string | undefined;
    let cooperativaNombre: string | undefined;
    let respaldoPlataforma = false;

    if (datos.cooperativaId) {
      const fila = await this.db.execute(sql`
        SELECT nombre_comercial, contacto_correo
        FROM cooperativas
        WHERE id = ${datos.cooperativaId} AND estado = 'aprobada'
      `);
      const coop = fila.rows[0] as
        | { nombre_comercial: string; contacto_correo: string | null }
        | undefined;
      if (!coop) {
        throw new BadRequestException(
          'Esa cooperativa ya no está disponible -- recarga la página e intenta de nuevo.',
        );
      }
      cooperativaNombre = coop.nombre_comercial;
      if (coop.contacto_correo?.trim()) {
        destino = coop.contacto_correo.trim();
      } else {
        respaldoPlataforma = true;
      }
    }

    if (!destino) {
      const [config] = await this.db
        .select({ correo: configuracionPlataforma.soporteCorreo })
        .from(configuracionPlataforma)
        .limit(1);
      destino = config?.correo?.trim();
      if (!destino) {
        this.logger.error(
          'Consulta de ayuda sin destino: el correo de soporte no está configurado.',
        );
        throw new ServiceUnavailableException(
          'El envío de consultas no está disponible por ahora. Inténtalo más tarde.',
        );
      }
    }

    const referencia = `AY-${randomBytes(3).toString('hex').toUpperCase()}`;
    try {
      await this.email.enviarConsultaSoporte(destino, {
        referencia,
        nombre: datos.nombre,
        correo: datos.correo,
        tipo: TEMAS_AYUDA[datos.tema],
        mensaje: datos.mensaje,
        codigoReferencia: datos.codigoReferencia,
        dirigidoACooperativa: cooperativaNombre,
        respaldoPlataforma,
      });
    } catch (error) {
      this.logger.error(
        `No se pudo enviar la consulta ${referencia}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(
        'No pudimos enviar tu consulta en este momento. Inténtalo de nuevo en unos minutos.',
      );
    }
    this.logger.log(
      `Consulta de ayuda ${referencia} enviada (${datos.tema})${cooperativaNombre ? ` -- cooperativa ${cooperativaNombre}${respaldoPlataforma ? ' [sin correo propio, respaldo en plataforma]' : ''}` : ''}.`,
    );
    return { referencia };
  }
}
