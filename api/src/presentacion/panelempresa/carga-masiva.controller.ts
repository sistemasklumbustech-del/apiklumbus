import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Request,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CargaMasivaService } from '../../aplicacion/panelempresa/carga-masiva.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PayloadToken } from '../../dominio/auth/auth.ports';

function cooperativaDelToken(user: PayloadToken): string {
  if (!user.cooperativaId) {
    throw new ForbiddenException(
      'Este usuario no pertenece a ninguna cooperativa.',
    );
  }
  return user.cooperativaId;
}

const TIPO_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function validarArchivo(file: Express.Multer.File | undefined): Buffer {
  if (!file) throw new BadRequestException('No se recibió ningún archivo.');
  if (!/\.xlsx$/i.test(file.originalname)) {
    throw new BadRequestException(
      'Sube la plantilla en formato Excel (.xlsx).',
    );
  }
  return file.buffer;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_cooperativa')
@Controller('coop/carga-masiva')
export class CargaMasivaController {
  constructor(private readonly cargaMasiva: CargaMasivaService) {}

  @Get('plantilla')
  async plantilla(@Res({ passthrough: true }) res: Response) {
    const buffer = await this.cargaMasiva.plantilla();
    res.set({
      'Content-Type': TIPO_XLSX,
      'Content-Disposition':
        'attachment; filename="plantilla-carga-masiva-klumbus.xlsx"',
    });
    return new StreamableFile(buffer);
  }

  @Post('revisar')
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  revisar(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: { user: PayloadToken },
  ) {
    return this.cargaMasiva.revisar(
      cooperativaDelToken(req.user),
      validarArchivo(file),
    );
  }

  @Post('importar')
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  importar(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: { user: PayloadToken },
  ) {
    return this.cargaMasiva.importar(
      cooperativaDelToken(req.user),
      validarArchivo(file),
    );
  }
}
