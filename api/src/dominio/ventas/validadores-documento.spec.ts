import {
  esCedulaEcuatorianaValida,
  esIdentificacionFacturacionValida,
  esRucEcuatorianoValido,
} from './validadores-documento';

describe('esRucEcuatorianoValido', () => {
  it('acepta el RUC de persona natural construido sobre una cedula valida', () => {
    expect(esCedulaEcuatorianaValida('1710034065')).toBe(true);
    expect(esRucEcuatorianoValido('1710034065001')).toBe(true);
  });

  it('rechaza persona natural cuya cedula base es invalida', () => {
    expect(esRucEcuatorianoValido('1710034066001')).toBe(false);
  });

  it('acepta sociedades privadas (9) y publicas (6) por formato', () => {
    expect(esRucEcuatorianoValido('0791845968001')).toBe(true);
    expect(esRucEcuatorianoValido('1760001550001')).toBe(true);
  });

  it('rechaza establecimiento 000, largo distinto de 13 y tercer digito 7 u 8', () => {
    expect(esRucEcuatorianoValido('0791845968000')).toBe(false);
    expect(esRucEcuatorianoValido('079184596800')).toBe(false);
    expect(esRucEcuatorianoValido('0771845968001')).toBe(false);
    expect(esRucEcuatorianoValido('0781845968001')).toBe(false);
  });
});

describe('esIdentificacionFacturacionValida', () => {
  it('delega cedula y pasaporte al validador de documentos', () => {
    expect(esIdentificacionFacturacionValida('1710034065', 'cedula')).toBe(true);
    expect(esIdentificacionFacturacionValida('1710034066', 'cedula')).toBe(false);
    expect(esIdentificacionFacturacionValida('AB123456', 'pasaporte')).toBe(true);
    expect(esIdentificacionFacturacionValida('12', 'pasaporte')).toBe(false);
  });

  it('usa el validador de RUC para el tipo ruc', () => {
    expect(esIdentificacionFacturacionValida('0791845968001', 'ruc')).toBe(true);
    expect(esIdentificacionFacturacionValida('1710034065', 'ruc')).toBe(false);
  });
});
