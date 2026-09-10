import {
  Injectable,
  Inject,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import QRCode from 'qrcode';
import { randomBytes, createHash } from 'node:crypto';
import type {
  UsuarioRepositorio,
  HasherContrasena,
  EmisorTokens,
  DatosRegistro,
  UsuarioDominio,
  NotificadorEmail,
  AlmacenamientoArchivos,
  CifradorTotp,
} from '../../dominio/auth/auth.ports';
import {
  calcularBloqueoTrasIntentoFallido,
  cuentaEstaBloqueada,
  puedeEditarIdentidad,
  generarSecretoTotp,
  generarCodigoTotp,
  verificarCodigoTotp,
  generarUriTotp,
} from '../../dominio/auth/auth.ports';
import { ReferidosService } from '../referidos/referidos.service';

export const USUARIO_REPOSITORIO = 'USUARIO_REPOSITORIO';
export const HASHER_CONTRASENA = 'HASHER_CONTRASENA';
export const EMISOR_TOKENS = 'EMISOR_TOKENS';
export const NOTIFICADOR_EMAIL = 'NOTIFICADOR_EMAIL';
export const ALMACENAMIENTO_ARCHIVOS = 'ALMACENAMIENTO_ARCHIVOS';
export const CIFRADOR_TOTP = 'CIFRADOR_TOTP';

/**
 * Ítem 19, Fase 3 (05-ago-2026) -- roles con 2FA obligatorio, sin
 * excepción, decisión del director: cuentas con poder real sobre
 * dinero, datos de menores, y control de otras cuentas.
 */
const ROLES_2FA_OBLIGATORIO: UsuarioDominio['rol'][] = [
  'super_admin',
  'admin_plataforma',
  'admin_cooperativa',
];

/** Mismo criterio ya usado en el código de pasajero -- sin 0/O/1/I, se confunden visualmente. */
function generarCodigoRecuperacion(): string {
  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 10 }, () => {
    const i = randomBytes(1)[0] % ALFABETO.length;
    return ALFABETO[i];
  }).join('');
}

