/**
 * Interfaces (puertos) del dominio de autenticación — RF-AUTH.
 *
 * Nada en este archivo depende de NestJS, Drizzle, bcrypt ni JWT -- la
 * capa de infraestructura implementa estas interfaces con la tecnología
 * concreta elegida (ver infraestructura/auth/). node:crypto es la
 * única excepción real, y es intencional: es un primitivo del propio
 * lenguaje (no una librería de terceros intercambiable como bcrypt),
 * usado aquí para el algoritmo TOTP (RFC 6238, ítem 19), que no es una
 * elección de proveedor sino la definición misma del estándar.
 */
import { createHmac, randomBytes as randomBytesNode } from 'node:crypto';

/** Forma mínima de un usuario que el dominio necesita conocer. */
export interface UsuarioDominio {
  id: string;
  rol: 'pasajero' | 'vendedor' | 'admin_cooperativa' | 'admin_plataforma' | 'super_admin';
  cooperativaId: string | null;
  correo: string;
  nombreCompleto: string;
  cedula: string | null;
  telefono: string | null;
  fotoUrl: string | null;
  codigoPasajero: string | null;
  ultimoCambioIdentidadEn: Date | null;
  creadoEn: Date;
  passwordHash: string | null;
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
  correoVerificado: boolean;
  activo: boolean;
  totpHabilitado: boolean;
}

export interface DatosRegistro {
  correo: string;
  password: string;
  nombreCompleto: string;
  cedula?: string;
  telefono?: string;
}

/**
 * Puerto hacia la capa de infraestructura para todo lo que necesita leer
 * o escribir usuarios. La capa de aplicación depende de esta interfaz,
 * nunca de Drizzle directamente (Arquitectura Técnica, sección 2).
 */
export interface UsuarioRepositorio {
  buscarPorCorreo(correo: string): Promise<UsuarioDominio | null>;
  buscarPorId(id: string): Promise<UsuarioDominio | null>;
  crearPasajero(datos: DatosRegistro): Promise<UsuarioDominio>;
  registrarIntentoFallido(
    usuarioId: string,
    intentos: number,
    bloqueadoHasta: Date | null,
  ): Promise<void>;
  reiniciarIntentosFallidos(usuarioId: string): Promise<void>;

  /** Perfil (22-jul-2026) — nombre, teléfono, foto; solo se tocan los campos enviados. */
  actualizarPerfil(
    usuarioId: string,
    datos: {
      nombreCompleto?: string;
      telefono?: string;
      fotoUrl?: string | null;
    },
  ): Promise<void>;

  /**
   * Ítem 6, Fase 2 (03-ago-2026) -- nombre completo y cédula, SEPARADO
   * de actualizarPerfil a propósito: estos 2 campos llevan el límite de
   * frecuencia de 90 días (sección 3.1.1), los demás no. Actualiza
   * ultimoCambioIdentidadEn = ahora en la misma operación -- el service
   * ya validó el límite antes de llamar esto, el repositorio no vuelve
   * a validar.
   */
  actualizarIdentidad(
    usuarioId: string,
    datos: { nombreCompleto?: string; cedula?: string },
    ahora: Date,
  ): Promise<void>;

  /**
   * Genera el código de pasajero (`COL-XXXXXX`) la primera vez que se
   * necesita (lazy, no en el registro) -- así los usuarios que ya
   * existían antes de este cambio también terminan con uno. Idempotente:
   * si ya existe, lo devuelve tal cual sin generar uno nuevo.
   */
  asegurarCodigoPasajero(usuarioId: string): Promise<string>;

  actualizarPasswordHash(usuarioId: string, nuevoHash: string): Promise<void>;

  /** Solo tiene sentido para 'pasajero' — cuenta boletos con estado 'usado'. */
  contarViajesCompletados(usuarioId: string): Promise<number>;

  guardarTokenReset(
    usuarioId: string,
    tokenHash: string,
    expiraEn: Date,
  ): Promise<void>;

