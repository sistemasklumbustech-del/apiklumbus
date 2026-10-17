/* eslint-disable @typescript-eslint/require-await -- dobles de prueba en memoria */
import {
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  TokenSocialInvalidoError,
  type IdentidadExterna,
  type UsuarioDominio,
} from '../../dominio/auth/auth.ports';

function usuario(extra: Partial<UsuarioDominio> = {}): UsuarioDominio {
  return {
    id: 'u-1',
    rol: 'pasajero',
    cooperativaId: null,
    correo: 'ana@gmail.com',
    nombreCompleto: 'Ana Pérez',
    cedula: null,
    telefono: null,
    fotoUrl: null,
    codigoPasajero: null,
    ultimoCambioIdentidadEn: null,
    creadoEn: new Date(),
    passwordHash: 'hash',
    intentosFallidos: 0,
    bloqueadoHasta: null,
    correoVerificado: true,
    activo: true,
    totpHabilitado: false,
    ...extra,
  };
}

const IDENTIDAD: IdentidadExterna = {
  proveedorId: 'sub-1',
  correo: 'ana@gmail.com',
  correoVerificado: true,
  nombre: 'Ana Pérez',
  fotoUrl: null,
};

function armar(opciones: {
  porProveedor?: UsuarioDominio | null;
  porCorreo?: UsuarioDominio | null;
  identidad?: IdentidadExterna;
}) {
  const usuarios = {
    buscarPorProveedorExterno: jest.fn(
      async () => opciones.porProveedor ?? null,
    ),
    buscarPorCorreo: jest.fn(async () => opciones.porCorreo ?? null),
    buscarPorId: jest.fn(async () => opciones.porCorreo ?? null),
    vincularProveedorExterno: jest.fn(async () => undefined),
    crearPasajeroExterno: jest.fn(
      async (d: { correo: string; nombreCompleto: string }) =>
        usuario({
          id: 'nuevo',
          correo: d.correo,
          nombreCompleto: d.nombreCompleto,
          passwordHash: null,
        }),
    ),
    asegurarCodigoPasajero: jest.fn(async () => 'COL-ABC123'),
    guardarTokenRefresh: jest.fn(async () => undefined),
  };
  const verificador = {
    verificar: jest.fn(async () => opciones.identidad ?? IDENTIDAD),
  };
  const terminos = {
    validarAceptada: jest.fn((acepto: boolean) => {
      if (!acepto)
        throw new BadRequestException(
          'Debes aceptar los Términos y Condiciones.',
        );
    }),
    registrarAceptacion: jest.fn(async () => undefined),
  };
  const referidos = { registrarReferido: jest.fn(async () => undefined) };
  const auditoria = { registrar: jest.fn(async () => undefined) };
  const tokens = { firmar: jest.fn(() => 'jwt-firmado') };
  const servicio = new AuthService(
    usuarios as never,
    {} as never,
    tokens,
    {} as never,
    {} as never,
    {} as never,
    verificador,
    referidos as never,
    terminos as never,
    auditoria as never,
  );
  return { servicio, usuarios, verificador, terminos, referidos, auditoria };
}

const DATOS = {
  proveedor: 'google' as const,
  idToken: 'x'.repeat(30),
  aceptoTerminos: true,
};

