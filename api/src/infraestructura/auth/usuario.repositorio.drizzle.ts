import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { usuarios } from '@columbus/db';
import { DRIZZLE_DB_PUBLICO } from '../database/database.module';
import type { DrizzleDb } from '../database/database.provider';
import {
  DatosRegistro,
  UsuarioDominio,
  UsuarioRepositorio,
} from '../../dominio/auth/auth.ports';

/**
 * Implementación concreta de UsuarioRepositorio usando Drizzle + el
 * esquema compartido de @columbus/db. Es el único archivo del módulo de
 * auth que debería importar cosas de Drizzle directamente.
 *
 * ⚠ Usa DRIZZLE_DB_PUBLICO (rol con BYPASSRLS), no DRIZZLE_DB, y esto es
 * una corrección real de un bug encontrado probando el sistema completo:
 * la autenticación es, por naturaleza, una operación que ocurre ANTES de
 * saber a qué cooperativa pertenece alguien — es exactamente lo que el
 * login está tratando de averiguar. Buscar por correo usando la conexión
 * con RLS activo (DRIZZLE_DB) exige tener ya seteado
 * `app.current_cooperativa_id`, algo que en el momento del login todavía
 * no existe. El resultado real de ese bug: cualquier usuario de
 * cooperativa (admin_cooperativa, vendedor) recibía "correo o contraseña
 * incorrectos" siempre, aunque la contraseña fuera correcta — la política
 * RLS escondía la fila de sí misma. Los usuarios sin cooperativa
 * (pasajero, admin_plataforma) no mostraban el problema porque su
 * política adicional ("OR cooperativa_id IS NULL") sí los dejaba pasar,
 * lo cual ocultó el bug hasta probar con una cuenta de cooperativa real.
 */
@Injectable()
export class UsuarioRepositorioDrizzle implements UsuarioRepositorio {
  constructor(@Inject(DRIZZLE_DB_PUBLICO) private readonly db: DrizzleDb) {}

  async buscarPorCorreo(correo: string): Promise<UsuarioDominio | null> {
    const fila = await this.db.query.usuarios.findFirst({
      where: eq(usuarios.correo, correo),
    });
    return fila ? this.aDominio(fila) : null;
  }

  async buscarPorId(id: string): Promise<UsuarioDominio | null> {
    const fila = await this.db.query.usuarios.findFirst({
      where: eq(usuarios.id, id),
    });
    return fila ? this.aDominio(fila) : null;
  }

  async crearPasajero(datos: DatosRegistro): Promise<UsuarioDominio> {
    const [fila] = await this.db
      .insert(usuarios)
      .values({
        rol: 'pasajero',
        correo: datos.correo,
        passwordHash: datos.password,
        nombreCompleto: datos.nombreCompleto,
        cedula: datos.cedula,
        telefono: datos.telefono,
      })
      .returning();
    return this.aDominio(fila);
  }

  async registrarIntentoFallido(
    usuarioId: string,
    intentos: number,
    bloqueadoHasta: Date | null,
  ): Promise<void> {
    await this.db
      .update(usuarios)
      .set({ intentosFallidos: intentos, bloqueadoHasta })
      .where(eq(usuarios.id, usuarioId));
  }

  async reiniciarIntentosFallidos(usuarioId: string): Promise<void> {
    await this.db
      .update(usuarios)
      .set({ intentosFallidos: 0, bloqueadoHasta: null })
      .where(eq(usuarios.id, usuarioId));
  }

  /** Traduce la fila cruda de Drizzle a la forma que el dominio conoce. */
  private aDominio(fila: typeof usuarios.$inferSelect): UsuarioDominio {
    return {
      id: fila.id,
      rol: fila.rol,
      cooperativaId: fila.cooperativaId,
      correo: fila.correo,
      nombreCompleto: fila.nombreCompleto,
      cedula: fila.cedula,
      telefono: fila.telefono,
      fotoUrl: fila.fotoUrl,
      codigoPasajero: fila.codigoPasajero,
      ultimoCambioIdentidadEn: fila.ultimoCambioIdentidadEn,
      creadoEn: fila.creadoEn,
      passwordHash: fila.passwordHash,
      intentosFallidos: fila.intentosFallidos,
      bloqueadoHasta: fila.bloqueadoHasta,
      correoVerificado: fila.correoVerificado,
      activo: fila.activo,
      totpHabilitado: fila.totpHabilitado,
    };
  }

