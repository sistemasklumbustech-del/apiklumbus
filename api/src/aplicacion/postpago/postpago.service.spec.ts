import { PostpagoService } from './postpago.service';
import {
  ErrorProveedorSinEfecto,
  type ModoOperacion,
  type ContextoVentaCooperativa,
  type TareaPostpago,
  type TareasPostpagoRepositorio,
} from '../../dominio/postpago/postpago.ports';
import type {
  DatosParaFacturar,
  ProveedorFacturacionElectronica,
  ResultadoFacturacion,
} from '../../dominio/facturacion/facturacion.ports';
import type {
  DatosVentaParaTasa,
  ProveedorIntegracionTerminal,
  ResultadoRegistroTasa,
} from '../../dominio/integraciones-terminal/integracion-terminal.ports';
import type { AuditoriaRegistrador } from '../../infraestructura/auditoria/auditoria.registrador';

const COMPRA = 'compra-1';
const COOP = 'coop-1';

/** Repositorio en memoria con las mismas reglas que el real (reclamar, reintentar, avanzar la compra). */
class RepoEnMemoria implements TareasPostpagoRepositorio {
  tareas: TareaPostpago[] = [];
  estadoCompra = 'boleto_confirmado';
  transiciones: string[] = [];
  tasaGuardada: { exitoso: boolean; codigoTasa?: string }[] = [];
  comprobantesCoop = 0;
  comprobantesPlataforma = 0;
  cargo = 0.5;
  private secuencia = 0;

  programar(compraId: string, nuevas: { tipo: TareaPostpago['tipo']; cooperativaId: string | null }[]) {
    for (const n of nuevas) {
      if (this.tareas.some((t) => t.compraId === compraId && t.tipo === n.tipo && t.cooperativaId === n.cooperativaId)) continue;
      this.tareas.push({
        id: `t${++this.secuencia}`,
        compraId,
        cooperativaId: n.cooperativaId,
        tipo: n.tipo,
        estado: 'pendiente',
        intentos: 0,
        maxIntentos: 6,
        proximoIntentoEn: new Date(0).toISOString(),
        ultimoError: null,
        resultado: null,
        creadoEn: new Date().toISOString(),
        completadoEn: null,
      });
    }
    return Promise.resolve();
  }
  reclamarListas(limite: number, compraId?: string) {
    const ahora = Date.now();
    const listas = this.tareas
      .filter((t) => t.estado === 'pendiente' && new Date(t.proximoIntentoEn).getTime() <= ahora)
      .filter((t) => !compraId || t.compraId === compraId)
      .slice(0, limite);
    listas.forEach((t) => (t.estado = 'en_proceso'));
    return Promise.resolve(listas.map((t) => ({ ...t })));
  }
  tareasDeCompra(compraId: string) {
    return Promise.resolve(this.tareas.filter((t) => t.compraId === compraId).map((t) => ({ ...t })));
  }
  private en(id: string) {
    return this.tareas.find((t) => t.id === id)!;
  }
  marcarExitosa(id: string, resultado: Record<string, unknown>) {
    Object.assign(this.en(id), { estado: 'exitosa', resultado, intentos: this.en(id).intentos + 1 });
    return Promise.resolve();
  }
  marcarReintento(id: string, error: string, cuando: Date) {
    Object.assign(this.en(id), { estado: 'pendiente', ultimoError: error, proximoIntentoEn: cuando.toISOString(), intentos: this.en(id).intentos + 1 });
    return Promise.resolve();
  }
  marcarAgotada(id: string, error: string) {
    Object.assign(this.en(id), { estado: 'agotada', ultimoError: error, intentos: this.en(id).intentos + 1 });
    return Promise.resolve();
  }
  posponer(id: string, cuando: Date, motivo: string) {
    Object.assign(this.en(id), { estado: 'pendiente', ultimoError: motivo, proximoIntentoEn: cuando.toISOString() });
    return Promise.resolve();
  }
  reiniciar(id: string) {
    const t = this.en(id);
    if (t.estado !== 'agotada') return Promise.resolve(false);
    Object.assign(t, { estado: 'pendiente', intentos: 0, ultimoError: null, proximoIntentoEn: new Date(0).toISOString() });
    return Promise.resolve(true);
  }
  listar() {
    return Promise.resolve({ filas: this.tareas, total: this.tareas.length });
  }
  obtener(id: string) {
    return Promise.resolve(this.tareas.find((t) => t.id === id) ?? null);
  }
  modo: ModoOperacion = 'plataforma_completa';
  tieneApi = false;
  cooperativasYCargoDeCompra() {
    return Promise.resolve({
      cooperativas: [{ id: COOP, modo: this.modo, tieneIntegracionApi: this.tieneApi }],
      cargoPlataforma: this.cargo,
    });
  }
  contextoVenta(): Promise<ContextoVentaCooperativa> {
    return Promise.resolve({
      cooperativaId: COOP,
      cooperativaRuc: '0791845968001',
      cooperativaNombre: 'Coop de prueba',
      cliente: { tipoIdentificacion: 'cedula', identificacion: '1710034065', razonSocial: 'Ana Prueba', correo: 'ana@prueba.ec', direccion: null },
      pasajeros: [
        { asientoEtiqueta: '1A', viajeId: 'v1', tipoTarifa: 'adulto', precioPagado: 8, tasaTerminal: 0.5 },
        { asientoEtiqueta: '1B', viajeId: 'v1', tipoTarifa: 'nino', precioPagado: 4, tasaTerminal: 0.25 },
      ],
    });
  }
  guardarResultadoTasa(_c: string, _k: string, datos: { exitoso: boolean; codigoTasa?: string }) {
    this.tasaGuardada.push({ exitoso: datos.exitoso, codigoTasa: datos.codigoTasa });
    return Promise.resolve();
  }
  transicionarCompra(_c: string, estado: 'tasa_confirmada' | 'completada') {
    const desde = estado === 'tasa_confirmada' ? ['boleto_confirmado'] : ['boleto_confirmado', 'tasa_confirmada'];
    if (!desde.includes(this.estadoCompra)) return Promise.resolve(false);
    this.estadoCompra = estado;
    this.transiciones.push(estado);
    return Promise.resolve(true);
  }
  rucPlataforma() {
    return Promise.resolve('0791845968001');
  }
  guardarComprobantePlataforma() {
    this.comprobantesPlataforma++;
    return Promise.resolve();
  }
  guardarComprobanteCooperativa() {
    this.comprobantesCoop++;
    return Promise.resolve();
  }
  /** Simula que pasó el tiempo de espera de los reintentos. */
  vencerEsperas() {
    this.tareas.filter((t) => t.estado === 'pendiente').forEach((t) => (t.proximoIntentoEn = new Date(0).toISOString()));
  }
  de(tipo: TareaPostpago['tipo']) {
    return this.tareas.find((t) => t.tipo === tipo)!;
  }
}

