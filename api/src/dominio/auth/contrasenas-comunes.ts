/**
 * Contraseñas demasiado comunes (12-oct-2026). Hasta ahora la única regla era "mínimo 8
 * caracteres", y "password", "12345678" o "aaaaaaaa" la cumplen. Siguiendo la guía de NIST
 * (SP 800-63B) no se imponen reglas de mayúsculas ni símbolos: se rechaza lo que ya figura en
 * las listas que usa cualquiera que intente adivinar contraseñas.
 *
 * Solo se aplica al FIJAR una contraseña (registro, restablecer, cambiar). Iniciar sesión no la
 * revisa: quien ya tiene una contraseña común puede entrar y cambiarla.
 */
const COMUNES = new Set([
  // Las más usadas en el mundo
  '123456', '1234567', '12345678', '123456789', '1234567890', '12345', '123123', '123123123', '12341234',
  '111111', '11111111', '1111111111', '000000', '00000000', '654321', '987654321', '0987654321', '121212',
  '112233', '123321', '1234qwer', 'qwer1234', 'qwerty', 'qwerty12', 'qwerty123', 'qwertyui', 'qwertyuiop',
  'asdfgh', 'asdfghjk', 'asdfghjkl', 'zxcvbnm', '1q2w3e4r', '1qaz2wsx', 'qazwsx', 'abc123', 'abcd1234',
  'abc12345', 'abcdefgh', 'abcdefg1', 'password', 'password1', 'password12', 'password123', 'passw0rd',
  'p@ssw0rd', 'iloveyou', 'letmein', 'welcome', 'welcome1', 'admin', 'admin123', 'administrator', 'root',
  'toor', 'login', 'master', 'dragon', 'monkey', 'shadow', 'sunshine', 'princess', 'football', 'baseball',
  'superman', 'batman', 'trustno1', 'whatever', 'freedom', 'starwars', 'hello', 'hello123', 'secret',
  'changeme', 'default', 'test', 'test123', 'testing', 'user', 'user123', 'guest', 'minecraft', 'pokemon',
  'nintendo', 'fortnite',
  // En español
  'contrasena', 'contrasena1', 'contrasena123', 'clave', 'clave123', 'clave1234', 'miclave', 'micontrasena',
  'mipassword', 'usuario', 'usuario123', 'bienvenido', 'bienvenida', 'hola', 'hola123', 'holamundo', 'teamo',
  'teamo123', 'tequiero', 'tequiero1', 'amor', 'amor123', 'mamamama', 'familia', 'dios', 'diosmio', 'jesus',
  'jesus123', 'futbol', 'barcelona', 'barcelonasc', 'emelec', 'liga', 'messi', 'cristiano', 'ronaldo',
  // Ecuador y la propia plataforma
  'ecuador', 'ecuador1', 'ecuador123', 'quito', 'quito123', 'guayaquil', 'cuenca', 'machala', 'machala123',
  'klumbus', 'klumbus1', 'klumbus123', 'klumbustech', 'pasajes', 'boleto', 'bus',
]);

function esSecuenciaSimple(p: string): boolean {
  if (p.length < 6) return false;
  const codigos = [...p].map((c) => c.charCodeAt(0));
  const diferencias = codigos.slice(1).map((c, i) => c - codigos[i]);
  // 12345678, 87654321, abcdefgh, hgfedcba
  return diferencias.every((d) => d === 1) || diferencias.every((d) => d === -1);
}

export function esContrasenaComun(contrasena: string): boolean {
  const p = contrasena
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (COMUNES.has(p)) return true;
  // "Password123", "qwerty2026!" y similares: se mira la palabra sin los dígitos y signos del final.
  const base = p.replace(/[\d!@#$%^&*()_+\-=.?]+$/, '');
  if (base.length >= 3 && COMUNES.has(base)) return true;
  if (/^(.)\1+$/.test(p)) return true; // aaaaaaaa
  return esSecuenciaSimple(p);
}
