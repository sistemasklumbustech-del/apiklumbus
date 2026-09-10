import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import {
  AuthService,
  USUARIO_REPOSITORIO,
  HASHER_CONTRASENA,
  EMISOR_TOKENS,
  NOTIFICADOR_EMAIL,
  ALMACENAMIENTO_ARCHIVOS,
  CIFRADOR_TOTP,
} from '../../aplicacion/auth/auth.service';
import { UsuarioRepositorioDrizzle } from '../../infraestructura/auth/usuario.repositorio.drizzle';
import { BcryptHasher } from '../../infraestructura/auth/bcrypt.hasher';
import { JwtEmisorTokens } from '../../infraestructura/auth/jwt.emisor-tokens';
import { CifradorTotpAesGcm } from '../../infraestructura/auth/cifrador-totp.aes-gcm';
import { SimuladorNotificador } from '../../infraestructura/notificaciones/simulador.notificador';
import { SimuladorAlmacenamiento } from '../../infraestructura/almacenamiento/simulador.almacenamiento';
import { JwtStrategy } from './guards/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { ReferidosModule } from '../referidos/referidos.module';

/**
 * Este módulo es el único lugar donde se decide QUÉ implementación
 * concreta usa cada puerto del dominio (Drizzle, bcryptjs, JWT). Si el
 * día de mañana se cambia de proveedor de hashing o de estrategia de
 * token, este es el único archivo que debería tocarse — ni el dominio ni
 * la aplicación se enteran del cambio (Arquitectura Técnica, sección
 * 2.1).
 */
@Module({
  imports: [
    ConfigModule,
    PassportModule,
    ReferidosModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // RF-AUTH-005 — "Un token de sesión inactivo por más de 60
        // minutos deja de ser válido". Esto expira el token en sí (no
        // detecta "inactividad" real, ver nota más abajo).
        signOptions: { expiresIn: '60m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RolesGuard,
    JwtStrategy,
    { provide: USUARIO_REPOSITORIO, useClass: UsuarioRepositorioDrizzle },
    { provide: HASHER_CONTRASENA, useClass: BcryptHasher },
    { provide: EMISOR_TOKENS, useClass: JwtEmisorTokens },
    { provide: NOTIFICADOR_EMAIL, useClass: SimuladorNotificador },
    { provide: ALMACENAMIENTO_ARCHIVOS, useClass: SimuladorAlmacenamiento },
    { provide: CIFRADOR_TOTP, useClass: CifradorTotpAesGcm },
  ],
  exports: [RolesGuard, NOTIFICADOR_EMAIL, ALMACENAMIENTO_ARCHIVOS],
})
export class AuthModule {}

/**
 * ⚠ Nota honesta sobre RF-AUTH-005: el criterio de aceptación dice
 * "inactivo por más de 60 minutos" — esta implementación expira el token
 * a los 60 minutos desde que se emitió, sin importar si hubo actividad
 * en el medio (no es lo mismo que "60 minutos SIN actividad", que
 * requeriría refrescar la expiración en cada request, típicamente con un
 * refresh token — la tabla `tokens_usuario` con propósito
 * 'refresh_session' ya existe en el esquema para eso, pero el flujo de
 * refresh aún no está implementado). Queda como mejora pendiente, no
 * como algo ya resuelto.
 */