/**
 * Casos de uso de autenticación (RF-AUTH-001, RF-AUTH-002). Orquesta el
 * dominio y pide cosas a la infraestructura a través de las interfaces
 * inyectadas — nunca importa Drizzle, bcrypt ni JWT directamente
 * (Arquitectura Técnica, sección 2.1).
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(USUARIO_REPOSITORIO) private readonly usuarios: UsuarioRepositorio,
    @Inject(HASHER_CONTRASENA) private readonly hasher: HasherContrasena,
    @Inject(EMISOR_TOKENS) private readonly tokens: EmisorTokens,
    @Inject(NOTIFICADOR_EMAIL) private readonly email: NotificadorEmail,
    @Inject(ALMACENAMIENTO_ARCHIVOS) private readonly almacenamiento: AlmacenamientoArchivos,
    @Inject(CIFRADOR_TOTP) private readonly cifradorTotp: CifradorTotp,
    private readonly referidos: ReferidosService,
  ) {}

  /** RF-AUTH-001 — registro de pasajero. */
  async registrar(datos: DatosRegistro, codigoReferido?: string) {
    const existente = await this.usuarios.buscarPorCorreo(datos.correo);
    if (existente) {
      throw new ConflictException('Ya existe una cuenta con ese correo.');
    }

    const passwordHash = await this.hasher.hash(datos.password);
    const usuario = await this.usuarios.crearPasajero({
      ...datos,
      password: passwordHash,
    });

    // Programa de referidos (13-ago-2026) -- se genera el código de
    // pasajero de forma ANTICIPADA (antes era perezoso, solo al pedir
    // el perfil) para que la cuenta recién creada ya tenga un código
    // compartible de inmediato, sin depender de que el usuario visite
    // su perfil primero. Nunca lanza (ver acreditarReferidoPorRegistro,
    // abajo, mismo criterio de no bloquear el registro por esto).
    try {
      await this.usuarios.asegurarCodigoPasajero(usuario.id);
    } catch (error) {
      // No se registra con this.logger porque AuthService no tiene uno
      // propio hoy -- no vale la pena agregarlo solo para este caso,
      // el registro continúa de todas formas.
      void error;
    }

    if (codigoReferido) {
      await this.referidos.registrarReferido({
        codigoReferido,
        usuarioReferidoId: usuario.id,
        cedulaReferido: datos.cedula ?? null,
      });
    }

    // 27-jul-2026 -- RF-AUTH-001 "recibe confirmacion por correo",
    // cerrado: token real, expira en 24h.
    const tokenPlanoVerif = randomBytes(32).toString('hex');
    const tokenHashVerif = createHash('sha256').update(tokenPlanoVerif).digest('hex');
    const expiraEnVerif = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.usuarios.guardarTokenVerificacion(usuario.id, tokenHashVerif, expiraEnVerif);
    await this.email.enviarVerificacionCorreo(usuario.correo, tokenPlanoVerif);

    // Nota: el envío real del correo de confirmación (RF-AUTH-001,
    // "recibe confirmación por correo") pertenece al módulo RF-NOTIF, que
    // todavía no está construido — queda pendiente conectar aquí cuando
    // exista.

    return this.emitirTokenPara(usuario);
  }

  /**
   * RF-AUTH-002 — login con protección de fuerza bruta. Ver
   * dominio/auth/auth.ports.ts para la limitación conocida respecto al
   * criterio exacto del SRS (ventana deslizante de 10 minutos).
   */
  async login(correo: string, passwordPlano: string) {
    const usuario = await this.usuarios.buscarPorCorreo(correo);

    // Mismo mensaje de error si el correo no existe o si la contraseña es
    // incorrecta — no revelar cuál de las dos cosas falló, práctica
    // estándar de seguridad (evita que un atacante confirme qué correos
    // están registrados).
    const credencialesInvalidas = () =>
      new UnauthorizedException('Correo o contraseña incorrectos.');

    if (!usuario || !usuario.activo || !usuario.passwordHash) {
      throw credencialesInvalidas();
    }

    if (cuentaEstaBloqueada(usuario.bloqueadoHasta)) {
      throw new UnauthorizedException(
        'Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intenta más tarde.',
      );
    }

    const passwordValido = await this.hasher.comparar(
      passwordPlano,
      usuario.passwordHash,
    );

    if (!passwordValido) {
      const { nuevoConteo, bloqueadoHasta } = calcularBloqueoTrasIntentoFallido(
        usuario.intentosFallidos,
      );
      await this.usuarios.registrarIntentoFallido(
        usuario.id,
        nuevoConteo,
        bloqueadoHasta,
      );
      throw credencialesInvalidas();
    }

    await this.usuarios.reiniciarIntentosFallidos(usuario.id);

    // Ítem 19, Fase 3 (05-ago-2026) -- 2FA obligatorio, sin excepción,
    // para las 3 cuentas administrativas. No emite las credenciales
    // reales todavía -- entrega un token temporal (10 min) que solo
    // sirve para completar el segundo factor, nunca para acceder al
    // panel directamente.
    // Bypass en modo prueba -- mismo patrón exacto que ya usa @Throttle
    // en este mismo controller (ver auth.controller.ts, "limite
    // estricto... process.env.NODE_ENV === 'test' ? 10000 : 5"). Sin
    // esto, decenas de pruebas e2e existentes que ya inician sesión
    // como admin_cooperativa/admin_plataforma/super_admin y esperan
    // accessToken directo se romperían de golpe.
    // Desactivado temporalmente a pedido del director (24-ago-2026) --
    // necesita entrar sin friccion a los paneles administrativos
    // mientras hace ajustes y pruebas reales. Se reactiva borrando la
    // variable de entorno DESACTIVAR_2FA_TEMPORAL (local y/o en
    // Render), sin tocar codigo de nuevo. Por defecto, sin la
    // variable puesta, el 2FA sigue exigiendose normal -- no hay
    // riesgo de que quede desactivado por accidente.
    if (
      ROLES_2FA_OBLIGATORIO.includes(usuario.rol) &&
      process.env.NODE_ENV !== 'test' &&
      process.env.DESACTIVAR_2FA_TEMPORAL !== 'true'
    ) {
      const tokenTemporal = await this.emitirTokenTemporal2fa(usuario.id);
      if (!usuario.totpHabilitado) {
        // "Configuración forzada en el siguiente login", no un bloqueo
        // duro -- decisión del director: obligatorio ya (no hay
        // producción real que proteger con un período de gracia), pero
        // el mismo login sigue funcionando, solo que primero exige
        // completar el setup, nunca deja a nadie fuera sin salida.
        return { requiereConfigurar2fa: true as const, tokenTemporal };
      }
      return { requiere2fa: true as const, tokenTemporal };
    }

    return this.emitirTokenPara(usuario);
  }

  private async emitirTokenPara(usuario: UsuarioDominio) {
    const accessToken = this.tokens.firmar({
      sub: usuario.id,
      rol: usuario.rol,
      cooperativaId: usuario.cooperativaId,
    });

    // 27-jul-2026 -- refresh token, 30 dias, un solo uso.
    const refreshTokenPlano = randomBytes(32).toString('hex');
    const refreshTokenHash = createHash('sha256').update(refreshTokenPlano).digest('hex');
    const expiraEn = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.usuarios.guardarTokenRefresh(usuario.id, refreshTokenHash, expiraEn);

    return { accessToken, refreshToken: refreshTokenPlano };
  }

  /** Ítem 19 (05-ago-2026) -- token intermedio de 10 min, entre "contraseña correcta" y "sesión completa" mientras se resuelve el segundo factor. */
  private async emitirTokenTemporal2fa(usuarioId: string): Promise<string> {
    const tokenPlano = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(tokenPlano).digest('hex');
    const expiraEn = new Date(Date.now() + 10 * 60 * 1000);
    await this.usuarios.guardarTokenLogin2fa(usuarioId, tokenHash, expiraEn);
    return tokenPlano;
  }

  private async validarTokenTemporal2fa(tokenPlano: string): Promise<UsuarioDominio> {
    const tokenHash = createHash('sha256').update(tokenPlano).digest('hex');
    const resultado = await this.usuarios.buscarTokenLogin2faVigente(tokenHash);
    if (!resultado) {
      throw new UnauthorizedException(
        'Esta sesión de verificación expiró o no es válida. Inicia sesión de nuevo.',
      );
    }
    const usuario = await this.usuarios.buscarPorId(resultado.usuarioId);
    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException('Usuario no encontrado o inactivo.');
    }
    return usuario;
  }

  async refrescarToken(refreshTokenPlano: string) {
    const tokenHash = createHash('sha256').update(refreshTokenPlano).digest('hex');
    const token = await this.usuarios.consumirTokenRefreshVigente(tokenHash);

    if (!token) {
      throw new UnauthorizedException(
        'El token de sesion no es valido o ya expiro. Inicia sesion de nuevo.',
      );
    }

    const usuario = await this.usuarios.buscarPorId(token.usuarioId);
    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException('Usuario no encontrado o inactivo.');
    }

    return this.emitirTokenPara(usuario);
  }

  /** Perfil real (22-jul-2026) — antes GET /auth/perfil solo devolvía el payload del token, no los datos reales del usuario. */
  async obtenerMiPerfil(usuarioId: string) {
    const usuario = await this.usuarios.buscarPorId(usuarioId);
    if (!usuario) throw new NotFoundException('Usuario no encontrado.');

    const viajesCompletados =
      usuario.rol === 'pasajero'
        ? await this.usuarios.contarViajesCompletados(usuarioId)
        : undefined;

    // Ítem 6, Fase 2 (03-ago-2026) -- generación perezosa (lazy): el
    // código se crea la primera vez que alguien pide su perfil, no en
    // el registro. Así los usuarios que ya existían antes de este
    // cambio también terminan con uno, sin backfill manual.
    const codigoPasajero = await this.usuarios.asegurarCodigoPasajero(usuarioId);

    const limiteIdentidad = puedeEditarIdentidad(usuario.ultimoCambioIdentidadEn);

    return {
      id: usuario.id,
      rol: usuario.rol,
      correo: usuario.correo,
      nombreCompleto: usuario.nombreCompleto,
      cedula: usuario.cedula,
      telefono: usuario.telefono,
      fotoUrl: usuario.fotoUrl,
      codigoPasajero,
      creadoEn: usuario.creadoEn,
      viajesCompletados,
      puedeEditarIdentidad: limiteIdentidad.permitido,
      diasRestantesParaEditarIdentidad: limiteIdentidad.permitido
        ? null
        : limiteIdentidad.diasRestantes,
    };
  }

  /** Solo teléfono/foto -- sin límite. Nombre/cédula van por actualizarMiIdentidad (90 días). */
  async actualizarMiPerfil(
    usuarioId: string,
    datos: { telefono?: string; fotoUrl?: string },
  ) {
    await this.usuarios.actualizarPerfil(usuarioId, datos);
  }

  /**
   * Ítem 6, Fase 2 (03-ago-2026) -- SEPARADO de actualizarMiPerfil a
   * propósito: nombre y cédula llevan el límite de 90 días (sección
   * 3.1.1), teléfono/foto no. Rechaza con el motivo exacto (días
   * restantes) si el límite todavía no se cumple -- el frontend lo usa
   * para mostrar un mensaje claro, no solo un error genérico.
   */
  async actualizarMiIdentidad(
    usuarioId: string,
    datos: { nombreCompleto?: string; cedula?: string },
  ) {
    if (datos.nombreCompleto === undefined && datos.cedula === undefined) {
      return; // nada que hacer, no gasta el límite en una llamada vacía
    }

    const usuario = await this.usuarios.buscarPorId(usuarioId);
    if (!usuario) throw new NotFoundException('Usuario no encontrado.');

    const limite = puedeEditarIdentidad(usuario.ultimoCambioIdentidadEn);
    if (!limite.permitido) {
      throw new BadRequestException(
        `Tu nombre y cédula solo se pueden cambiar cada 90 días, para proteger boletos ya comprados a tu nombre. Podrás editarlos de nuevo en ${limite.diasRestantes} día(s).`,
      );
    }

    await this.usuarios.actualizarIdentidad(usuarioId, datos, new Date());
  }

  async cambiarPassword(
    usuarioId: string,
    passwordActual: string,
    passwordNueva: string,
  ) {
    const usuario = await this.usuarios.buscarPorId(usuarioId);
    if (!usuario || !usuario.passwordHash) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    const valido = await this.hasher.comparar(
      passwordActual,
      usuario.passwordHash,
    );
    if (!valido) {
      throw new BadRequestException('La contraseña actual no es correcta.');
    }
    if (passwordNueva.length < 8) {
      throw new BadRequestException(
        'La nueva contraseña debe tener al menos 8 caracteres.',
      );
    }
    const nuevoHash = await this.hasher.hash(passwordNueva);
    await this.usuarios.actualizarPasswordHash(usuarioId, nuevoHash);
  }

  /**
   * Cambio de correo (29-jul-2026, hallazgo real del usuario): sin
   * esto, un pasajero que pierde acceso a su correo queda fuera de su
   * cuenta para siempre — el reset de contraseña también depende de
   * ese mismo correo, así que no hay ningún camino de autoservicio.
   *
   * Requiere la contraseña actual (evita que una sesión robada pueda
   * secuestrar la cuenta cambiando el correo de recuperación), y el
   * correo nuevo no se reemplaza hasta confirmarlo — mismo mecanismo
   * de verificación que ya existe para el registro.
   */
  async solicitarCambioCorreo(
    usuarioId: string,
    correoNuevo: string,
    passwordActual: string,
  ) {
    const usuario = await this.usuarios.buscarPorId(usuarioId);
    if (!usuario || !usuario.passwordHash) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    const valido = await this.hasher.comparar(passwordActual, usuario.passwordHash);
    if (!valido) {
      throw new BadRequestException('La contraseña actual no es correcta.');
    }

    const yaExiste = await this.usuarios.buscarPorCorreo(correoNuevo);
    if (yaExiste) {
      throw new ConflictException('Ya existe una cuenta con ese correo.');
    }

    const tokenPlano = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(tokenPlano).digest('hex');
    const expiraEn = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.usuarios.guardarTokenCambioCorreo(
      usuarioId,
      correoNuevo,
      tokenHash,
      expiraEn,
    );
    await this.email.enviarVerificacionCorreo(correoNuevo, tokenPlano);

    return { ok: true };
  }

  async confirmarCambioCorreo(tokenPlano: string) {
    const tokenHash = createHash('sha256').update(tokenPlano).digest('hex');
    const token = await this.usuarios.consumirTokenCambioCorreoVigente(tokenHash);

    if (!token) {
      throw new BadRequestException(
        'Este enlace de cambio de correo no es válido o ya expiró. Solicita uno nuevo.',
      );
    }

    await this.usuarios.actualizarCorreo(token.usuarioId, token.correoNuevo);

    return { ok: true };
  }

  async solicitarResetPassword(correo: string) {
    const usuario = await this.usuarios.buscarPorCorreo(correo);

    if (usuario) {
      const tokenPlano = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(tokenPlano).digest('hex');
      const expiraEn = new Date(Date.now() + 30 * 60 * 1000);

      await this.usuarios.guardarTokenReset(usuario.id, tokenHash, expiraEn);
      await this.email.enviarResetPassword(usuario.correo, tokenPlano);
    }

    return { ok: true };
  }

  async subirFotoPerfil(usuarioId: string, buffer: Buffer, nombreOriginal: string) {
    const resultado = await this.almacenamiento.guardarImagen(
      buffer,
      nombreOriginal,
      'perfiles',
    );
    await this.usuarios.actualizarPerfil(usuarioId, { fotoUrl: resultado.url });
    return { url: resultado.url };
  }

  async restablecerPassword(tokenPlano: string, passwordNueva: string) {
    if (passwordNueva.length < 8) {
      throw new BadRequestException(
        'La nueva contrasena debe tener al menos 8 caracteres.',
      );
    }

    const tokenHash = createHash('sha256').update(tokenPlano).digest('hex');
    const token = await this.usuarios.consumirTokenResetVigente(tokenHash);

    if (!token) {
      throw new BadRequestException(
        'Este enlace de recuperacion no es valido o ya expiro. Solicita uno nuevo.',
      );
    }

    const nuevoHash = await this.hasher.hash(passwordNueva);
    await this.usuarios.actualizarPasswordHash(token.usuarioId, nuevoHash);

    return { ok: true };
  }

  async verificarCorreo(tokenPlano: string) {
    const tokenHash = createHash('sha256').update(tokenPlano).digest('hex');
    const token = await this.usuarios.consumirTokenVerificacionVigente(tokenHash);

    if (!token) {
      throw new BadRequestException(
        'Este enlace de verificacion no es valido o ya expiro. Solicita uno nuevo.',
      );
    }

    await this.usuarios.marcarCorreoVerificado(token.usuarioId);

    return { ok: true };
  }

  async reenviarVerificacion(usuarioId: string) {
    const usuario = await this.usuarios.buscarPorId(usuarioId);
    if (!usuario) throw new NotFoundException('Usuario no encontrado.');
    if (usuario.correoVerificado) {
      return { ok: true, yaVerificado: true };
    }

    const tokenPlano = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(tokenPlano).digest('hex');
    const expiraEn = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.usuarios.guardarTokenVerificacion(usuario.id, tokenHash, expiraEn);
    await this.email.enviarVerificacionCorreo(usuario.correo, tokenPlano);

    return { ok: true, yaVerificado: false };
  }

  /**
   * Ítem 17, Fase 3 (05-ago-2026) -- LOPDP, derecho de eliminación.
   * Confirmación real antes de ejecutar (decisión del director): si la
   * cuenta tiene contraseña, debe reingresarla -- mismo criterio que
   * cambiarPassword/solicitarCambioCorreo. Si no tiene (login externo,
   * ej. Google), no hay contraseña que verificar -- exige escribir
   * literalmente "ELIMINAR" como confirmación equivalente.
   */
  async eliminarMiCuenta(
    usuarioId: string,
    confirmacion: { password?: string; frase?: string },
  ) {
    const usuario = await this.usuarios.buscarPorId(usuarioId);
    if (!usuario) throw new NotFoundException('Usuario no encontrado.');

    if (usuario.passwordHash) {
      if (!confirmacion.password) {
        throw new BadRequestException(
          'Debes ingresar tu contraseña actual para confirmar la eliminación.',
        );
      }
      const valido = await this.hasher.comparar(confirmacion.password, usuario.passwordHash);
      if (!valido) {
        throw new BadRequestException('La contraseña actual no es correcta.');
      }
    } else {
      if (confirmacion.frase !== 'ELIMINAR') {
        throw new BadRequestException(
          'Tu cuenta no tiene contraseña (inicio de sesión externo) -- escribe "ELIMINAR" exactamente para confirmar.',
        );
      }
    }

    // Correo único no reversible -- no se puede dejar el correo real
    // (violaría el propósito de anonimizar) ni dejarlo vacío (viola la
    // restricción de único de la columna).
    const correoAnonimo = `usuario-eliminado-${usuarioId}@ticketya.invalido`;
    await this.usuarios.eliminarCuenta(usuarioId, correoAnonimo);

    return { ok: true };
  }

  /**
   * Ítem 17, Fase 3 (05-ago-2026) -- job de limpieza periódica, mismo
   * patrón @Cron ya usado en notificaciones/webhooks. Diario a las 3am,
   * borra tokens usados o expirados hace más de 30 días -- principio de
   * conservación de la LOPDP ("solo el tiempo necesario").
   */
  @Cron('0 3 * * *')
  async limpiarTokensAntiguos() {
    const hace30Dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await this.usuarios.eliminarTokensAntiguos(hace30Dias);
  }

  /** Ítem 19 -- paso 1 de la configuración: genera un secreto nuevo y el QR para escanear, sin activar 2FA todavía. */
  async iniciarConfiguracion2fa(tokenTemporal: string) {
    const usuario = await this.validarTokenTemporal2fa(tokenTemporal);
    if (usuario.totpHabilitado) {
      throw new BadRequestException('2FA ya está activo en esta cuenta.');
    }

    const secreto = generarSecretoTotp();
    const secretoCifrado = this.cifradorTotp.cifrar(secreto);
    await this.usuarios.guardarSecretoTotpPendiente(usuario.id, secretoCifrado);

    const otpauthUrl = generarUriTotp({ issuer: 'Columbus', label: usuario.correo, secreto });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    return { secreto, qrDataUrl };
  }

  /**
   * Ítem 19 -- paso 2: confirma con un código real que el admin sí
   * escaneó bien el QR, activa 2FA de verdad, entrega los 10 códigos
   * de recuperación (se muestran una sola vez, nunca se guardan en
   * texto plano ni se pueden volver a consultar).
   */
  async confirmarConfiguracion2fa(tokenTemporal: string, codigo: string) {
    const usuario = await this.validarTokenTemporal2fa(tokenTemporal);
    if (usuario.totpHabilitado) {
      throw new BadRequestException('2FA ya está activo en esta cuenta.');
    }

    const secretoCifrado = await this.usuarios.obtenerSecretoTotpCifrado(usuario.id);
    if (!secretoCifrado) {
      throw new BadRequestException(
        'No hay ninguna configuración de 2FA pendiente. Inicia el proceso de nuevo.',
      );
    }
    const secreto = this.cifradorTotp.descifrar(secretoCifrado);
    const valido = verificarCodigoTotp(secreto, codigo);
    if (!valido) {
      throw new BadRequestException(
        'El código no es válido. Verifica la hora de tu teléfono e intenta de nuevo.',
      );
    }

    const codigosRecuperacionPlanos = Array.from({ length: 10 }, () => generarCodigoRecuperacion());
    const codigosRecuperacionHash = codigosRecuperacionPlanos.map((c) =>
      createHash('sha256').update(c).digest('hex'),
    );
    await this.usuarios.activarTotp(usuario.id, codigosRecuperacionHash);

    const credenciales = await this.emitirTokenPara(usuario);
    return { ...credenciales, codigosRecuperacion: codigosRecuperacionPlanos };
  }

  /** Ítem 19 -- login normal cuando 2FA ya está activo: valida el código de 6 dígitos y entrega las credenciales reales. */
  async verificar2fa(tokenTemporal: string, codigo: string) {
    const usuario = await this.validarTokenTemporal2fa(tokenTemporal);
    if (!usuario.totpHabilitado) {
      throw new BadRequestException('Esta cuenta todavía no tiene 2FA configurado.');
    }
    const secretoCifrado = await this.usuarios.obtenerSecretoTotpCifrado(usuario.id);
    if (!secretoCifrado) {
      throw new UnauthorizedException('No se pudo verificar el código. Contacta soporte.');
    }
    const secreto = this.cifradorTotp.descifrar(secretoCifrado);
    const valido = verificarCodigoTotp(secreto, codigo);
    if (!valido) {
      throw new UnauthorizedException('El código no es válido.');
    }
    return this.emitirTokenPara(usuario);
  }

  /**
   * Ítem 19 -- respaldo si el admin perdió su app autenticadora: un
   * código de recuperación de un solo uso completa el login igual que
   * el código de 6 dígitos -- sin esto, perder el teléfono dejaría a
   * un admin fuera de su propia cuenta para siempre.
   */
  async recuperarCon2fa(tokenTemporal: string, codigoRecuperacion: string) {
    const usuario = await this.validarTokenTemporal2fa(tokenTemporal);
    if (!usuario.totpHabilitado) {
      throw new BadRequestException('Esta cuenta todavía no tiene 2FA configurado.');
    }
    const codigoHash = createHash('sha256')
      .update(codigoRecuperacion.trim().toUpperCase())
      .digest('hex');
    const valido = await this.usuarios.consumirCodigoRecuperacion(usuario.id, codigoHash);
    if (!valido) {
      throw new UnauthorizedException('Ese código de recuperación no es válido o ya fue usado.');
    }
    return this.emitirTokenPara(usuario);
  }
}