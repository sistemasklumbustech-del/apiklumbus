import { Module } from '@nestjs/common';
import { ArchivosPrivadosController } from './archivos-privados.controller';

@Module({ controllers: [ArchivosPrivadosController] })
export class ArchivosModule {}