describe('AuthService.loginSocial', () => {
  it('cuenta que ya entró con ese proveedor: inicia sesión sin crear ni vincular nada', async () => {
    const t = armar({ porProveedor: usuario() });
    const r = await t.servicio.loginSocial(DATOS);
    expect(r).toMatchObject({ accessToken: 'jwt-firmado', cuentaNueva: false });
    expect(t.usuarios.crearPasajeroExterno).not.toHaveBeenCalled();
    expect(t.usuarios.vincularProveedorExterno).not.toHaveBeenCalled();
  });

  it('mismo correo con cuenta verificada: la vincula sin tocar la contraseña', async () => {
    const t = armar({ porCorreo: usuario({ correoVerificado: true }) });
    const r = await t.servicio.loginSocial(DATOS);
    expect(r.cuentaNueva).toBe(false);
    expect(t.usuarios.vincularProveedorExterno).toHaveBeenCalledWith(
      'u-1',
      'google',
      'sub-1',
      false,
    );
  });

  it('mismo correo con cuenta SIN verificar: la vincula y le borra la contraseña (secuestro previo)', async () => {
    const t = armar({ porCorreo: usuario({ correoVerificado: false }) });
    await t.servicio.loginSocial(DATOS);
    expect(t.usuarios.vincularProveedorExterno).toHaveBeenCalledWith(
      'u-1',
      'google',
      'sub-1',
      true,
    );
  });

  it('crea una cuenta nueva con los Términos aceptados, sin contraseña, y registra el referido', async () => {
    const t = armar({});
    const r = await t.servicio.loginSocial({
      ...DATOS,
      codigoReferido: 'COL-XYZ789',
    });
    expect(r.cuentaNueva).toBe(true);
    expect(t.usuarios.crearPasajeroExterno).toHaveBeenCalledWith(
      expect.objectContaining({
        correo: 'ana@gmail.com',
        proveedor: 'google',
        proveedorId: 'sub-1',
      }),
    );
    expect(t.terminos.registrarAceptacion).toHaveBeenCalled();
    expect(t.referidos.registrarReferido).toHaveBeenCalledWith(
      expect.objectContaining({
        codigoReferido: 'COL-XYZ789',
        usuarioReferidoId: 'nuevo',
      }),
    );
  });

  it('cuenta nueva sin aceptar los Términos: no se crea', async () => {
    const t = armar({});
    await expect(
      t.servicio.loginSocial({ ...DATOS, aceptoTerminos: false }),
    ).rejects.toThrow(BadRequestException);
    expect(t.usuarios.crearPasajeroExterno).not.toHaveBeenCalled();
  });

  it('el nombre que manda la app (Apple) tiene prioridad sobre el del token', async () => {
    const t = armar({ identidad: { ...IDENTIDAD, nombre: null } });
    await t.servicio.loginSocial({ ...DATOS, nombre: 'María López' });
    expect(t.usuarios.crearPasajeroExterno).toHaveBeenCalledWith(
      expect.objectContaining({ nombreCompleto: 'María López' }),
    );
  });

  it('proveedor que no confirma el correo: no crea cuenta ni vincula por correo', async () => {
    const t = armar({
      identidad: { ...IDENTIDAD, correoVerificado: false },
      porCorreo: usuario(),
    });
    await expect(t.servicio.loginSocial(DATOS)).rejects.toThrow(
      BadRequestException,
    );
    expect(t.usuarios.vincularProveedorExterno).not.toHaveBeenCalled();
    expect(t.usuarios.crearPasajeroExterno).not.toHaveBeenCalled();
  });

  it('el personal (vendedor, administradores) no entra por aquí', async () => {
    const t = armar({ porCorreo: usuario({ rol: 'admin_cooperativa' }) });
    await expect(t.servicio.loginSocial(DATOS)).rejects.toThrow(
      ForbiddenException,
    );
    expect(t.usuarios.vincularProveedorExterno).not.toHaveBeenCalled();
  });

  it('cuenta desactivada: no entra', async () => {
    const t = armar({ porProveedor: usuario({ activo: false }) });
    await expect(t.servicio.loginSocial(DATOS)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('token inválido: 401 y queda auditado; proveedor sin configurar: 503', async () => {
    const t = armar({});
    t.verificador.verificar.mockRejectedValueOnce(
      new TokenSocialInvalidoError('El token venció.'),
    );
    await expect(t.servicio.loginSocial(DATOS)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(t.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ resultado: 'fallo' }),
    );
    t.verificador.verificar.mockRejectedValueOnce(
      new TokenSocialInvalidoError('No disponible.', true),
    );
    await expect(t.servicio.loginSocial(DATOS)).rejects.toMatchObject({
      status: 503,
    });
  });
});
