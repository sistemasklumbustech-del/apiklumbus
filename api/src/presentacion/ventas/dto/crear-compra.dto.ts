import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  IsInt,
  IsBoolean,
  Matches,
  ValidateNested,
  MinLength,
  ArrayMinSize,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Correccion real 18-ago-2026, hallazgo del director probando la
 * compra VIP: los nombres/apellidos del pasajero solo exigian 2+
 * caracteres, sin formato real, y no forzaban mayuscula inicial.
 * Acepta letras (incluye tildes y enie), espacios y apostrofes/guion
 * (para nombres compuestos reales como "María José" o "D'Angelo").
 */
const PATRON_NOMBRE_REAL = /^[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ'-]*(?:\s[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ'-]*)*$/;

function capitalizarNombre(valor: unknown): unknown {
  if (typeof valor !== 'string') return valor;
  return valor
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((palabra) => palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase())
    .join(' ');
}
import { esDocumentoValido } from '../../../dominio/ventas/validadores-documento';

/**
 * Item 31.1, Fase 7 (13-ago-2026) -- el numero de documento se valida
 * distinto segun el tipo declarado (cedula: algoritmo real Modulo 10;
 * pasaporte: formato mas ligero) -- necesita leer el campo hermano
 * tipoDocumento, por eso es un validador de clase, no un decorador
 * simple como @Matches.
 */
@ValidatorConstraint({ name: 'esDocumentoValidoSegunTipo', async: false })
class EsDocumentoValidoSegunTipoConstraint implements ValidatorConstraintInterface {
  validate(documento: string, args: ValidationArguments): boolean {
    const objeto = args.object as { tipoDocumento?: 'cedula' | 'pasaporte' };
    if (!objeto.tipoDocumento) return false;
    return esDocumentoValido(documento, objeto.tipoDocumento);
  }

  defaultMessage(args: ValidationArguments): string {
    const objeto = args.object as { tipoDocumento?: 'cedula' | 'pasaporte' };
    return objeto.tipoDocumento === 'cedula'
      ? 'El numero de cedula no es valido (verifica los digitos).'
      : 'El numero de pasaporte no tiene un formato valido.';
  }
}

/**
 * RF-MENOR — autorización de viaje de menor de edad. Solo se exige
 * (en el servicio, no aquí) cuando el pasajero da como resultado
 * "es menor" según esMenorDeEdad() — hallazgo real 22-jul-2026: antes
 * de esto, un menor podía comprar (tarifa 'nino') sin ningún control
 * de acompañamiento real, a pesar de que las tablas ya existían.
 */
class AutorizacionMenorDto {
  @IsIn(['con_padre_madre_tutor', 'con_autorizacion'])
  tipoAcompanamiento!: 'con_padre_madre_tutor' | 'con_autorizacion';

  /** Solo si tipoAcompanamiento = 'con_padre_madre_tutor' — índice (0-based) del adulto en este mismo arreglo de pasajeros. */
  @IsOptional()
  @IsInt()
  adultoAcompananteIndice?: number;

  /** Los siguientes 4 solo aplican si tipoAcompanamiento = 'con_autorizacion'. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  adultoResponsableNombre?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  adultoResponsableDocumento?: string;

  /** Item 31.1 -- formato movil ecuatoriano real (10 digitos, empieza con 09). */
  @IsOptional()
  @IsString()
  @Matches(/^09\d{8}$/, { message: 'El telefono debe ser un numero movil ecuatoriano valido (10 digitos, empieza con 09).' })
  adultoResponsableTelefono?: string;

  @IsOptional()
  @IsString()
  documentoAutorizacionUrl?: string;
}

export class PasajeroCheckoutDto {
  @IsUUID()
  viajeId!: string;

  @IsString()
  numeroAsiento!: string;

