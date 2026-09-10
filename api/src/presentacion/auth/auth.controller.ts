import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from '../../aplicacion/auth/auth.service';
import { RegistroDto } from './dto/registro.dto';
import { LoginDto } from './dto/login.dto';
import { ActualizarPerfilDto } from './dto/actualizar-perfil.dto';
import { ActualizarIdentidadDto } from './dto/actualizar-identidad.dto';
import { CambiarPasswordDto } from './dto/cambiar-password.dto';
import { TokenTemporal2faDto } from './dto/token-temporal-2fa.dto';
import { Codigo2faDto } from './dto/codigo-2fa.dto';
import { RecuperarCodigo2faDto } from './dto/recuperar-codigo-2fa.dto';
import { EliminarCuentaDto } from './dto/eliminar-cuenta.dto';
import { SolicitarCambioCorreoDto, ConfirmarCambioCorreoDto } from './dto/cambiar-correo.dto';
import { SolicitarResetDto } from './dto/solicitar-reset.dto';
import { RestablecerPasswordDto } from './dto/restablecer-password.dto';
import { VerificarCorreoDto } from './dto/verificar-correo.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PayloadToken } from '../../dominio/auth/auth.ports';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** RF-AUTH-001 */
  /** 27-jul-2026 -- limite estricto: 5 intentos por minuto, mas restrictivo que el global (Fase B, seguridad). */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 10000 : 5, ttl: 60000 } })
  @Post('registro')
  async registro(@Body() datos: RegistroDto) {
    // 29-jul-2026 -- el formulario ahora pide nombres y apellidos por
    // separado (mejor validación, más claro para el usuario), pero el
    // resto del sistema (boletos, comprobantes, recibos) ya depende de
    // un solo campo `nombreCompleto` en muchos lugares — se combinan
    // aquí, en el borde, sin propagar el cambio a todo lo demás.
    const { nombres, apellidos, codigoReferido, ...resto } = datos;
    return this.authService.registrar(
      {
        ...resto,
        nombreCompleto: `${nombres.trim()} ${apellidos.trim()}`,
      },
      codigoReferido,
    );
  }

  /** RF-AUTH-002 */
  /** 27-jul-2026 -- limite estricto: 5 intentos por minuto, protege contra fuerza bruta (Fase B, seguridad). */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 10000 : 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() datos: LoginDto) {
    return this.authService.login(datos.correo, datos.password);
  }

  /**
   * Ítem 19, Fase 3 (05-ago-2026) -- 2FA obligatorio, paso 1: genera el
   * secreto y el QR para escanear. Público (sin JwtAuthGuard) a
   * propósito -- el usuario todavía no tiene una sesión real, solo el
   * token temporal que login() le entregó; ese token es la credencial
   * de este flujo, validado dentro del service.
   */
  @Post('2fa/iniciar-configuracion')
  async iniciarConfiguracion2fa(@Body() dto: TokenTemporal2faDto) {
    return this.authService.iniciarConfiguracion2fa(dto.tokenTemporal);
  }

  /** Ítem 19 -- paso 2: confirma el código real, activa 2FA, entrega credenciales + códigos de recuperación (una sola vez). */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 10000 : 5, ttl: 60000 } })
  @Post('2fa/confirmar-configuracion')
  async confirmarConfiguracion2fa(@Body() dto: Codigo2faDto) {
    return this.authService.confirmarConfiguracion2fa(dto.tokenTemporal, dto.codigo);
  }

  /** Ítem 19 -- segundo paso de un login normal, cuando 2FA ya está activo. */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 10000 : 5, ttl: 60000 } })
  @Post('2fa/verificar')
  async verificar2fa(@Body() dto: Codigo2faDto) {
    return this.authService.verificar2fa(dto.tokenTemporal, dto.codigo);
  }

  /** Ítem 19 -- respaldo si el admin perdió su app autenticadora. */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 10000 : 5, ttl: 60000 } })
  @Post('2fa/recuperar')
  async recuperarCon2fa(@Body() dto: RecuperarCodigo2faDto) {
    return this.authService.recuperarCon2fa(dto.tokenTemporal, dto.codigoRecuperacion);
  }

  /** RF-AUTH-006 — perfil real del usuario (nombre, teléfono, foto, viajes completados), no solo el payload del token. */
  @UseGuards(JwtAuthGuard)
  @Get('perfil')
  async perfil(@Request() req: { user: PayloadToken }) {
    return this.authService.obtenerMiPerfil(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('perfil')
  async actualizarPerfil(
    @Body() dto: ActualizarPerfilDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.authService.actualizarMiPerfil(req.user.sub, dto);
    return { ok: true };
  }

  /**
   * Ítem 6, Fase 2 (03-ago-2026) -- separado de PATCH /auth/perfil a
   * propósito: nombre/cédula llevan el límite de 90 días, teléfono/foto
   * no. Devuelve 400 con los días restantes si el límite no se cumple.
   */
  @UseGuards(JwtAuthGuard)
  @Patch('perfil/identidad')
  async actualizarIdentidad(
    @Body() dto: ActualizarIdentidadDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.authService.actualizarMiIdentidad(req.user.sub, dto);
    return { ok: true };
  }

  /** Cambiar contraseña estando logueado — hallazgo real cerrado 22-jul-2026, antes no existía ninguna forma de hacerlo. */
  @UseGuards(JwtAuthGuard)
  @Post('cambiar-password')
  async cambiarPassword(
    @Body() dto: CambiarPasswordDto,
    @Request() req: { user: PayloadToken },
  ) {
    await this.authService.cambiarPassword(
      req.user.sub,
      dto.passwordActual,
      dto.passwordNueva,
    );
    return { ok: true };
  }

  /**
   * Ítem 17, Fase 3 (05-ago-2026) -- LOPDP, derecho de eliminación.
   * Requiere confirmación real: contraseña actual, o "ELIMINAR" escrito
   * literal si la cuenta no tiene contraseña (login externo).
   */
  @UseGuards(JwtAuthGuard)
  @Post('eliminar-cuenta')
  async eliminarCuenta(
    @Body() dto: EliminarCuentaDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.authService.eliminarMiCuenta(req.user.sub, {
      password: dto.password,
      frase: dto.frase,
    });
  }

  /**
   * Cambio de correo (29-jul-2026, hallazgo real del usuario) — sin
   * esto, quien pierde acceso a su correo queda fuera de su cuenta
   * para siempre. Requiere sesión + contraseña actual; el correo no
   * cambia hasta que se confirme el nuevo (ver confirmar-cambio-correo).
   */
  @UseGuards(JwtAuthGuard)
  @Post('solicitar-cambio-correo')
  async solicitarCambioCorreo(
    @Body() dto: SolicitarCambioCorreoDto,
    @Request() req: { user: PayloadToken },
  ) {
    return this.authService.solicitarCambioCorreo(
      req.user.sub,
      dto.correoNuevo,
      dto.passwordActual,
    );
  }

  /** Público, sin login -- el usuario llega aquí desde el enlace del correo nuevo. */
  @Post('confirmar-cambio-correo')
  async confirmarCambioCorreo(@Body() dto: ConfirmarCambioCorreoDto) {
    return this.authService.confirmarCambioCorreo(dto.token);
  }

  @Post('solicitar-reset')
  async solicitarReset(@Body() dto: SolicitarResetDto) {
    return this.authService.solicitarResetPassword(dto.correo);
  }

  @Post('restablecer-password')
  async restablecerPassword(@Body() dto: RestablecerPasswordDto) {
    return this.authService.restablecerPassword(dto.token, dto.passwordNueva);
  }

  /** 27-jul-2026 -- verificacion de correo al registrarse (RF-AUTH-001), publico, sin login. */
  @Post('verificar-correo')
  async verificarCorreo(@Body() dto: VerificarCorreoDto) {
    return this.authService.verificarCorreo(dto.token);
  }

  /** 27-jul-2026 -- RF-AUTH-005: renueva el access token usando el refresh token, sin pedir contrasena de nuevo. */
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 10000 : 5, ttl: 60000 } })
  @Post('refresh')
  async refrescar(@Body() dto: RefreshTokenDto) {
    return this.authService.refrescarToken(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('reenviar-verificacion')
  async reenviarVerificacion(@Request() req: { user: PayloadToken }) {
    return this.authService.reenviarVerificacion(req.user.sub);
  }

  /** 27-jul-2026 -- subida real de foto de perfil, con simulador de almacenamiento. */
  @UseGuards(JwtAuthGuard)
  @Post('perfil/foto')
  @UseInterceptors(
    FileInterceptor('foto', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async subirFotoPerfil(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: { user: PayloadToken },
  ) {
    if (!file) {
      throw new BadRequestException('No se recibio ningun archivo.');
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new BadRequestException(
        'Solo se permiten imagenes JPG, PNG o WEBP.',
      );
    }
    return this.authService.subirFotoPerfil(
      req.user.sub,
      file.buffer,
      file.originalname,
    );
  }
}