  /** Atómico: busca y consume en una sola operación (mismo fix que refresh_session, 28-jul-2026). */
  consumirTokenResetVigente(
    tokenHash: string,
  ): Promise<{ id: string; usuarioId: string } | null>;

  /** 27-jul-2026 -- verificacion de correo al registrarse (RF-AUTH-001). Mismo mecanismo que reset_password, proposito distinto. */
  guardarTokenVerificacion(
    usuarioId: string,
    tokenHash: string,
    expiraEn: Date,
  ): Promise<void>;

  /** Atómico: busca y consume en una sola operación (mismo fix que refresh_session, 28-jul-2026). */
  consumirTokenVerificacionVigente(
    tokenHash: string,
  ): Promise<{ id: string; usuarioId: string } | null>;

  marcarCorreoVerificado(usuarioId: string): Promise<void>;

  /**
   * Cambio de correo (29-jul-2026, hallazgo real del usuario): si
   * pierde acceso a su correo, sin esto queda fuera de su cuenta para
   * siempre, sin ningún camino de autoservicio. Mismo mecanismo de
   * token de un solo uso que el resto, con el correo nuevo guardado
   * hasta que se confirme. Reutiliza buscarPorCorreo (ya existe) para
   * comprobar que el correo nuevo no esté tomado.
   */
  guardarTokenCambioCorreo(
    usuarioId: string,
    correoNuevo: string,
    tokenHash: string,
    expiraEn: Date,
  ): Promise<void>;

  /** Atómico: mismo patrón que los demás tokens (fix de condición de carrera, 28-jul-2026). */
  consumirTokenCambioCorreoVigente(
    tokenHash: string,
  ): Promise<{ id: string; usuarioId: string; correoNuevo: string } | null>;

  actualizarCorreo(usuarioId: string, correoNuevo: string): Promise<void>;

  /** 27-jul-2026 -- refresh tokens (RF-AUTH-005). Un solo uso: cada refresh emite un token nuevo y el viejo queda invalido. */
  guardarTokenRefresh(
    usuarioId: string,
    tokenHash: string,
    expiraEn: Date,
  ): Promise<void>;

  /**
   * Busca un refresh token vigente Y lo marca como usado en una sola
   * operación atómica (UPDATE ... WHERE usado_en IS NULL ... RETURNING).
   * Corrige un hallazgo real de auditoría (28-jul-2026): con "buscar" y
   * "marcar usado" como dos pasos separados, dos peticiones concurrentes
   * con el mismo token podían pasar ambas la validación antes de que
   * cualquiera lo marcara como usado — confirmado con una prueba de
   * concurrencia real, no solo revisión de código. Una sola sentencia
   * UPDATE con condición WHERE es atómica a nivel de fila en Postgres:
   * solo una de las peticiones concurrentes puede "ganar" la fila.
   */
  consumirTokenRefreshVigente(
    tokenHash: string,
  ): Promise<{ id: string; usuarioId: string } | null>;

  /**
   * Ítem 17, Fase 3 (05-ago-2026) -- LOPDP, derecho de eliminación.
   * Anonimiza, no borra la fila -- decisión del director confirmada:
   * los datos del pasajero dentro de cada boleto ya vendido
   * (pasajeros_compra.nombre_completo/.documento) NO se tocan, porque
   * son el registro contable de una venta real de la cooperativa, no
   * un dato que pertenezca solo a la cuenta que se elimina. compras
   * cuyo comprador era esta cuenta pasan a comprador_usuario_id = null
   * (ya nullable hoy, para ventas de ventanilla). Todos los tokens de
   * la cuenta se eliminan de verdad -- ninguna razón legítima para
   * conservarlos tras eliminar la cuenta.
   */
  eliminarCuenta(usuarioId: string, correoAnonimo: string): Promise<void>;

  /**
   * Ítem 17, Fase 3 (05-ago-2026) -- LOPDP, principio de conservación
   * ("solo el tiempo necesario para la finalidad"). Hallazgo real: los
   * tokens de un solo uso nunca se eliminaban tras expirar/usarse,
   * acumulándose para siempre sin ninguna razón legítima. Devuelve
   * cuántos se borraron, para que el cron pueda registrarlo.
   */
  eliminarTokensAntiguos(antesDe: Date): Promise<number>;