  /** Item 31.1, Fase 7 (13-ago-2026) -- separado en 2 campos reales (antes nombreCompleto). */
  @IsString()
  @MinLength(2)
  @Matches(PATRON_NOMBRE_REAL, { message: 'nombres debe contener solo letras (se aceptan tildes y ñ)' })
  @Transform(({ value }) => capitalizarNombre(value))
  nombres!: string;

  @IsString()
  @MinLength(2)
  @Matches(PATRON_NOMBRE_REAL, { message: 'apellidos debe contener solo letras (se aceptan tildes y ñ)' })
  @Transform(({ value }) => capitalizarNombre(value))
  apellidos!: string;

  /** Selector explicito -- confirmado con FlixBus que ambos son documentos validos reales. */
  @IsIn(['cedula', 'pasaporte'])
  tipoDocumento!: 'cedula' | 'pasaporte';

  @IsString()
  @Validate(EsDocumentoValidoSegunTipoConstraint)
  documento!: string;

  @IsIn(['adulto', 'nino', 'tercera_edad', 'discapacidad'])
  tipoTarifa!: 'adulto' | 'nino' | 'tercera_edad' | 'discapacidad';

  @IsOptional()
  @IsString()
  fechaNacimiento?: string;

  /** LOTTTSV Art. 48 -- atencion preferente, NO es un descuento (no toca tipoTarifa ni el precio). */
  @IsOptional()
  @IsBoolean()
  esEmbarazada?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => AutorizacionMenorDto)
  autorizacionMenor?: AutorizacionMenorDto;

  /**
   * Discapacidad, captura real (13-ago-2026) -- número de carné
   * CONADIS/MSP o de cédula (donde ya conste la condición). Solo
   * declaración -- la validación condicional real (obligatorio cuando
   * tipoTarifa='discapacidad') vive en checkout.service.ts, mismo
   * patrón que autorizacionMenor con esMenorDeEdad -- no aquí en el
   * DTO, porque depende de otro campo del mismo objeto.
   */
  @IsOptional()
  @IsString()
  numeroDocumentoDiscapacidad?: string;
}

export class CrearCompraDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PasajeroCheckoutDto)
  pasajeros!: PasajeroCheckoutDto[];

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  /** Vacío real de diseño encontrado el 29-jul-2026: hasta ahora el crédito de reprogramación solo se generaba, nunca se podía gastar. */
  @IsOptional()
  @IsUUID()
  creditoIdAUsar?: string;

  /**
   * Item 31, Fase 7 (11-ago-2026) -- compra como invitado (sin cuenta).
   * Solo se usan cuando la peticion no trae token (comprador sin
   * cuenta) -- el servicio valida que al menos uno de los 2 este
   * presente en ese caso, porque sin ninguno no hay forma real de
   * contactar al pasajero.
   */
  /** Item 31.1 -- formato movil ecuatoriano real (10 digitos, empieza con 09). */
  @IsOptional()
  @IsString()
  @Matches(/^09\d{8}$/, { message: 'El telefono debe ser un numero movil ecuatoriano valido (10 digitos, empieza con 09).' })
  telefonoContacto?: string;

  @IsOptional()
  @IsString()
  correoContacto?: string;

  /**
   * Item 31, Fase 7 (11-ago-2026) -- compra como invitado. Debe
   * coincidir con la sesionInvitadoId usada al bloquear los asientos
   * -- si no coincide, el bloqueo no se reconoce como propio.
   */
  @IsOptional()
  @IsString()
  sesionInvitadoId?: string;

  /**
   * Wallet/cashback Fase 2 (13-ago-2026) -- gastar el saldo. Excluyente
   * con creditoIdAUsar (investigado en los Términos de Uso reales de
   * ClickBus, sección 5.7.5.1: el wallet no es acumulable con otra
   * forma de descuento) -- se valida en checkout.service.ts, no aquí,
   * porque necesita comparar los 2 campos juntos.
   */
  @IsOptional()
  @IsBoolean()
  usarSaldoWallet?: boolean;
}
