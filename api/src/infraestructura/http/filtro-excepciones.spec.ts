import { DrizzleQueryError } from 'drizzle-orm';
import { esErrorDeFormato } from './filtro-excepciones';

function errorDeBase(codigo: string | undefined): DrizzleQueryError {
  const causa = Object.assign(new Error('falló la consulta'), { code: codigo });
  return new DrizzleQueryError('select 1', [], causa);
}

describe('errores de formato de dato', () => {
  it('un id que no es UUID, un enum inválido o una fecha mala se tratan como dato mal enviado', () => {
    for (const codigo of ['22P02', '22007', '22008']) {
      expect(esErrorDeFormato(errorDeBase(codigo))).toBe(true);
    }
  });

  it('cualquier otro error de base de datos sigue siendo un error del servidor', () => {
    for (const codigo of ['23505', '23503', '42P01', '57014', undefined]) {
      expect(esErrorDeFormato(errorDeBase(codigo))).toBe(false);
    }
  });

  it('lo que no es un error de consulta no se toca', () => {
    expect(esErrorDeFormato(new Error('otro'))).toBe(false);
    expect(esErrorDeFormato('texto')).toBe(false);
    expect(esErrorDeFormato(undefined)).toBe(false);
  });
});