  /**
   * Ítem 19, Fase 3 (05-ago-2026) -- 2FA obligatorio para las 3 cuentas
   * administrativas. Mismo mecanismo de token de un solo uso que el
   * resto (reset_password, verificar_correo, etc.), proposito nuevo
   * 'login_2fa' -- el paso intermedio entre "contraseña correcta" y
   * "sesión completa" mientras se resuelve el segundo factor.
   */
  guardarTokenLogin2fa(usuarioId: string, tokenHash: string, expiraEn: Date): Promise<void>;

  /** Atómico, mismo patrón que los demás tokens -- NO se consume aquí (se puede usar varias veces dentro de su ventana: setup, verificar código, reintento). */
  buscarTokenLogin2faVigente(
    tokenHash: string,
  ): Promise<{ usuarioId: string } | null>;

  /**
   * Guarda el secreto TOTP cifrado, SIN activar 2FA todavía -- paso de
   * "configuración pendiente", antes de que el admin confirme con un
   * código real que sí escaneó el QR correctamente.
   */
  guardarSecretoTotpPendiente(usuarioId: string, secretoCifrado: string): Promise<void>;

  obtenerSecretoTotpCifrado(usuarioId: string): Promise<string | null>;

  /**
   * Activa 2FA de verdad (totpHabilitado = true) y guarda los 10
   * códigos de recuperación (ya hasheados) en la misma operación --
   * mismo criterio de "todo o nada" que eliminarCuenta.
   */
  activarTotp(usuarioId: string, codigosRecuperacionHash: string[]): Promise<void>;

  /**
   * Busca un código de recuperación vigente (sin usar) y lo marca como
   * usado en una sola operación atómica -- mismo patrón de condición de
   * carrera ya corregido en el resto de tokens de un solo uso.
   */
  consumirCodigoRecuperacion(
    usuarioId: string,
    codigoHash: string,
  ): Promise<boolean>;
}

export interface NotificadorEmail {
  enviarResetPassword(correo: string, tokenPlano: string): Promise<void>;

  enviarConfirmacionCompra(
    correo: string,
    detalle: { compraId: string; montoTotal: number; cantidadBoletos: number },
  ): Promise<void>;

  enviarVerificacionCorreo(correo: string, tokenPlano: string): Promise<void>;
}

/**
 * 03-ago-2026 -- Notificaciones automáticas (RF-NOTIF-002/003), ítem 5
 * de la hoja de ruta Fase 2. WhatsApp como canal principal (98% de
 * apertura vs 20% en correo, decisión del director con datos reales,
 * sección 3.12 del documento maestro) -- correo queda como respaldo,
 * sin construir todavía (mismo criterio: "simulador ahora, proveedor
 * real después" ya usado en NotificadorEmail).
 */
export interface NotificadorWhatsApp {
  enviarRecordatorioViaje(
    telefono: string,
    detalle: {
      viajeId: string;
      origenCiudad: string;
      destinoCiudad: string;
      fechaSalida: string;
      horaSalidaProgramada: string;
    },
  ): Promise<void>;

  /**
   * Alcance real (03-ago-2026): editarViaje bloquea por completo cambiar
   * hora/precio si el viaje ya tiene boletos vendidos -- solo
   * cambiarUnidadViaje permite una modificación operativa post-venta hoy.
   * Por eso este aviso solo se dispara desde ahí; "cambio de hora" no
   * tiene ningún camino operativo real todavía en el sistema.
   */
  enviarAvisoCambioOperativo(
    telefono: string,
    detalle: { viajeId: string; motivo: string },
  ): Promise<void>;

  /** Fase 8, item 32 (11-ago-2026) -- aviso al llegar a destino. */
  enviarAvisoLlegada(
    telefono: string,
    detalle: { viajeId: string; destinoCiudad: string },
  ): Promise<void>;