  async actualizarPerfil(
    usuarioId: string,
    datos: {
      nombreCompleto?: string;
      telefono?: string;
      fotoUrl?: string | null;
    },
  ): Promise<void> {
    const valores: Record<string, unknown> = {};
    if (datos.nombreCompleto !== undefined)
      valores.nombreCompleto = datos.nombreCompleto;
    if (datos.telefono !== undefined) valores.telefono = datos.telefono;
    if (datos.fotoUrl !== undefined) valores.fotoUrl = datos.fotoUrl;
    if (Object.keys(valores).length === 0) return;
    await this.db
      .update(usuarios)
      .set(valores)
      .where(eq(usuarios.id, usuarioId));
  }

  async actualizarIdentidad(
    usuarioId: string,
    datos: { nombreCompleto?: string; cedula?: string },
    ahora: Date,
  ): Promise<void> {
    const valores: Record<string, unknown> = { ultimoCambioIdentidadEn: ahora };
    if (datos.nombreCompleto !== undefined) valores.nombreCompleto = datos.nombreCompleto;
    if (datos.cedula !== undefined) valores.cedula = datos.cedula;
    await this.db
      .update(usuarios)
      .set(valores)
      .where(eq(usuarios.id, usuarioId));
  }

  /**
   * Reintenta hasta 5 veces ante una colisión del índice único
   * (extremadamente improbable con 6 caracteres alfanuméricos en
   * mayúsculas -- ~2 mil millones de combinaciones -- pero un
   * identificador único siempre necesita un plan real para la
   * colisión, no asumir que "nunca va a pasar").
   */
  async asegurarCodigoPasajero(usuarioId: string): Promise<string> {
    const existente = await this.db.query.usuarios.findFirst({
      where: eq(usuarios.id, usuarioId),
      columns: { codigoPasajero: true },
    });
    if (existente?.codigoPasajero) return existente.codigoPasajero;

    const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I, se confunden visualmente
    for (let intento = 0; intento < 5; intento++) {
      const sufijo = Array.from({ length: 6 }, () => {
        const i = randomBytes(1)[0] % ALFABETO.length;
        return ALFABETO[i];
      }).join('');
      const codigo = `COL-${sufijo}`;
      try {
        await this.db
          .update(usuarios)
          .set({ codigoPasajero: codigo })
          .where(eq(usuarios.id, usuarioId));
        return codigo;
      } catch (error) {
        const errorTipado = error as { cause?: { constraint?: string } };
        if (errorTipado?.cause?.constraint === 'uq_usuarios_codigo_pasajero') {
          continue; // colisión real -- reintenta con un código nuevo
        }
        throw error;
      }
    }
    throw new Error('No se pudo generar un código de pasajero único tras 5 intentos.');
  }

  async actualizarPasswordHash(
    usuarioId: string,
    nuevoHash: string,
  ): Promise<void> {
    await this.db
      .update(usuarios)
      .set({ passwordHash: nuevoHash })
      .where(eq(usuarios.id, usuarioId));
  }

