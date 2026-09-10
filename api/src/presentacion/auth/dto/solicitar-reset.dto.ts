import { IsEmail } from 'class-validator';

export class SolicitarResetDto {
  @IsEmail()
  correo!: string;
}
