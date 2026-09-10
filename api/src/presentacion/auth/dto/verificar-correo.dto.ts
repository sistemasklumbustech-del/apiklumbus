import { IsString } from 'class-validator';

export class VerificarCorreoDto {
  @IsString()
  token!: string;
}