  async contarViajesCompletados(usuarioId: string): Promise<number> {
    const resultado = await this.db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM boletos b
      JOIN compras c ON c.id = b.compra_id
      WHERE c.comprador_usuario_id = ${usuarioId} AND b.estado = 'usado'
    `);
    return (resultado.rows[0] as { total: number })?.total ?? 0;
  }

  async guardarTokenReset(
    usuarioId: string,
    tokenHash: string,
    expiraEn: Date,
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO tokens_usuario (usuario_id, proposito, token_hash, expira_en)
      VALUES (${usuarioId}, 'reset_password', ${tokenHash}, ${expiraEn.toISOString()})
    `);
  }

  async consumirTokenResetVigente(
    tokenHash: string,
  ): Promise<{ id: string; usuarioId: string } | null> {
    const resultado = await this.db.execute(sql`
      UPDATE tokens_usuario
      SET usado_en = now()
      WHERE token_hash = ${tokenHash}
        AND proposito = 'reset_password'
        AND usado_en IS NULL
        AND expira_en > now()
      RETURNING id, usuario_id
    `);
    const fila = resultado.rows[0] as { id: string; usuario_id: string } | undefined;
    if (!fila) return null;
    return { id: fila.id, usuarioId: fila.usuario_id };
  }

  async guardarTokenVerificacion(
    usuarioId: string,
    tokenHash: string,
    expiraEn: Date,
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO tokens_usuario (usuario_id, proposito, token_hash, expira_en)
      VALUES (${usuarioId}, 'verificar_correo', ${tokenHash}, ${expiraEn.toISOString()})
    `);
  }

  async consumirTokenVerificacionVigente(
    tokenHash: string,
  ): Promise<{ id: string; usuarioId: string } | null> {
    const resultado = await this.db.execute(sql`
      UPDATE tokens_usuario
      SET usado_en = now()
      WHERE token_hash = ${tokenHash}
        AND proposito = 'verificar_correo'
        AND usado_en IS NULL
        AND expira_en > now()
      RETURNING id, usuario_id
    `);
    const fila = resultado.rows[0] as { id: string; usuario_id: string } | undefined;
    if (!fila) return null;
    return { id: fila.id, usuarioId: fila.usuario_id };
  }

  async marcarCorreoVerificado(usuarioId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE usuarios SET correo_verificado = true WHERE id = ${usuarioId}
    `);
  }

  async guardarTokenCambioCorreo(
    usuarioId: string,
    correoNuevo: string,
    tokenHash: string,
    expiraEn: Date,
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO tokens_usuario (usuario_id, proposito, token_hash, expira_en, correo_nuevo)
      VALUES (${usuarioId}, 'cambiar_correo', ${tokenHash}, ${expiraEn.toISOString()}, ${correoNuevo})
    `);
  }

  async consumirTokenCambioCorreoVigente(
    tokenHash: string,
  ): Promise<{ id: string; usuarioId: string; correoNuevo: string } | null> {
    // Mismo patrón atómico que refresh_session/reset_password/verificar_correo
    // (fix de condición de carrera real, 28-jul-2026) — una sola sentencia
    // UPDATE...WHERE usado_en IS NULL...RETURNING.
    const resultado = await this.db.execute(sql`
      UPDATE tokens_usuario
      SET usado_en = now()
      WHERE token_hash = ${tokenHash}
        AND proposito = 'cambiar_correo'
        AND usado_en IS NULL
        AND expira_en > now()
      RETURNING id, usuario_id, correo_nuevo
    `);
    const fila = resultado.rows[0] as
      | { id: string; usuario_id: string; correo_nuevo: string }
      | undefined;
    if (!fila) return null;
    return { id: fila.id, usuarioId: fila.usuario_id, correoNuevo: fila.correo_nuevo };
  }

  async actualizarCorreo(usuarioId: string, correoNuevo: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE usuarios SET correo = ${correoNuevo} WHERE id = ${usuarioId}
    `);
  }

  async guardarTokenRefresh(
    usuarioId: string,
    tokenHash: string,
    expiraEn: Date,
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO tokens_usuario (usuario_id, proposito, token_hash, expira_en)
      VALUES (${usuarioId}, 'refresh_session', ${tokenHash}, ${expiraEn.toISOString()})
    `);
  }

  async consumirTokenRefreshVigente(
    tokenHash: string,
  ): Promise<{ id: string; usuarioId: string } | null> {
    // Atómico: el UPDATE con WHERE usado_en IS NULL solo puede aplicar a
    // la fila una vez, incluso si dos peticiones concurrentes ejecutan
    // esta misma sentencia al mismo tiempo — Postgres serializa el
    // acceso a nivel de fila. La segunda petición simplemente no
    // encuentra ninguna fila que actualizar (0 filas afectadas).
    const resultado = await this.db.execute(sql`
      UPDATE tokens_usuario
      SET usado_en = now()
      WHERE token_hash = ${tokenHash}
        AND proposito = 'refresh_session'
        AND usado_en IS NULL
        AND expira_en > now()
      RETURNING id, usuario_id
    `);
    const fila = resultado.rows[0] as { id: string; usuario_id: string } | undefined;
    if (!fila) return null;
    return { id: fila.id, usuarioId: fila.usuario_id };
  }

  /**
   * Ítem 17, Fase 3 (05-ago-2026) -- anonimización, no DELETE de la
   * fila. Envuelto en transacción: o se anonimiza la cuenta completa +
   * se limpian sus tokens + se desvincula de sus compras, o no pasa
   * nada -- no queda a medio hacer si algo falla en el medio.
   */
  async eliminarCuenta(usuarioId: string, correoAnonimo: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE usuarios
        SET correo = ${correoAnonimo},
            nombre_completo = 'Usuario eliminado',
            cedula = NULL,
            telefono = NULL,
            foto_url = NULL,
            password_hash = NULL,
            proveedor_externo = NULL,
            proveedor_externo_id = NULL,
            activo = false
        WHERE id = ${usuarioId}
      `);
      await tx.execute(sql`
        DELETE FROM tokens_usuario WHERE usuario_id = ${usuarioId}
      `);
      // No se tocan pasajeros_compra.nombre_completo/.documento -- es el
      // registro contable de una venta real de la cooperativa, decisión
      // del director confirmada, no un dato exclusivo de esta cuenta.
      await tx.execute(sql`
        UPDATE compras SET comprador_usuario_id = NULL WHERE comprador_usuario_id = ${usuarioId}
      `);
    });
  }

  async eliminarTokensAntiguos(antesDe: Date): Promise<number> {
    const resultado = await this.db.execute(sql`
      DELETE FROM tokens_usuario
      WHERE (usado_en IS NOT NULL OR expira_en < now())
        AND creado_en < ${antesDe.toISOString()}
      RETURNING id
    `);
    return resultado.rows.length;
  }

  async guardarTokenLogin2fa(
    usuarioId: string,
    tokenHash: string,
    expiraEn: Date,
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO tokens_usuario (usuario_id, proposito, token_hash, expira_en)
      VALUES (${usuarioId}, 'login_2fa', ${tokenHash}, ${expiraEn.toISOString()})
    `);
  }

  /**
   * A propósito NO consume el token aquí (a diferencia de los demás
   * "consumir...Vigente") -- este token intermedio se usa varias veces
   * dentro de su propia ventana de 10 minutos: primero para pedir el QR
   * de configuración, después para confirmar el código, o para
   * reintentar si el admin se equivocó al escribirlo.
   */
  async buscarTokenLogin2faVigente(
    tokenHash: string,
  ): Promise<{ usuarioId: string } | null> {
    const resultado = await this.db.execute(sql`
      SELECT usuario_id FROM tokens_usuario
      WHERE token_hash = ${tokenHash}
        AND proposito = 'login_2fa'
        AND usado_en IS NULL
        AND expira_en > now()
      LIMIT 1
    `);
    const fila = resultado.rows[0] as { usuario_id: string } | undefined;
    if (!fila) return null;
    return { usuarioId: fila.usuario_id };
  }

  async guardarSecretoTotpPendiente(
    usuarioId: string,
    secretoCifrado: string,
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE usuarios SET totp_secret = ${secretoCifrado} WHERE id = ${usuarioId}
    `);
  }

  async obtenerSecretoTotpCifrado(usuarioId: string): Promise<string | null> {
    const resultado = await this.db.execute(sql`
      SELECT totp_secret FROM usuarios WHERE id = ${usuarioId}
    `);
    const fila = resultado.rows[0] as { totp_secret: string | null } | undefined;
    return fila?.totp_secret ?? null;
  }

  /** Transacción: activar 2FA + guardar los 10 códigos de recuperación es todo o nada. */
  async activarTotp(
    usuarioId: string,
    codigosRecuperacionHash: string[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE usuarios SET totp_habilitado = true WHERE id = ${usuarioId}
      `);
      for (const hash of codigosRecuperacionHash) {
        await tx.execute(sql`
          INSERT INTO codigos_recuperacion_2fa (usuario_id, codigo_hash)
          VALUES (${usuarioId}, ${hash})
        `);
      }
    });
  }

  /** Atómico -- mismo patrón de condición de carrera ya corregido en el resto de tokens de un solo uso. */
  async consumirCodigoRecuperacion(
    usuarioId: string,
    codigoHash: string,
  ): Promise<boolean> {
    const resultado = await this.db.execute(sql`
      UPDATE codigos_recuperacion_2fa
      SET usado_en = now()
      WHERE usuario_id = ${usuarioId}
        AND codigo_hash = ${codigoHash}
        AND usado_en IS NULL
      RETURNING id
    `);
    return resultado.rows.length > 0;
  }
}