import {
  calcularProximoIntento,
  estadoCompraSegunTareas,
  tareasParaCompra,
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
  it('crea factura y tasa por cooperativa, y la factura de la plataforma si hay cargo', () => {
    expect(tareasParaCompra(['a', 'b'], 1)).toEqual([
      { tipo: 'factura_pasaje', cooperativaId: 'a' },
      { tipo: 'registro_tasa', cooperativaId: 'a' },
      { tipo: 'factura_pasaje', cooperativaId: 'b' },
      { tipo: 'registro_tasa', cooperativaId: 'b' },
      { tipo: 'factura_plataforma', cooperativaId: null },
    ]);
  });

  it('no crea factura de la plataforma cuando no hay cargo', () => {
    expect(tareasParaCompra(['a'], 0).map((t) => t.tipo)).toEqual(['factura_pasaje', 'registro_tasa']);
  });
});

describe('estadoCompraSegunTareas', () => {
  const t = (tipo: 'factura_pasaje' | 'registro_tasa' | 'factura_plataforma', estado: 'pendiente' | 'exitosa' | 'agotada') => ({
    tipo,
    estado,
  });

  it('completada cuando todo salió bien', () => {
    expect(
      estadoCompraSegunTareas([t('factura_pasaje', 'exitosa'), t('registro_tasa', 'exitosa'), t('factura_plataforma', 'exitosa')]),
    ).toBe('completada');
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
