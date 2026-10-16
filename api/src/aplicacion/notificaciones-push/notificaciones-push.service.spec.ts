/* eslint-disable @typescript-eslint/require-await -- dobles de prueba en memoria que cumplen interfaces asíncronas */
import { BadRequestException } from '@nestjs/common';
import { NotificacionesPushService } from './notificaciones-push.service';
import type {
  DispositivosPushRepositorio,
  EnviadorPush,
  MensajePush,
} from '../../dominio/notificaciones-push/notificaciones-push.ports';

const TOKEN = 'ExponentPushToken[abcdefghijklmnopqrstuv]';
const MENSAJE: MensajePush = {
  titulo: 'Hola',
  cuerpo: 'Mundo',
  datos: { tipo: 'prueba' },
};

class RepoEnMemoria implements DispositivosPushRepositorio {
  dispositivos: { usuarioId: string; token: string; activo: boolean }[] = [];
  compras = new Map<string, string | null>();
  pagos = new Map<string, string | null>();

  async registrar(usuarioId: string, token: string) {
    const existente = this.dispositivos.find((d) => d.token === token);
    if (existente) Object.assign(existente, { usuarioId, activo: true });
    else this.dispositivos.push({ usuarioId, token, activo: true });
  }
  async eliminar(usuarioId: string, token: string) {
    this.dispositivos = this.dispositivos.filter(
      (d) => !(d.usuarioId === usuarioId && d.token === token),
    );
  }
  async listarTokensActivos(usuarioId: string) {
    return this.dispositivos
      .filter((d) => d.usuarioId === usuarioId && d.activo)
      .map((d) => d.token);
  }
  async desactivar(tokens: string[]) {
    this.dispositivos.forEach((d) => {
      if (tokens.includes(d.token)) d.activo = false;
    });
  }
  async obtenerUsuarioDeCompra(compraId: string) {
    return this.compras.get(compraId) ?? null;
  }
  async obtenerUsuarioDePago(pagoId: string) {
    return this.pagos.get(pagoId) ?? null;
  }
}

class EnviadorFalso implements EnviadorPush {
  enviados: { tokens: string[]; mensaje: MensajePush }[] = [];
  invalidos: string[] = [];
  falla = false;
  async enviar(tokens: string[], mensaje: MensajePush) {
    if (this.falla) throw new Error('Expo caído');
    this.enviados.push({ tokens, mensaje });
    return {
      tokensInvalidos: tokens.filter((t) => this.invalidos.includes(t)),
    };
  }
}

describe('NotificacionesPushService', () => {
  let repo: RepoEnMemoria;
  let enviador: EnviadorFalso;
  let servicio: NotificacionesPushService;

  beforeEach(() => {
    delete process.env.PUSH_DESHABILITADO;
    repo = new RepoEnMemoria();
    enviador = new EnviadorFalso();
    servicio = new NotificacionesPushService(repo, enviador);
  });

  it('rechaza un token que no es de Expo', async () => {
    await expect(
      servicio.registrarDispositivo(
        'u1',
        'cualquier-cosa-larga-12345',
        'android',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(repo.dispositivos).toHaveLength(0);
  });

  it('registra el dispositivo y, si otra cuenta inicia sesión en el mismo teléfono, el token pasa a ella', async () => {
    await servicio.registrarDispositivo('u1', TOKEN, 'android');
    await servicio.registrarDispositivo('u2', TOKEN, 'android');
    expect(repo.dispositivos).toEqual([
      { usuarioId: 'u2', token: TOKEN, activo: true },
    ]);
  });

  it('avisa a todos los teléfonos activos del usuario', async () => {
    const otro = 'ExponentPushToken[zzzzzzzzzzzzzzzzzzzzzz]';
    await servicio.registrarDispositivo('u1', TOKEN, 'android');
    await servicio.registrarDispositivo('u1', otro, 'ios');
    await servicio.enviarAUsuario('u1', MENSAJE);
    expect(enviador.enviados).toHaveLength(1);
    expect(enviador.enviados[0].tokens).toEqual([TOKEN, otro]);
  });

  it('no envía nada si el usuario no tiene dispositivos o no hay usuario', async () => {
    await servicio.enviarAUsuario('sin-telefonos', MENSAJE);
    await servicio.enviarAUsuario(null, MENSAJE);
    expect(enviador.enviados).toHaveLength(0);
  });

  it('desactiva los tokens que el proveedor reporta como inválidos', async () => {
    await servicio.registrarDispositivo('u1', TOKEN, 'android');
    enviador.invalidos = [TOKEN];
    await servicio.enviarAUsuario('u1', MENSAJE);
    expect(repo.dispositivos[0].activo).toBe(false);
    await servicio.enviarAUsuario('u1', MENSAJE);
    expect(enviador.enviados).toHaveLength(1); // el segundo aviso ya no salió
  });

  it('nunca lanza aunque el proveedor falle', async () => {
    await servicio.registrarDispositivo('u1', TOKEN, 'android');
    enviador.falla = true;
    await expect(
      servicio.enviarAUsuario('u1', MENSAJE),
    ).resolves.toBeUndefined();
  });

  it('avisa al comprador de una compra o de un pago, y nada si fue venta sin cuenta', async () => {
    await servicio.registrarDispositivo('u1', TOKEN, 'android');
    repo.compras.set('c1', 'u1');
    repo.compras.set('c-invitado', null);
    repo.pagos.set('p1', 'u1');
    await servicio.enviarACompra('c1', MENSAJE);
    await servicio.enviarACompra('c-invitado', MENSAJE);
    await servicio.enviarAPago('p1', MENSAJE);
    expect(enviador.enviados).toHaveLength(2);
  });

  it('PUSH_DESHABILITADO=1 apaga los envíos', async () => {
    await servicio.registrarDispositivo('u1', TOKEN, 'android');
    process.env.PUSH_DESHABILITADO = '1';
    await servicio.enviarAUsuario('u1', MENSAJE);
    expect(enviador.enviados).toHaveLength(0);
  });
});