  /** Fase 8, item 33 (11-ago-2026) -- solicitud de calificación post-viaje. */
  enviarSolicitudCalificacion(
    telefono: string,
    detalle: { viajeId: string; destinoCiudad: string },
  ): Promise<void>;
}

/**
 * 27-jul-2026 -- almacenamiento de archivos (fotos de perfil, logo de
 * cooperativa). Mismo criterio que NotificadorEmail/PasarelaPago: el
 * simulador guarda el archivo real en disco local; al final se
 * reemplaza por Cloudinary/S3 sin tocar nada mas del sistema.
 */
export interface ArchivoSubido {
  url: string;
  nombreArchivo: string;
}

export interface AlmacenamientoArchivos {
  guardarImagen(
    buffer: Buffer,
    nombreOriginal: string,
    carpeta: string,
  ): Promise<ArchivoSubido>;
}

/** Puerto de hashing de contraseñas — la capa de infra decide el algoritmo. */
export interface HasherContrasena {
  hash(passwordPlano: string): Promise<string>;
  comparar(passwordPlano: string, hash: string): Promise<boolean>;
}

/**
 * Ítem 19, Fase 3 (05-ago-2026) -- puerto de cifrado del secreto TOTP.
 * A diferencia de HasherContrasena (un solo sentido, nunca se lee de
 * vuelta), este SÍ necesita ser reversible -- verificar un código de
 * 6 dígitos exige el secreto real para calcular el código esperado.
 * La capa de infra decide el algoritmo (AES-256-GCM hoy).
 */
export interface CifradorTotp {
  cifrar(textoPlano: string): string;
  descifrar(textoCifrado: string): string;
}

/** Puerto de emisión/verificación de tokens de sesión. */
export interface EmisorTokens {
  firmar(payload: PayloadToken): string;
}

export interface PayloadToken {
  sub: string; // id de usuario
  rol: UsuarioDominio['rol'];
  cooperativaId: string | null;
}

/**
 * RF-AUTH-002 — regla de negocio pura sobre bloqueo por intentos
 * fallidos.
 *
 * ⚠ Simplificación consciente respecto al criterio de aceptación exacto
 * del SRS ("tras 5 intentos fallidos EN 10 MINUTOS"): esta implementación
 * bloquea tras 5 intentos fallidos acumulados (sin ventana deslizante de
 * tiempo), porque la tabla `usuarios` no tiene una columna de "último
 * intento fallido" para saber si esos 5 intentos ocurrieron dentro de una
 * ventana de 10 minutos o distribuidos a lo largo de semanas. Implementar
 * la semántica exacta de ventana deslizante requiere una migración de
 * esquema adicional (columna `ultimo_intento_fallido_en`), que no se hizo
 * en este paso — queda como mejora pendiente, no como algo ya resuelto.
 * El conteo se reinicia en cada login exitoso y también cuando el bloqueo
 * actual ya expiró (ver `cuentaEstaBloqueada`).
 *
 * MINUTOS_BLOQUEO (duración del bloqueo en sí) tampoco está especificado
 * por el SRS — es un valor por defecto razonable, no un requisito.
 */
export const MAX_INTENTOS_FALLIDOS = 5;
export const MINUTOS_BLOQUEO = 15;

export function calcularBloqueoTrasIntentoFallido(intentosActuales: number): {
  nuevoConteo: number;
  bloqueadoHasta: Date | null;
} {
  const nuevoConteo = intentosActuales + 1;
  if (nuevoConteo >= MAX_INTENTOS_FALLIDOS) {
    const bloqueadoHasta = new Date(Date.now() + MINUTOS_BLOQUEO * 60 * 1000);
    return { nuevoConteo, bloqueadoHasta };
  }
  return { nuevoConteo, bloqueadoHasta: null };
}

export function cuentaEstaBloqueada(bloqueadoHasta: Date | null): boolean {
  if (!bloqueadoHasta) return false;
  return bloqueadoHasta.getTime() > Date.now();
}

