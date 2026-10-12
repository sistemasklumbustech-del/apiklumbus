import { registerDecorator, type ValidationOptions } from 'class-validator';
import { esContrasenaComun } from '../../../dominio/auth/contrasenas-comunes';

/** Rechaza contraseñas de las listas más comunes. Ver dominio/auth/contrasenas-comunes.ts. */
export function ContrasenaNoComun(opciones?: ValidationOptions) {
  return (objeto: object, propiedad: string) => {
    registerDecorator({
      name: 'contrasenaNoComun',
      target: objeto.constructor,
      propertyName: propiedad,
      options: {
        message: 'Esa contraseña es muy común y fácil de adivinar. Elige otra.',
        ...opciones,
      },
      validator: {
        validate: (valor: unknown) => typeof valor !== 'string' || !esContrasenaComun(valor),
      },
    });
  };
}
