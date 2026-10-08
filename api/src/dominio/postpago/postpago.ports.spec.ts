import {
  calcularProximoIntento,
  capacidadesDeModo,
  estadoCompraSegunTareas,
  tareasParaCompra,
  type CooperativaDeCompra,
} from './postpago.ports';

describe('calcularProximoIntento', () => {
  const ahora = new Date('2026-10-06T12:00:00Z');

  it.each([
    [1, 1],
    [2, 5],
    [3, 15],
    [4, 60],
    [5, 180],
    [6, 360],
  ])('después del intento %i espera %i minutos', (intento, minutos) => {
    expect(calcularProximoIntento(intento, ahora).getTime() - ahora.getTime()).toBe(minutos * 60_000);
  });

  it('no se sale de la tabla con intentos fuera de rango', () => {
    expect(calcularProximoIntento(0, ahora).getTime() - ahora.getTime()).toBe(60_000);
    expect(calcularProximoIntento(99, ahora).getTime() - ahora.getTime()).toBe(360 * 60_000);
  });
});

describe('tareasParaCompra', () => {
  const coop = (id: string, modo: CooperativaDeCompra['modo'], tieneIntegracionApi = false): CooperativaDeCompra => ({
    id,
    modo,
    tieneIntegracionApi,
  });

  it('plataforma completa: Klumbus factura el pasaje y registra la tasa de cada cooperativa', () => {
    expect(tareasParaCompra([coop('a', 'plataforma_completa'), coop('b', 'plataforma_completa')], 1)).toEqual([
      { tipo: 'factura_pasaje', cooperativaId: 'a' },
      { tipo: 'registro_tasa', cooperativaId: 'a' },
      { tipo: 'factura_pasaje', cooperativaId: 'b' },
      { tipo: 'registro_tasa', cooperativaId: 'b' },
      { tipo: 'factura_plataforma', cooperativaId: null },
    ]);
  });

  it('intermediario con cobro y llave API: se espera el reporte de la cooperativa, no se factura por ella', () => {
    expect(tareasParaCompra([coop('a', 'intermediario_con_cobro', true)], 0.5)).toEqual([
      { tipo: 'confirmacion_cooperativa', cooperativaId: 'a' },
      { tipo: 'factura_plataforma', cooperativaId: null },
    ]);
  });

  it('intermediario sin llave API: la cooperativa factura por su cuenta, como siempre, y no se le espera nada', () => {
    expect(tareasParaCompra([coop('a', 'intermediario_con_cobro', false)], 0.5)).toEqual([
      { tipo: 'factura_plataforma', cooperativaId: null },
    ]);
  });

  it('una compra puede mezclar cooperativas de modos distintos', () => {
    expect(
      tareasParaCompra([coop('a', 'plataforma_completa'), coop('b', 'intermediario_con_cobro', true)], 0).map(
        (t) => `${t.tipo}:${t.cooperativaId}`,
      ),
    ).toEqual(['factura_pasaje:a', 'registro_tasa:a', 'confirmacion_cooperativa:b']);
  });

  it('no crea factura de la plataforma cuando no hay cargo', () => {
    expect(tareasParaCompra([coop('a', 'plataforma_completa')], 0).map((t) => t.tipo)).toEqual([
      'factura_pasaje',
      'registro_tasa',
    ]);
  });
});

describe('capacidadesDeModo', () => {
  it('cada modo reparte las responsabilidades distinto', () => {
    expect(capacidadesDeModo('plataforma_completa')).toEqual({
      klumbusFacturaPasaje: true,
      klumbusRegistraTasa: true,
      cooperativaReporta: false,
      klumbusCobraEnLinea: true,
    });
    expect(capacidadesDeModo('intermediario_con_cobro').klumbusCobraEnLinea).toBe(true);
    expect(capacidadesDeModo('intermediario_con_cobro').cooperativaReporta).toBe(true);
    expect(capacidadesDeModo('intermediario_venta').klumbusCobraEnLinea).toBe(false);
  });
});

describe('estadoCompraSegunTareas', () => {
  const t = (tipo: 'factura_pasaje' | 'registro_tasa' | 'factura_plataforma' | 'confirmacion_cooperativa', estado: 'pendiente' | 'exitosa' | 'agotada') => ({
    tipo,
    estado,
  });

  it('completada cuando todo salió bien', () => {
    expect(
      estadoCompraSegunTareas([t('factura_pasaje', 'exitosa'), t('registro_tasa', 'exitosa'), t('factura_plataforma', 'exitosa')]),
    ).toBe('completada');
  });

  it('la confirmación de la cooperativa cuenta como factura y tasa a la vez', () => {
    expect(
      estadoCompraSegunTareas([t('confirmacion_cooperativa', 'exitosa'), t('factura_plataforma', 'exitosa')]),
    ).toBe('completada');
    expect(
      estadoCompraSegunTareas([t('confirmacion_cooperativa', 'exitosa'), t('factura_plataforma', 'pendiente')]),
    ).toBe('tasa_confirmada');
  });

  it('tasa confirmada cuando solo falta la factura de la plataforma', () => {
    expect(
      estadoCompraSegunTareas([t('factura_pasaje', 'exitosa'), t('registro_tasa', 'exitosa'), t('factura_plataforma', 'pendiente')]),
    ).toBe('tasa_confirmada');
  });

  it('no avanza si falta alguna tasa o no hay tareas', () => {
    expect(estadoCompraSegunTareas([t('factura_pasaje', 'exitosa'), t('registro_tasa', 'pendiente')])).toBeNull();
    expect(estadoCompraSegunTareas([t('registro_tasa', 'agotada')])).toBeNull();
    expect(estadoCompraSegunTareas([])).toBeNull();
  });
});