/**
 * Ítem 6, Fase 2 (03-ago-2026) — regla de negocio pura sobre el límite
 * de frecuencia para editar nombre completo/cédula (sección 3.1.1).
 * Protege boletos ya comprados a un nombre y reduce fraude de
 * identidad; foto, WhatsApp y contraseña quedan fuera de esta regla.
 */
export const DIAS_LIMITE_CAMBIO_IDENTIDAD = 90;

export function puedeEditarIdentidad(
  ultimoCambioIdentidadEn: Date | null,
): { permitido: true } | { permitido: false; diasRestantes: number } {
  if (!ultimoCambioIdentidadEn) return { permitido: true };
  const diasTranscurridos =
    (Date.now() - ultimoCambioIdentidadEn.getTime()) / (1000 * 60 * 60 * 24);
  if (diasTranscurridos >= DIAS_LIMITE_CAMBIO_IDENTIDAD) return { permitido: true };
  return {
    permitido: false,
    diasRestantes: Math.ceil(DIAS_LIMITE_CAMBIO_IDENTIDAD - diasTranscurridos),
  };
}

/**
 * Ítem 19, Fase 3 (05-ago-2026) -- TOTP (RFC 6238) implementado directo
 * con node:crypto, SIN depender de otplib. Decisión tomada después de
 * 2 fricciones reales con esa librería en la misma sesión: primero su
 * v13 rompió la API que se había asumido sin verificar, y después se
 * descubrió que depende de paquetes ESM puros (@scure/base) que Jest
 * no puede procesar sin configuración adicional -- rompía las 14
 * suites de pruebas al arrancar. TOTP es un algoritmo bien definido
 * (no una elección de proveedor intercambiable como el hashing de
 * contraseñas), así que implementarlo directo es más simple y
 * confiable que arrastrar una dependencia externa con este historial
 * de fricción, sin perder nada real -- mismo criterio de "aburrido es
 * bueno" que ya se usa en el resto del proyecto (simulador → proveedor
 * real después, nunca magia innecesaria).
 */

const BASE32_ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(base32: string): Buffer {
  const limpio = base32.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const caracter of limpio) {
    const valor = BASE32_ALFABETO.indexOf(caracter);
    if (valor === -1) throw new Error('Carácter base32 inválido en el secreto TOTP.');
    bits += valor.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function base32Encode(buffer: Buffer): string {
  let bits = '';
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let resultado = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    resultado += BASE32_ALFABETO[parseInt(bits.slice(i, i + 5), 2)];
  }
  return resultado;
}

/** 20 bytes (160 bits) -- múltiplo exacto de 5 bits, produce 32 caracteres base32 sin relleno. Longitud recomendada estándar para TOTP. */
export function generarSecretoTotp(): string {
  return base32Encode(randomBytesNode(20));
}

function hotp(secretBytes: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secretBytes).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binario =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binario % 1_000_000).toString().padStart(6, '0');
}

export function generarCodigoTotp(
  secretoBase32: string,
  epochSegundos: number = Math.floor(Date.now() / 1000),
): string {
  const counter = Math.floor(epochSegundos / 30);
  return hotp(base32Decode(secretoBase32), counter);
}

/** Tolerancia de ±1 paso (30s) para el desfase de reloj típico de un teléfono -- práctica estándar de la industria, misma que usaba otplib por defecto. */
export function verificarCodigoTotp(
  secretoBase32: string,
  codigo: string,
  epochSegundos: number = Math.floor(Date.now() / 1000),
): boolean {
  const counterActual = Math.floor(epochSegundos / 30);
  const secretBytes = base32Decode(secretoBase32);
  for (const delta of [-1, 0, 1]) {
    if (hotp(secretBytes, counterActual + delta) === codigo) return true;
  }
  return false;
}

export function generarUriTotp(opciones: { issuer: string; label: string; secreto: string }): string {
  const { issuer, label, secreto } = opciones;
  const params = new URLSearchParams({
    secret: secreto,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params.toString()}`;
}