describe('PostpagoService', () => {
  let repo: RepoEnMemoria;
  let facturar: jest.Mock<Promise<ResultadoFacturacion>, [DatosParaFacturar]>;
  let registrar: jest.Mock<Promise<ResultadoRegistroTasa>, [DatosVentaParaTasa, string]>;
  let auditar: jest.Mock;
  let servicio: PostpagoService;

  beforeEach(() => {
    repo = new RepoEnMemoria();
    facturar = jest.fn().mockResolvedValue({ exitoso: true, claveAcceso: 'clave', numeroAutorizacion: 'aut', numeroFactura: '000000123' });
    registrar = jest.fn().mockResolvedValue({ exitoso: true, codigoTasa: '12345678901234567890', saldoRestante: 50 });
    auditar = jest.fn().mockResolvedValue(undefined);
    servicio = new PostpagoService(
      repo,
      { emitirComprobante: facturar } as ProveedorFacturacionElectronica,
      { registrarVentaYObtenerTasa: registrar } as unknown as ProveedorIntegracionTerminal,
      { registrar: auditar } as unknown as AuditoriaRegistrador,
    );
  });

  it('camino feliz: factura, tasa y factura de la plataforma, y la compra queda completada', async () => {
    await servicio.programarYProcesar(COMPRA);

    expect(repo.tareas.map((t) => t.estado)).toEqual(['exitosa', 'exitosa', 'exitosa']);
    expect(repo.estadoCompra).toBe('completada');
    expect(repo.transiciones).toEqual(['tasa_confirmada', 'completada']);
    expect(repo.comprobantesCoop).toBe(1);
    expect(repo.comprobantesPlataforma).toBe(1);
    expect(repo.tasaGuardada).toEqual([{ exitoso: true, codigoTasa: '12345678901234567890' }]);
  });

  it('la factura del pasaje cubre pasaje y tasa, y a la tasa le llega el número de esa factura', async () => {
    await servicio.programarYProcesar(COMPRA);

    expect(facturar.mock.calls[0][0]).toMatchObject({ montoTotal: 12.75, rucEmisor: '0791845968001', nombreCliente: 'Ana Prueba' });
    const venta = registrar.mock.calls[0][0];
    expect(venta.facturaNumero).toBe('000000123');
    expect(venta.tipoCliente).toBe('05');
    expect(venta.totalFacturado).toBe(12.75);
    expect(venta.pasajeros).toEqual([
      { asiento: 1, tipo: 'normal', valor: 8.5 },
      { asiento: 2, tipo: 'infante', valor: 4.25 },
    ]);
  });

  it('sin cargo de plataforma no se crea esa factura', async () => {
    repo.cargo = 0;
    await servicio.programarYProcesar(COMPRA);
    expect(repo.tareas.map((t) => t.tipo)).toEqual(['factura_pasaje', 'registro_tasa']);
  });

  it('si el terminal rechaza (saldo), reintenta más tarde y al lograrlo completa la compra', async () => {
    registrar.mockResolvedValueOnce({ exitoso: false, error: 'Saldo insuficiente' });

    await servicio.programarYProcesar(COMPRA);
    const tasa = repo.de('registro_tasa');
    expect(tasa.estado).toBe('pendiente');
    expect(tasa.intentos).toBe(1);
    expect(tasa.ultimoError).toBe('Saldo insuficiente');
    expect(new Date(tasa.proximoIntentoEn).getTime()).toBeGreaterThan(Date.now());
    expect(repo.estadoCompra).toBe('boleto_confirmado');

    repo.vencerEsperas();
    await servicio.procesarCompra(COMPRA);
    expect(repo.de('registro_tasa').estado).toBe('exitosa');
    expect(repo.estadoCompra).toBe('completada');
    expect(facturar).toHaveBeenCalledTimes(2); // pasaje + plataforma, sin repetir la factura del pasaje
  });

  it('tras agotar los intentos la tarea queda para revisión y se audita', async () => {
    registrar.mockResolvedValue({ exitoso: false, error: 'Saldo insuficiente' });

    await servicio.programarYProcesar(COMPRA);
    for (let i = 0; i < 5; i++) {
      repo.vencerEsperas();
      await servicio.procesarCompra(COMPRA);
    }

    const tasa = repo.de('registro_tasa');
    expect(tasa.estado).toBe('agotada');
    expect(tasa.intentos).toBe(6);
    expect(repo.estadoCompra).toBe('boleto_confirmado');
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'postpago_tarea_agotada', origen: 'sistema' }));
  });

  it('un error ambiguo del proveedor no se reintenta solo: pasa a revisión para no duplicar la factura', async () => {
    facturar.mockRejectedValueOnce(new Error('timeout leyendo la respuesta'));

    await servicio.programarYProcesar(COMPRA);

    const factura = repo.de('factura_pasaje');
    expect(factura.estado).toBe('agotada');
    expect(factura.ultimoError).toContain('ambigua');
    expect(registrar).not.toHaveBeenCalled();
    expect(repo.de('registro_tasa').estado).toBe('agotada');
  });

  it('un error que se sabe sin efecto sí se reintenta', async () => {
    facturar.mockRejectedValueOnce(new ErrorProveedorSinEfecto('no se pudo conectar'));

    await servicio.programarYProcesar(COMPRA);

    const factura = repo.de('factura_pasaje');
    expect(factura.estado).toBe('pendiente');
    expect(factura.intentos).toBe(1);
    expect(repo.de('registro_tasa').estado).toBe('pendiente');
    expect(registrar).not.toHaveBeenCalled();

    repo.vencerEsperas();
    await servicio.procesarCompra(COMPRA);
    expect(repo.estadoCompra).toBe('completada');
  });

  it('la tasa espera a la factura sin gastar intentos', async () => {
    facturar.mockResolvedValueOnce({ exitoso: false, error: 'SRI no disponible' });

    await servicio.programarYProcesar(COMPRA);

    const tasa = repo.de('registro_tasa');
    expect(tasa.estado).toBe('pendiente');
    expect(tasa.intentos).toBe(0);
    expect(tasa.ultimoError).toContain('Esperando la factura');
  });

  it('un administrador puede reintentar una tarea agotada y se vuelve a procesar la compra', async () => {
    registrar.mockResolvedValueOnce({ exitoso: false, error: 'x' });
    registrar.mockResolvedValueOnce({ exitoso: false, error: 'x' });
    registrar.mockResolvedValueOnce({ exitoso: false, error: 'x' });
    registrar.mockResolvedValueOnce({ exitoso: false, error: 'x' });
    registrar.mockResolvedValueOnce({ exitoso: false, error: 'x' });
    registrar.mockResolvedValueOnce({ exitoso: false, error: 'x' });
    await servicio.programarYProcesar(COMPRA);
    for (let i = 0; i < 5; i++) {
      repo.vencerEsperas();
      await servicio.procesarCompra(COMPRA);
    }
    const tasa = repo.de('registro_tasa');
    expect(tasa.estado).toBe('agotada');

    expect(await servicio.reintentar(tasa.id, 'admin-1')).toBe(true);

    expect(repo.de('registro_tasa').estado).toBe('exitosa');
    expect(repo.estadoCompra).toBe('completada');
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'postpago_tarea_reintentada', usuarioId: 'admin-1' }));
  });

  it('no se puede reintentar una tarea que no está agotada', async () => {
    await servicio.programarYProcesar(COMPRA);
    expect(await servicio.reintentar(repo.de('registro_tasa').id, 'admin-1')).toBe(false);
  });

  describe('cooperativa con su propio sistema (intermediario con cobro)', () => {
    const reporte = {
      numeroFactura: '000000456',
      claveAcceso: '1'.repeat(49),
      numeroAutorizacion: '1'.repeat(49),
      codigoTasa: '98765432109876543210',
    };

    beforeEach(() => {
      repo.modo = 'intermediario_con_cobro';
      repo.tieneApi = true;
    });

    it('Klumbus no factura ni registra la tasa: espera el reporte de la cooperativa y factura solo su cargo', async () => {
      await servicio.programarYProcesar(COMPRA);

      expect(repo.tareas.map((t) => t.tipo).sort()).toEqual(['confirmacion_cooperativa', 'factura_plataforma']);
      expect(facturar).toHaveBeenCalledTimes(1); // solo el cargo de Klumbus
      expect(registrar).not.toHaveBeenCalled();
      expect(repo.de('confirmacion_cooperativa').estado).toBe('pendiente');
      expect(repo.estadoCompra).toBe('boleto_confirmado');
    });

    it('al reportar la cooperativa su factura y tasa, la compra queda completada', async () => {
      await servicio.programarYProcesar(COMPRA);

      expect(await servicio.confirmarDesdeCooperativa(COMPRA, COOP, reporte)).toBe('ok');

      expect(repo.de('confirmacion_cooperativa').estado).toBe('exitosa');
      expect(repo.comprobantesCoop).toBe(1);
      expect(repo.tasaGuardada).toEqual([{ exitoso: true, codigoTasa: '98765432109876543210' }]);
      expect(repo.estadoCompra).toBe('completada');
    });

    it('reportar dos veces es inofensivo', async () => {
      await servicio.programarYProcesar(COMPRA);
      await servicio.confirmarDesdeCooperativa(COMPRA, COOP, reporte);
      expect(await servicio.confirmarDesdeCooperativa(COMPRA, COOP, reporte)).toBe('ok');
      expect(repo.comprobantesCoop).toBe(1);
    });

    it('otra cooperativa, o una compra sin esa tarea, no puede reportar', async () => {
      await servicio.programarYProcesar(COMPRA);
      expect(await servicio.confirmarDesdeCooperativa(COMPRA, 'otra-coop', reporte)).toBe('sin_tarea');
      expect(await servicio.confirmarDesdeCooperativa('otra-compra', COOP, reporte)).toBe('sin_tarea');
      expect(repo.estadoCompra).toBe('boleto_confirmado');
    });

    it('si la cooperativa no reporta a tiempo, queda para revisión, y un reporte tardío igual se acepta', async () => {
      await servicio.programarYProcesar(COMPRA);
      const tarea = repo.de('confirmacion_cooperativa');
      tarea.creadoEn = new Date(Date.now() - 31 * 60_000).toISOString();
      repo.vencerEsperas();

      await servicio.procesarCompra(COMPRA);
      expect(repo.de('confirmacion_cooperativa').estado).toBe('agotada');
      expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'postpago_tarea_agotada' }));

      expect(await servicio.confirmarDesdeCooperativa(COMPRA, COOP, reporte)).toBe('ok');
      expect(repo.de('confirmacion_cooperativa').estado).toBe('exitosa');
      expect(repo.estadoCompra).toBe('completada');
    });

    it('sin llave API, la cooperativa factura por su cuenta y no se le espera nada', async () => {
      repo.tieneApi = false;
      await servicio.programarYProcesar(COMPRA);
      expect(repo.tareas.map((t) => t.tipo)).toEqual(['factura_plataforma']);
    });
  });

  it('nunca lanza aunque falle la base de datos', async () => {
    repo.cooperativasYCargoDeCompra = () => Promise.reject(new Error('base caída'));
    await expect(servicio.programarYProcesar(COMPRA)).resolves.toBeUndefined();
  });
});
