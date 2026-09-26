import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  SoporteService,
  TEMAS_AYUDA,
  type TemaAyuda,
} from '../../aplicacion/soporte/soporte.service';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class EnviarConsultaAyudaDto {
  @Transform(recortar)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nombre!: string;

  @Transform(recortar)
  @IsEmail()
  @MaxLength(150)
  correo!: string;

  @IsIn(Object.keys(TEMAS_AYUDA))
  tema!: TemaAyuda;

  @Transform(recortar)
  @IsString()
  @MinLength(10, { message: 'Cuéntanos un poco más (mínimo 10 caracteres).' })
  @MaxLength(2000)
  mensaje!: string;

  /** Número de compra o boleto, si la consulta trata de uno. */
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(60)
  codigoReferencia?: string;

  /** Campo trampa: las personas no lo ven ni lo llenan; los robots sí. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sitioWeb?: string;
}

/** Formulario público de ayuda -- limitado por dirección IP para evitar abuso. */
@Controller('soporte')
export class SoporteController {
  constructor(private readonly soporte: SoporteService) {}

  @Throttle({
    default: {
      limit: process.env.NODE_ENV === 'test' ? 10000 : 3,
      ttl: 600000,
    },
  })
  @Post('consulta')
  async enviar(@Body() dto: EnviarConsultaAyudaDto) {
    // Un robot llenó el campo trampa: se responde "ok" sin enviar nada.
    if (dto.sitioWeb && dto.sitioWeb.trim() !== '') {
      return { referencia: 'AY-000000' };
    }
    return this.soporte.enviarConsulta({
      nombre: dto.nombre,
      correo: dto.correo,
      tema: dto.tema,
      mensaje: dto.mensaje,
      codigoReferencia: dto.codigoReferencia || undefined,
    });
  }
}
