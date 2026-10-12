import { esContrasenaComun } from './contrasenas-comunes';

describe('contraseñas demasiado comunes', () => {
  it('rechaza las de siempre, con cualquier combinación de mayúsculas', () => {
    for (const p of ['password', 'Password', '12345678', 'qwerty123', 'iloveyou', 'ADMIN123', 'Contraseña']) {
      expect(esContrasenaComun(p)).toBe(true);
    }
  });

  it('rechaza la palabra común con dígitos o signos al final, y las que llevan tilde', () => {
    for (const p of ['Password123', 'qwerty2026!', 'Ecuador2026', 'Klumbus#1', 'Contraseña123', 'Hola.2026']) {
      expect(esContrasenaComun(p)).toBe(true);
    }
  });

  it('rechaza repeticiones y secuencias simples', () => {
    for (const p of ['aaaaaaaa', '00000000', '87654321', 'abcdefgh', 'hgfedcba', '23456789']) {
      expect(esContrasenaComun(p)).toBe(true);
    }
  });

  it('acepta contraseñas razonables, aunque lleven una palabra común dentro', () => {
    for (const p of ['ClaveSegura123', 'NuevaClaveSegura456', 'mi-bus-favorito-sale-a-las-8', 'Tr3n-Azul-Lluvia', 'passwordManager9x', 'ecuadorLindo']) {
      expect(esContrasenaComun(p)).toBe(false);
    }
  });
});
